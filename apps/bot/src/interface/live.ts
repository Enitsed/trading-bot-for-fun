import type { Exchange } from 'ccxt';
import {
  connect,
  fetchOHLCV,
  getPositionQty,
  placeMarket,
  quotePrecision,
  toAmountPrecision,
} from '@scalper/bot/infrastructure/exchange.js';
import {
  rsiReversionSignals,
  sizeByRisk,
  computeBracket,
  hitBracket,
  withinCooldown,
  type Candle,
  type Signal,
  type Bracket,
} from '@scalper/domain';
import { CFG } from '@scalper/bot/infrastructure/config.js';
import { prepareStorage, recordPriceTick, recordTrade } from '@scalper/bot/infrastructure/storage.js';
import {
  fetchPendingCommands,
  getRuntimeOverrides,
  markCommandsProcessed,
  saveTelemetrySnapshot,
  adjustAmountWithThreshold,
  adjustSellAmount,
  isOrderable,
  CANDLE_LIMITS,
  SLEEP_DURATIONS,
  DEFAULT_FEE_RATE,
  ERROR_HANDLING,
} from '@scalper/shared';
import type { TelemetrySnapshot, ManualActionType } from '@scalper/shared';
import { calculateEquity, type BalanceSnapshot } from '@scalper/bot/infrastructure/balance.js';

type Snapshot = {
  timestamp: number;
  price: number;
  signal: Signal;
  recentSignals: Signal[];
  position: number;
  entryPrice: number;
  openBracket: Bracket | null;
  thresholds: {
    baseMin: number;
    baseStep: number;
    notionalMin: number;
    tradable: number;
  };
  equity: number;
  drawdown: number;
  totalPnl?: number;
  totalPnlPct?: number;
  mark: number;
  balances: BalanceSnapshot;
  lastTradeTs: number | null;
  event: string;
  runtimeCfg: RuntimeCfg;
};

type RuntimeCfg = {
  rsiLen: number;
  rsiEntry: number;
  rsiExit: number;
  riskPerTrade: number;
  stopPct: number;
  takePct: number;
  cooldownMin: number;
};

type RuntimeOverrides = Partial<RuntimeCfg>;

type Command = { id: string; type: ManualActionType; amount?: number | null; createdAt: number };

const DEFAULT_RUNTIME_CFG: RuntimeCfg = {
  rsiLen: CFG.rsiLen,
  rsiEntry: CFG.rsiEntry,
  rsiExit: CFG.rsiExit,
  riskPerTrade: CFG.riskPerTrade,
  stopPct: CFG.stopPct,
  takePct: CFG.takePct,
  cooldownMin: CFG.cooldownMin,
};

type OrderResult = Awaited<ReturnType<typeof placeMarket>>;

type OrderDetails = {
  orderId: string | null;
  clientOrderId: string | null;
  info?: Record<string, unknown>;
};

function extractOrderDetails(order: OrderResult | null | undefined): OrderDetails {
  if (!order || typeof order !== 'object') {
    return { orderId: null, clientOrderId: null };
  }
  const orderId = 'id' in order && typeof order.id === 'string' && order.id.length > 0 ? order.id : null;
  const clientOrderId =
    'clientOrderId' in order && typeof order.clientOrderId === 'string' && order.clientOrderId.length > 0
      ? order.clientOrderId
      : null;
  const info =
    'info' in order && order.info && typeof order.info === 'object'
      ? (order.info as Record<string, unknown>)
      : undefined;
  return info ? { orderId, clientOrderId, info } : { orderId, clientOrderId };
}

