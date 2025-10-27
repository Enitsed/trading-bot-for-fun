import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { Exchange } from 'ccxt';
import { connect, fetchOHLCV, getPositionQty, placeMarket, quotePrecision, toAmountPrecision } from './exchange.js';
import { rsiReversionSignals, type Candle, type Signal } from './strategy.js';
import { sizeByRisk, computeBracket, hitBracket, withinCooldown } from './risk.js';
import { CFG } from './config.js';

type BalanceSnapshot = {
  quoteFree: number;
  quoteTotal: number;
  baseFree: number;
  baseTotal: number;
};

type Snapshot = {
  timestamp: number;
  price: number;
  signal: Signal;
  recentSignals: Signal[];
  position: number;
  entryPrice: number;
  openBracket: ReturnType<typeof computeBracket> | null;
  thresholds: {
    baseMin: number;
    baseStep: number;
    notionalMin: number;
    tradable: number;
  };
  equity: number;
  drawdown: number;
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

type Command =
  | { id: string; type: 'manual-buy'; amount?: number; createdAt: number }
  | { id: string; type: 'manual-sell'; amount?: number; createdAt: number }
  | { id: string; type: 'flatten'; createdAt: number };

const RUNTIME_DIR = path.resolve(process.cwd(), 'runtime');
const SNAPSHOT_PATH = path.join(RUNTIME_DIR, 'telemetry.json');
const OVERRIDES_PATH = path.join(RUNTIME_DIR, 'overrides.json');
const COMMANDS_PATH = path.join(RUNTIME_DIR, 'commands.json');

const DEFAULT_RUNTIME_CFG: RuntimeCfg = {
  rsiLen: CFG.rsiLen,
  rsiEntry: CFG.rsiEntry,
  rsiExit: CFG.rsiExit,
  riskPerTrade: CFG.riskPerTrade,
  stopPct: CFG.stopPct,
  takePct: CFG.takePct,
  cooldownMin: CFG.cooldownMin,
};

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return null;
    console.warn(`[IO] ${filePath} read failed:`, error);
    return null;
  }
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
  return readJsonFile<RuntimeOverrides>(OVERRIDES_PATH);
}

async function consumeCommands(): Promise<Command[]> {
  const list = await readJsonFile<Command[]>(COMMANDS_PATH);
  if (!Array.isArray(list) || list.length === 0) return [];
  await mkdir(RUNTIME_DIR, { recursive: true });
  await writeFile(COMMANDS_PATH, '[]');
  return list;
}