function resolveRuntimeCfg(overrides: RuntimeOverrides | null | undefined): RuntimeCfg {
  if (!overrides) return { ...DEFAULT_RUNTIME_CFG };
  return {
    rsiLen: Number.isFinite(overrides.rsiLen) && overrides.rsiLen ? overrides.rsiLen : DEFAULT_RUNTIME_CFG.rsiLen,
    rsiEntry:
      Number.isFinite(overrides.rsiEntry) && overrides.rsiEntry ? overrides.rsiEntry : DEFAULT_RUNTIME_CFG.rsiEntry,
    rsiExit:
      Number.isFinite(overrides.rsiExit) && overrides.rsiExit ? overrides.rsiExit : DEFAULT_RUNTIME_CFG.rsiExit,
    riskPerTrade:
      Number.isFinite(overrides.riskPerTrade) && overrides.riskPerTrade
        ? overrides.riskPerTrade
        : DEFAULT_RUNTIME_CFG.riskPerTrade,
    stopPct:
      Number.isFinite(overrides.stopPct) && overrides.stopPct ? overrides.stopPct : DEFAULT_RUNTIME_CFG.stopPct,
    takePct:
      Number.isFinite(overrides.takePct) && overrides.takePct ? overrides.takePct : DEFAULT_RUNTIME_CFG.takePct,
    cooldownMin:
      Number.isFinite(overrides.cooldownMin) && overrides.cooldownMin
        ? overrides.cooldownMin
        : DEFAULT_RUNTIME_CFG.cooldownMin,
  };
}

async function loadOverrides(): Promise<RuntimeOverrides | null> {
  const overrides = await getRuntimeOverrides();
  return Object.keys(overrides).length > 0 ? overrides : null;
}

async function consumeCommands(): Promise<Command[]> {
  const rows = await fetchPendingCommands();
  if (!rows.length) return [];
  await markCommandsProcessed(rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    type: row.type as ManualActionType,
    amount: row.amount ?? undefined,
    createdAt: row.createdAt.getTime(),
  }));
}

async function writeSnapshot(snapshot: Snapshot) {
  const payload: TelemetrySnapshot = {
    timestamp: snapshot.timestamp,
    price: snapshot.price,
    signal: snapshot.signal,
    recentSignals: snapshot.recentSignals,
    position: snapshot.position,
    entryPrice: snapshot.entryPrice,
    openBracket: snapshot.openBracket,
    thresholds: snapshot.thresholds,
    equity: snapshot.equity,
    drawdown: snapshot.drawdown,
    totalPnl: snapshot.totalPnl ?? 0,
    totalPnlPct: snapshot.totalPnlPct ?? 0,
    mark: snapshot.mark,
    balances: snapshot.balances,
    lastTradeTs: snapshot.lastTradeTs,
    event: snapshot.event,
    runtimeCfg: snapshot.runtimeCfg,
  };
  await saveTelemetrySnapshot(payload);
}