async function writeSnapshot(snapshot: Snapshot) {
  await mkdir(RUNTIME_DIR, { recursive: true });
  await writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot));
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
    openBracket: ReturnType<typeof computeBracket> | null;
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
  openBracket: ReturnType<typeof computeBracket> | null;
  lastTradeTs: number | null;
  event: string;
}> {
  const { exchange, price, tradableThreshold, notionalMin, runtimeCfg } = ctx;
  let { position, entryPrice, openBracket, equity, balances, mark, lastTradeTs } = ctx;
  let event = `command:${command.type}`;

  const refreshState = async () => {
    const refreshed = await equityQuote(exchange);
    equity = refreshed.equity;
    balances = refreshed.balances;
    mark = refreshed.mark;
    position = await getPositionQty(exchange);
  };

  if (command.type === 'manual-buy') {
    const desired = typeof command.amount === 'number' && command.amount > 0 ? command.amount : tradableThreshold;
    let amount = Math.max(toAmountPrecision(exchange, desired), 0);
    if (amount < tradableThreshold && desired >= tradableThreshold) {
      amount = Math.max(toAmountPrecision(exchange, tradableThreshold), 0);
    }
    const notional = amount * price;
    if (amount >= tradableThreshold && notional >= notionalMin) {
      await placeMarket(exchange, 'buy', amount);
      entryPrice = price;
      openBracket = computeBracket(entryPrice, { stopPct: runtimeCfg.stopPct, takePct: runtimeCfg.takePct });
      lastTradeTs = Date.now();
      event = `manual-buy:${amount}`;
      await refreshState();
    } else {
      event = 'manual-buy-skip';
    }
  } else if (command.type === 'manual-sell') {
    if (position <= 0) {
      event = 'manual-sell-skip:no-position';
    } else {
      const desired =
        typeof command.amount === 'number' && command.amount > 0 ? Math.min(command.amount, position) : position;
      let amount = Math.max(toAmountPrecision(exchange, desired), 0);
      if (amount < tradableThreshold && position >= tradableThreshold) {
        amount = Math.max(toAmountPrecision(exchange, tradableThreshold), 0);
      } else if (amount > position) {
        amount = position;
      }
      amount = Math.max(toAmountPrecision(exchange, amount), 0);
      const notional = amount * price;
      if (amount > 0 && notional >= notionalMin) {
        await placeMarket(exchange, 'sell', amount);
        lastTradeTs = Date.now();
        if (amount >= position) {
          entryPrice = 0;
          openBracket = null;
        }
        event = `manual-sell:${amount}`;
        await refreshState();
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
        await placeMarket(exchange, 'sell', amount);
        lastTradeTs = Date.now();
        entryPrice = 0;
        openBracket = null;
        event = 'flatten';
        await refreshState();
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
  openBracket: ReturnType<typeof computeBracket> | null;
  thresholds: Snapshot['thresholds'];
  equity: number;
  drawdown: number;
  mark: number;
  balances: BalanceSnapshot;
  lastTradeTs: number | null;
  event: string;
  runtimeCfg: RuntimeCfg;
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
}

let lastTradeTs: number | null = null; // 마지막 체결 시각(ms)
let openBracket: ReturnType<typeof computeBracket> | null = null; // 현재 포지션의 스탑/익절 정보
let entryPrice = 0; // 현재 포지션 진입가

async function loop() {
  console.log('Loading exchange...');
  const exchange = await connect(); // ccxt 거래소 인스턴스
  console.log('Exchange loaded.');

  const { baseMin, baseStep, notionalMin } = await quotePrecision(exchange); // 최소 주문 수량과 스텝
  console.log(`Base min: ${baseMin}, step: ${baseStep}, notional min: ${notionalMin}`);
  const { equity: dayStartEquity } = await equityQuote(exchange); // 일 시작 시점 평가금액

  console.log(`Starting bot on ${CFG.exchange} ${CFG.symbol} (sandbox=${CFG.useSandbox})`);
  let lastBarTs = 0;
  let runtimeCfg: RuntimeCfg = { ...DEFAULT_RUNTIME_CFG };
  while (true) {
    try {
      const overrides = await loadOverrides();
      runtimeCfg = resolveRuntimeCfg(overrides);

      const raw = await fetchOHLCV(exchange, 300); // 최신 OHLCV 캔들
      const candles: Candle[] = raw.map((row) => ({
        ts: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        vol: Number(row[5]),
      }));
      const latestTs = candles.at(-1)?.ts ?? 0; // 가장 최근 캔들 시간
      if (latestTs === lastBarTs) {
        await sleep(30_000);
        continue;
      }
      lastBarTs = latestTs;

      let { equity, balances, mark } = await equityQuote(exchange); // 현재 평가금액 및 잔고
      const drawdown = (equity / dayStartEquity - 1) * 100; // 일일 손익률
      console.log(`Current equity: ${equity.toFixed(2)} (${drawdown.toFixed(2)}%)`);
      const signals = rsiReversionSignals(candles, {
        rsiLen: runtimeCfg.rsiLen,
        entry: runtimeCfg.rsiEntry,
        exit: runtimeCfg.rsiExit,
      });
      console.log(signals.slice(-10).reverse());
      const signal = signals.at(-1)!; // 최신 캔들에 대한 시그널
      const price = candles.at(-1)!.close; // 현재 종가
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
        });
        await sleep(60_000);
        continue;
      }

      if (position > 0 && openBracket) {
        const hit = hitBracket(price, openBracket);
        if (hit) {
          let amount = Math.max(toAmountPrecision(exchange, position), 0);
          if (amount < tradableThreshold && position >= tradableThreshold) {
            amount = Math.max(toAmountPrecision(exchange, tradableThreshold), 0);
          } else if (amount > position) {
            amount = position;
          }
          amount = Math.max(toAmountPrecision(exchange, amount), 0);
          const notional = amount * price;
          if (amount >= tradableThreshold && notional >= notionalMin) {
            await placeMarket(exchange, 'sell', amount);
            openBracket = null;
            entryPrice = 0;
            lastTradeTs = Date.now();
            console.log(`[${hit}] exit @ ~${price}`);
            ({ equity, balances, mark } = await equityQuote(exchange));
            position = await getPositionQty(exchange);
            event = hit === 'STOP' ? 'bracket-stop' : 'bracket-take';
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
            await sleep(5_000);
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
          });
          await sleep(5_000);
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
          await sleep(5_000);
          continue;
        }
        ({ equity, balances, mark } = await equityQuote(exchange));
        const eqQuote = equity; // 최신 평가금액
        const rawQty = sizeByRisk(eqQuote, price, runtimeCfg.riskPerTrade); // 위험 비율 기반 수량
        let amount = Math.max(toAmountPrecision(exchange, rawQty), 0); // 거래소 정밀도에 맞춘 수량
        if (amount < tradableThreshold && rawQty >= tradableThreshold) {
          amount = Math.max(toAmountPrecision(exchange, tradableThreshold), 0);
        }
        const notional = amount * price;
        console.log(
          `buying amount : ${amount}, price : ${price}, eqQuote : ${eqQuote}, rawQty : ${rawQty}, baseMin : ${baseMin}, minNotional : ${notionalMin}, notional : ${notional}`
        );
        if (amount >= tradableThreshold && notional >= notionalMin) {
          await placeMarket(exchange, 'buy', amount);
          entryPrice = price;
          openBracket = computeBracket(entryPrice, {
            stopPct: runtimeCfg.stopPct,
            takePct: runtimeCfg.takePct,
          });
          lastTradeTs = Date.now();
          console.log(`BUY ${amount} @ ~${price} bracket=${JSON.stringify(openBracket)}`);
          ({ equity, balances, mark } = await equityQuote(exchange));
          position = await getPositionQty(exchange);
          event = 'buy';
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
          await placeMarket(exchange, 'sell', amount);
          openBracket = null;
          entryPrice = 0;
          lastTradeTs = Date.now();
          console.log(`EXIT @ ~${price}`);
          ({ equity, balances, mark } = await equityQuote(exchange));
          event = 'exit';
          position = await getPositionQty(exchange);
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
        });
      }

      await sleep(30_000);
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
      });
      await sleep(10_000);
    }
  }
}