async function handleCommand(
  command: Command,
  ctx: {
    exchange: Exchange;
    price: number;
    tradableThreshold: number;
    notionalMin: number;
    equity: number;
    balances: BalanceSnapshot;
    mark: number;
    position: number;
    entryPrice: number;
    openBracket: Bracket | null;
    runtimeCfg: RuntimeCfg;
    drawdown: number;
    thresholds: Snapshot['thresholds'];
    lastTradeTs: number | null;
  }
): Promise<{
  equity: number;
  balances: BalanceSnapshot;
  mark: number;
  position: number;
  entryPrice: number;
  openBracket: Bracket | null;
  lastTradeTs: number | null;
  event: string;
}> {
  const { exchange, price, tradableThreshold, notionalMin, runtimeCfg, thresholds } = ctx;
  let { position, entryPrice, openBracket, equity, balances, mark, lastTradeTs } = ctx;
  let event = `command:${command.type}`;

  const refreshState = async () => {
    const refreshed = await calculateEquity(exchange);
    equity = refreshed.equity;
    balances = refreshed.balances;
    mark = refreshed.mark;
    position = await getPositionQty(exchange);
  };

  if (command.type === 'manual-buy') {
    const desired = typeof command.amount === 'number' && command.amount > 0 ? command.amount : tradableThreshold;
    const amount = adjustAmountWithThreshold(toAmountPrecision, exchange, desired, tradableThreshold);
    const notional = amount * price;
    if (amount >= tradableThreshold && notional >= notionalMin) {
      const order = await placeMarket(exchange, 'buy', amount);
      const executedAt = Date.now();
      entryPrice = price;
      openBracket = computeBracket(entryPrice, { stopPct: runtimeCfg.stopPct, takePct: runtimeCfg.takePct });
      lastTradeTs = executedAt;
      event = `manual-buy:${amount}`;
      await refreshState();
      const details = extractOrderDetails(order);
      const metadata: Record<string, unknown> = {
        source: 'command',
        commandId: command.id,
        commandType: command.type,
        notional,
        bracket: openBracket,
        runtimeCfg: { ...runtimeCfg },
        thresholds: { ...thresholds },
      };
      if (details.info) {
        metadata.orderInfo = details.info;
      }
      await recordTrade({
        symbol: CFG.symbol,
        ts: executedAt,
        side: 'buy',
        amount,
        price,
        event,
        position,
        equity,
        orderId: details.orderId,
        clientOrderId: details.clientOrderId,
        metadata,
      });
    } else {
      event = 'manual-buy-skip';
    }
  } else if (command.type === 'manual-sell') {
    if (position <= 0) {
      event = 'manual-sell-skip:no-position';
    } else {
      const desired =
        typeof command.amount === 'number' && command.amount > 0 ? Math.min(command.amount, position) : position;
      const amount = adjustSellAmount(toAmountPrecision, exchange, desired, position, tradableThreshold);
      const notional = amount * price;
      if (amount > 0 && notional >= notionalMin) {
        const preTradePosition = position;
        const order = await placeMarket(exchange, 'sell', amount);
        const executedAt = Date.now();
        lastTradeTs = executedAt;
        if (amount >= position) {
          entryPrice = 0;
          openBracket = null;
        }
        event = `manual-sell:${amount}`;
        await refreshState();
        const details = extractOrderDetails(order);
        const metadata: Record<string, unknown> = {
          source: 'command',
          commandId: command.id,
          commandType: command.type,
          notional,
          preTradePosition,
          runtimeCfg: { ...runtimeCfg },
          thresholds: { ...thresholds },
        };
        if (details.info) {
          metadata.orderInfo = details.info;
        }
        await recordTrade({
          symbol: CFG.symbol,
          ts: executedAt,
          side: 'sell',
          amount,
          price,
          event,
          position,
          equity,
          orderId: details.orderId,
          clientOrderId: details.clientOrderId,
          metadata,
        });
      } else {
        event = 'manual-sell-skip:size';
      }
    }
  } else if (command.type === 'flatten') {
    if (position <= 0) {
      event = 'flatten-skip:no-position';
    } else {
      let amount = Math.max(toAmountPrecision(exchange, position), 0);
      if (amount < tradableThreshold && position >= tradableThreshold) {
        amount = Math.max(toAmountPrecision(exchange, tradableThreshold), 0);
      } else if (amount > position) {
        amount = position;
      }
      amount = Math.max(toAmountPrecision(exchange, amount), 0);
      const notional = amount * price;
      if (amount > 0 && notional >= notionalMin) {
        const preTradePosition = position;
        const order = await placeMarket(exchange, 'sell', amount);
        const executedAt = Date.now();
        lastTradeTs = executedAt;
        entryPrice = 0;
        openBracket = null;
        event = 'flatten';
        await refreshState();
        const details = extractOrderDetails(order);
        const metadata: Record<string, unknown> = {
          source: 'command',
          commandId: command.id,
          commandType: command.type,
          notional,
          preTradePosition,
          runtimeCfg: { ...runtimeCfg },
          thresholds: { ...thresholds },
        };
        if (details.info) {
          metadata.orderInfo = details.info;
        }
        await recordTrade({
          symbol: CFG.symbol,
          ts: executedAt,
          side: 'sell',
          amount,
          price,
          event,
          position,
          equity,
          orderId: details.orderId,
          clientOrderId: details.clientOrderId,
          metadata,
        });
      } else {
        event = 'flatten-skip:size';
      }
    }
  }

  return { equity, balances, mark, position, entryPrice, openBracket, lastTradeTs, event };
}