async function equityQuote(exchange: Exchange): Promise<{
  equity: number;
  balances: BalanceSnapshot;
  mark: number;
}> {
  const balance = await exchange.fetchBalance(); // 거래소 잔고
  const market = exchange.market(CFG.symbol);
  const quoteCode = typeof market?.quote === 'string' ? market.quote : CFG.quote;
  const baseCode = typeof market?.base === 'string' ? market.base : CFG.base;
  const quote = balance[quoteCode];
  const base = balance[baseCode];
  const quoteFree = typeof quote?.free === 'number' ? quote.free : typeof quote?.total === 'number' ? quote.total : 0;
  const quoteTotal = typeof quote?.total === 'number' ? quote.total : quoteFree;
  const baseFree = typeof base?.free === 'number' ? base.free : typeof base?.total === 'number' ? base.total : 0;
  const baseTotal = typeof base?.total === 'number' ? base.total : baseFree;
  console.log('Balance:', {
    QUOTE: { free: quoteFree, total: quoteTotal },
    BASE: { free: baseFree, total: baseTotal },
  });
  let mark = 0; // 베이스 자산 마킹 가격
  try {
    const ticker = await exchange.fetchTicker(CFG.symbol); // 최신 호가로 마킹
    mark = (ticker?.last ?? ticker?.close ?? 0) as number;
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    console.warn('Ticker fetch failed:', message);
  }
  const equity = quoteFree + baseTotal * (mark || 0);
  return {
    equity,
    balances: { quoteFree, quoteTotal, baseFree, baseTotal },
    mark,
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

loop().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