async function publishSnapshot(data: {
  price: number;
  signal: Signal;
  signals: Signal[];
  position: number;
  entryPrice: number;
  openBracket: Bracket | null;
  thresholds: Snapshot['thresholds'];
  equity: number;
  drawdown: number;
  mark: number;
  balances: BalanceSnapshot;
  lastTradeTs: number | null;
  event: string;
  runtimeCfg: RuntimeCfg;
  candleTs?: number;
  candle?: Candle | null;
}) {
  const snapshot: Snapshot = {
    timestamp: Date.now(),
    price: data.price,
    signal: data.signal,
    recentSignals: data.signals.slice(-10),
    position: data.position,
    entryPrice: data.entryPrice,
    openBracket: data.openBracket,
    thresholds: data.thresholds,
    equity: data.equity,
    drawdown: data.drawdown,
    mark: data.mark,
    balances: data.balances,
    lastTradeTs: data.lastTradeTs,
    event: data.event,
    runtimeCfg: data.runtimeCfg,
  };
  await writeSnapshot(snapshot);
  const candle = data.candle ?? null;
  const candleTs =
    typeof data.candleTs === 'number'
      ? data.candleTs
      : typeof candle?.ts === 'number'
        ? candle.ts
        : snapshot.timestamp;
  const fallbackPrice = Number.isFinite(data.price) ? data.price : 0;
  const open = candle && Number.isFinite(candle.open) ? candle.open : fallbackPrice;
  const high = candle && Number.isFinite(candle.high) ? candle.high : fallbackPrice;
  const low = candle && Number.isFinite(candle.low) ? candle.low : fallbackPrice;
  const close = candle && Number.isFinite(candle.close) ? candle.close : fallbackPrice;
  const volume = candle && Number.isFinite(candle.vol) && candle.vol >= 0 ? candle.vol : 0;

  await recordPriceTick({
    symbol: CFG.symbol,
    candleTs,
    open,
    high,
    low,
    close,
    volume,
    signal: data.signal,
    position: data.position,
    equity: data.equity,
    event: data.event,
    runtimeCfg: { ...data.runtimeCfg },
    recordedAt: snapshot.timestamp,
  });
}

let lastTradeTs: number | null = null; // 마지막 체결 시각(ms)
let openBracket: Bracket | null = null; // 현재 포지션의 스탑/익절 정보
let entryPrice = 0; // 현재 포지션 진입가

async function loop() {
  console.log('Loading exchange...');
  await prepareStorage();
  const exchange = await connect(); // ccxt 거래소 인스턴스
  console.log('Exchange loaded.');

  const { baseMin, baseStep, notionalMin } = await quotePrecision(exchange); // 최소 주문 수량과 스텝
  console.log(`Base min: ${baseMin}, step: ${baseStep}, notional min: ${notionalMin}`);
  const { equity: dayStartEquity } = await calculateEquity(exchange); // 일 시작 시점 평가금액

  console.log(`Starting bot on ${CFG.exchange} ${CFG.symbol} (sandbox=${CFG.useSandbox})`);
  let lastBarTs = 0;
  let runtimeCfg: RuntimeCfg = { ...DEFAULT_RUNTIME_CFG };
  while (true) {
    try {
      const overrides = await loadOverrides();
      runtimeCfg = resolveRuntimeCfg(overrides);

      const raw = await fetchOHLCV(exchange, CANDLE_LIMITS.DEFAULT); // 최신 OHLCV 캔들
      const candles: Candle[] = [];
      for (const row of raw) {
        const ts = typeof row[0] === 'number' ? row[0] : Number(row[0]);
        const open = typeof row[1] === 'number' ? row[1] : Number(row[1]);
        const high = typeof row[2] === 'number' ? row[2] : Number(row[2]);
        const low = typeof row[3] === 'number' ? row[3] : Number(row[3]);
        const close = typeof row[4] === 'number' ? row[4] : Number(row[4]);
        const vol = typeof row[5] === 'number' ? row[5] : Number(row[5] ?? 0);

        if (
          !Number.isFinite(ts) ||
          !Number.isFinite(open) ||
          !Number.isFinite(high) ||
          !Number.isFinite(low) ||
          !Number.isFinite(close) ||
          !Number.isFinite(vol)
        ) {
          continue;
        }

        candles.push({
          ts,
          open,
          high,
          low,
          close,
          vol,
        });
      }
      const latestCandle = candles.at(-1) ?? null;
      if (!latestCandle) {
        await sleep(SLEEP_DURATIONS.NO_CANDLE);
        continue;
      }
      const latestTs = latestCandle.ts; // 가장 최근 캔들 시간
      if (latestTs === lastBarTs) {
        await sleep(SLEEP_DURATIONS.NO_CANDLE);
        continue;
      }
      lastBarTs = latestTs;

      let { equity, balances, mark } = await calculateEquity(exchange); // 현재 평가금액 및 잔고
      const drawdown = (equity / dayStartEquity - 1) * 100; // 일일 손익률
      console.log(`Current equity: ${equity.toFixed(2)} (${drawdown.toFixed(2)}%)`);
      const signals = rsiReversionSignals(candles, {
        rsiLen: runtimeCfg.rsiLen,
        entry: runtimeCfg.rsiEntry,
        exit: runtimeCfg.rsiExit,
      });
      console.log(signals.slice(-10).reverse());
      const signal = signals.at(-1) ?? 'HOLD'; // 최신 캔들에 대한 시그널
      const price = latestCandle.close; // 현재 종가
      let position = await getPositionQty(exchange); // 보유 수량
      const thresholdRaw = Math.max(baseMin, notionalMin > 0 ? notionalMin / price : 0);
      const tradableThreshold =
        baseStep > 0
          ? Math.ceil((thresholdRaw - 1e-12) / baseStep) * baseStep
          : thresholdRaw; // 스텝을 반영한 최소 주문 수량
      let event = 'idle';
      const thresholds = { baseMin, baseStep, notionalMin, tradable: tradableThreshold };

      const commands = await consumeCommands();
      if (commands.length) {
        for (const command of commands) {
          const result = await handleCommand(command, {
            exchange,
            price,
            tradableThreshold,
            notionalMin,
            equity,
            balances,
            mark,
            position,
            entryPrice,
            openBracket,
            runtimeCfg,
            drawdown,
            thresholds,
            lastTradeTs,
          });
          ({ equity, balances, mark, position, entryPrice, openBracket, lastTradeTs } = result);
          const commandDrawdown = (equity / dayStartEquity - 1) * 100;
          await publishSnapshot({
            price,
            signal,
            signals,
            position,
            entryPrice,
            openBracket,
            thresholds,
            equity,
            drawdown: commandDrawdown,
            mark,
            balances,
            lastTradeTs,
            event: result.event,
            runtimeCfg,
            candleTs: latestTs,
            candle: latestCandle,
          });
        }
      }

      let drawdownActive = drawdown;
      if (equity !== undefined) {
        drawdownActive = (equity / dayStartEquity - 1) * 100;
      }

      if (drawdownActive <= -CFG.maxDailyLossPct) {
        console.warn(`[GUARD] Daily loss ${drawdownActive.toFixed(2)}% ≤ -${CFG.maxDailyLossPct}% → halt`);
        event = 'halt-drawdown';
        await publishSnapshot({
          price,
          signal,
          signals,
          position,
          entryPrice,
          openBracket,
          thresholds,
          equity,
          drawdown: drawdownActive,
          mark,
          balances,
          lastTradeTs,
          event,
          runtimeCfg,
          candleTs: latestTs,
          candle: latestCandle,
        });
        await sleep(SLEEP_DURATIONS.LONG_WAIT);
        continue;
      }

      if (position > 0 && openBracket) {
        const hit = hitBracket(price, openBracket);
        if (hit) {
          const amount = adjustSellAmount(toAmountPrecision, exchange, position, position, tradableThreshold);
          const notional = amount * price;
          if (amount >= tradableThreshold && notional >= notionalMin) {
            const previousBracket = openBracket;
            const order = await placeMarket(exchange, 'sell', amount);
            const executedAt = Date.now();
            openBracket = null;
            entryPrice = 0;
            lastTradeTs = executedAt;
            console.log(`[${hit}] exit @ ~${price}`);
            ({ equity, balances, mark } = await calculateEquity(exchange));
            position = await getPositionQty(exchange);
            event = hit === 'STOP' ? 'bracket-stop' : 'bracket-take';
            const details = extractOrderDetails(order);
            const metadata: Record<string, unknown> = {
              source: 'bracket',
              reason: hit,
              notional,
              previousBracket,
              amount,
              runtimeCfg: { ...runtimeCfg },
              thresholds: { ...thresholds },
            };
            if (details.info) {
              metadata.orderInfo = details.info;
            }
            await recordTrade({
              symbol: CFG.symbol,
              ts: executedAt,
              side: 'sell',
              amount,
              price,
              event,
              position,
              equity,
              orderId: details.orderId,
              clientOrderId: details.clientOrderId,
              metadata,
            });
            await publishSnapshot({
              price,
              signal,
              signals,
              position,
              entryPrice,
              openBracket,
              thresholds,
              equity,
              drawdown: (equity / dayStartEquity - 1) * 100,
              mark,
              balances,
              lastTradeTs,
              event,
              runtimeCfg,
              candleTs: latestTs,
              candle: latestCandle,
            });
            await sleep(SLEEP_DURATIONS.ON_ERROR);
            continue;
          }
          console.log(
            `[SKIP] Bracket exit size too small (amount=${amount}, notional=${notional}, minAmount=${tradableThreshold}, minNotional=${notionalMin})`
          );
          event = 'skip-bracket-size';
          await publishSnapshot({
            price,
            signal,
            signals,
            position,
            entryPrice,
            openBracket,
            thresholds,
            equity,
            drawdown: (equity / dayStartEquity - 1) * 100,
            mark,
            balances,
            lastTradeTs,
            event,
            runtimeCfg,
            candleTs: latestTs,
            candle: latestCandle,
          });
          await sleep(SLEEP_DURATIONS.ON_ERROR);
          continue;
        }
      }

      console.log(position);

      if (signal === 'LONG' && position < 1) {
        console.log('It is time to long');
        if (withinCooldown(lastTradeTs, runtimeCfg.cooldownMin)) {
          console.log('[COOLDOWN] Skip long');
          event = 'skip-cooldown';
          await publishSnapshot({
            price,
            signal,
            signals,
            position,
            entryPrice,
            openBracket,
            thresholds,
            equity,
            drawdown: (equity / dayStartEquity - 1) * 100,
            mark,
            balances,
            lastTradeTs,
            event,
            runtimeCfg,
          });
          await sleep(SLEEP_DURATIONS.ON_ERROR);
          continue;
        }
        ({ equity, balances, mark } = await calculateEquity(exchange));
        const eqQuote = equity; // 최신 평가금액
        const rawQty = sizeByRisk(eqQuote, price, runtimeCfg.riskPerTrade); // 위험 비율 기반 수량
        const amount = adjustAmountWithThreshold(toAmountPrecision, exchange, rawQty, tradableThreshold); // 거래소 정밀도에 맞춘 수량
        const notional = amount * price;
        console.log(
          `buying amount : ${amount}, price : ${price}, eqQuote : ${eqQuote}, rawQty : ${rawQty}, baseMin : ${baseMin}, minNotional : ${notionalMin}, notional : ${notional}`
        );
        if (amount >= tradableThreshold && notional >= notionalMin) {
          const order = await placeMarket(exchange, 'buy', amount);
          const executedAt = Date.now();
          entryPrice = price;
          openBracket = computeBracket(entryPrice, {
            stopPct: runtimeCfg.stopPct,
            takePct: runtimeCfg.takePct,
          });
          lastTradeTs = executedAt;
          console.log(`BUY ${amount} @ ~${price} bracket=${JSON.stringify(openBracket)}`);
          ({ equity, balances, mark } = await calculateEquity(exchange));
          position = await getPositionQty(exchange);
          event = 'buy';
          const details = extractOrderDetails(order);
          const metadata: Record<string, unknown> = {
            source: 'signal',
            signal,
            notional,
            runtimeCfg: { ...runtimeCfg },
            amountRequested: rawQty,
            thresholds: { ...thresholds },
          };
          if (details.info) {
            metadata.orderInfo = details.info;
          }
          await recordTrade({
            symbol: CFG.symbol,
            ts: executedAt,
            side: 'buy',
            amount,
            price,
            event,
            position,
            equity,
            orderId: details.orderId,
            clientOrderId: details.clientOrderId,
            metadata,
          });
          await publishSnapshot({
            price,
            signal,
            signals,
            position,
            entryPrice,
            openBracket,
            thresholds,
            equity,
            drawdown: (equity / dayStartEquity - 1) * 100,
            mark,
            balances,
            lastTradeTs,
            event,
            runtimeCfg,
            candleTs: latestTs,
            candle: latestCandle,
          });
        } else {
          console.log(
            `[SKIP] Long size too small (amount=${amount}, minAmount=${tradableThreshold}, notional=${notional}, minNotional=${notionalMin})`
          );
          event = 'skip-buy-size';
          await publishSnapshot({
            price,
            signal,
            signals,
            position,
            entryPrice,
            openBracket,
            thresholds,
            equity,
            drawdown: (equity / dayStartEquity - 1) * 100,
            mark,
            balances,
            lastTradeTs,
            event,
            runtimeCfg,
            candleTs: latestTs,
            candle: latestCandle,
          });
        }
      } else if (signal === 'EXIT' && position > 0) {
        let amount = Math.max(toAmountPrecision(exchange, position), 0);
        if (amount < tradableThreshold && position >= tradableThreshold) {
          amount = Math.max(toAmountPrecision(exchange, tradableThreshold), 0);
        } else if (amount > position) {
          amount = position;
        }
        amount = Math.max(toAmountPrecision(exchange, amount), 0);
        const notional = amount * price;
        if (amount >= tradableThreshold && notional >= notionalMin) {
          const order = await placeMarket(exchange, 'sell', amount);
          const executedAt = Date.now();
          openBracket = null;
          entryPrice = 0;
          lastTradeTs = executedAt;
          console.log(`EXIT @ ~${price}`);
          ({ equity, balances, mark } = await calculateEquity(exchange));
          event = 'exit';
          position = await getPositionQty(exchange);
          const details = extractOrderDetails(order);
          const metadata: Record<string, unknown> = {
            source: 'signal',
            signal,
            notional,
            thresholds: { ...thresholds },
            runtimeCfg: { ...runtimeCfg },
          };
          if (details.info) {
            metadata.orderInfo = details.info;
          }
          await recordTrade({
            symbol: CFG.symbol,
            ts: executedAt,
            side: 'sell',
            amount,
            price,
            event,
            position,
            equity,
            orderId: details.orderId,
            clientOrderId: details.clientOrderId,
            metadata,
          });
          await publishSnapshot({
            price,
            signal,
            signals,
            position,
            entryPrice,
            openBracket,
            thresholds,
            equity,
            drawdown: (equity / dayStartEquity - 1) * 100,
            mark,
            balances,
            lastTradeTs,
            event,
            runtimeCfg,
            candleTs: latestTs,
            candle: latestCandle,
          });
        } else {
          console.log(
            `[SKIP] Exit size too small (amount=${amount}, minAmount=${tradableThreshold}, notional=${notional}, minNotional=${notionalMin})`
          );
          event = 'skip-exit-size';
          await publishSnapshot({
            price,
            signal,
            signals,
            position,
            entryPrice,
            openBracket,
            thresholds,
            equity,
            drawdown: (equity / dayStartEquity - 1) * 100,
            mark,
            balances,
            lastTradeTs,
            event,
            runtimeCfg,
            candleTs: latestTs,
            candle: latestCandle,
          });
        }
      }

      if (event === 'idle') {
        await publishSnapshot({
          price,
          signal,
          signals,
          position,
          entryPrice,
          openBracket,
          thresholds,
          equity,
          drawdown: (equity / dayStartEquity - 1) * 100,
          mark,
          balances,
          lastTradeTs,
          event,
          runtimeCfg,
          candleTs: latestTs,
          candle: latestCandle,
        });
      }

      await sleep(SLEEP_DURATIONS.LOOP_INTERVAL);
    } catch (error) {
      console.dir(error);
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      console.error('Loop error:', message);
      await publishSnapshot({
        price: 0,
        signal: 'HOLD',
        signals: ['HOLD'],
        position: 0,
        entryPrice,
        openBracket,
        thresholds: { baseMin: 0, baseStep: 0, notionalMin: 0, tradable: 0 },
        equity: 0,
        drawdown: 0,
        mark: 0,
        balances: { quoteFree: 0, quoteTotal: 0, baseFree: 0, baseTotal: 0 },
        lastTradeTs,
        event: `error:${message}`,
        runtimeCfg,
        candleTs: Date.now(),
        candle: null,
      });
      await sleep(ERROR_HANDLING.INITIAL_BACKOFF_MS);
    }
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

loop().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
