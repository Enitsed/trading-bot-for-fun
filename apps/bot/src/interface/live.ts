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
  FLOATING_POINT_EPSILON,
  parseOHLCVToCandles,
  calculateTradableThreshold,
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

/**
 * 루프 실행 컨텍스트 - publishSnapshot 호출 시 반복되는 데이터
 */
type LoopContext = {
  price: number;
  signal: Signal;
  signals: Signal[];
  position: number;
  entryPrice: number;
  openBracket: Bracket | null;
  thresholds: Snapshot['thresholds'];
  equity: number;
  dayStartEquity: number;
  mark: number;
  balances: BalanceSnapshot;
  lastTradeTs: number | null;
  runtimeCfg: RuntimeCfg;
  latestTs: number;
  latestCandle: Candle | null;
};

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

/**
 * Type guard for ManualActionType
 */
function isManualActionType(value: unknown): value is ManualActionType {
  return (
    typeof value === 'string' &&
    (value === 'manual-buy' || value === 'manual-sell' || value === 'flatten')
  );
}

async function consumeCommands(): Promise<Command[]> {
  const rows = await fetchPendingCommands();
  if (!rows.length) return [];
  await markCommandsProcessed(rows.map((row) => row.id));

  return rows
    .filter((row) => {
      if (!isManualActionType(row.type)) {
        console.warn(`[WARN] Invalid manual action type: ${row.type}, skipping command ${row.id}`);
        return false;
      }
      return true;
    })
    .map((row) => ({
      id: row.id,
      type: row.type as ManualActionType, // Safe now after filter
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

/**
 * 커맨드 핸들러의 공통 컨텍스트 타입
 */
type CommandContext = {
  exchange: Exchange;
  price: number;
  tradableThreshold: number;
  notionalMin: number;
  runtimeCfg: RuntimeCfg;
  thresholds: Snapshot['thresholds'];
};

/**
 * 커맨드 핸들러의 공통 상태 타입
 */
type CommandState = {
  equity: number;
  balances: BalanceSnapshot;
  mark: number;
  position: number;
  entryPrice: number;
  openBracket: Bracket | null;
  lastTradeTs: number | null;
};

/**
 * 커맨드 핸들러 반환 타입
 */
type CommandResult = CommandState & { event: string };

/**
 * 현재 상태를 거래소에서 새로고침
 */
async function refreshTradeState(exchange: Exchange): Promise<Omit<CommandState, 'entryPrice' | 'openBracket' | 'lastTradeTs'>> {
  const refreshed = await calculateEquity(exchange);
  const position = await getPositionQty(exchange);
  return {
    equity: refreshed.equity,
    balances: refreshed.balances,
    mark: refreshed.mark,
    position,
  };
}

/**
 * Manual buy 커맨드 처리
 */
async function handleManualBuy(
  command: Command,
  ctx: CommandContext,
  state: CommandState
): Promise<CommandResult> {
  const { exchange, price, tradableThreshold, notionalMin, runtimeCfg, thresholds } = ctx;
  let { position, entryPrice, openBracket, lastTradeTs, equity, balances, mark } = state;

  const desired = typeof command.amount === 'number' && command.amount > 0 ? command.amount : tradableThreshold;
  const amount = adjustAmountWithThreshold(toAmountPrecision, exchange, desired, tradableThreshold);
  const notional = amount * price;

  if (amount >= tradableThreshold && notional >= notionalMin) {
    const order = await placeMarket(exchange, 'buy', amount);
    const executedAt = Date.now();
    entryPrice = price;
    openBracket = computeBracket(entryPrice, { stopPct: runtimeCfg.stopPct, takePct: runtimeCfg.takePct });
    lastTradeTs = executedAt;

    const refreshed = await refreshTradeState(exchange);
    equity = refreshed.equity;
    balances = refreshed.balances;
    mark = refreshed.mark;
    position = refreshed.position;

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
      event: `manual-buy:${amount}`,
      position,
      equity,
      orderId: details.orderId,
      clientOrderId: details.clientOrderId,
      metadata,
    });

    return { equity, balances, mark, position, entryPrice, openBracket, lastTradeTs, event: `manual-buy:${amount}` };
  }

  return { ...state, event: 'manual-buy-skip' };
}

/**
 * Manual sell 커맨드 처리
 */
async function handleManualSell(
  command: Command,
  ctx: CommandContext,
  state: CommandState
): Promise<CommandResult> {
  const { exchange, price, tradableThreshold, notionalMin, runtimeCfg, thresholds } = ctx;
  let { position, entryPrice, openBracket, lastTradeTs, equity, balances, mark } = state;

  if (position <= 0) {
    return { ...state, event: 'manual-sell-skip:no-position' };
  }

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

    const refreshed = await refreshTradeState(exchange);
    equity = refreshed.equity;
    balances = refreshed.balances;
    mark = refreshed.mark;
    position = refreshed.position;

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
      event: `manual-sell:${amount}`,
      position,
      equity,
      orderId: details.orderId,
      clientOrderId: details.clientOrderId,
      metadata,
    });

    return { equity, balances, mark, position, entryPrice, openBracket, lastTradeTs, event: `manual-sell:${amount}` };
  }

  return { ...state, event: 'manual-sell-skip:size' };
}

/**
 * Flatten 커맨드 처리 (포지션 전체 청산)
 */
async function handleFlatten(
  command: Command,
  ctx: CommandContext,
  state: CommandState
): Promise<CommandResult> {
  const { exchange, price, tradableThreshold, notionalMin, runtimeCfg, thresholds } = ctx;
  let { position, equity, balances, mark, lastTradeTs } = state;

  if (position <= 0) {
    return { ...state, event: 'flatten-skip:no-position' };
  }

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

    const refreshed = await refreshTradeState(exchange);
    equity = refreshed.equity;
    balances = refreshed.balances;
    mark = refreshed.mark;
    position = refreshed.position;

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
      event: 'flatten',
      position,
      equity,
      orderId: details.orderId,
      clientOrderId: details.clientOrderId,
      metadata,
    });

    return {
      equity,
      balances,
      mark,
      position,
      entryPrice: 0,
      openBracket: null,
      lastTradeTs,
      event: 'flatten',
    };
  }

  return { ...state, event: 'flatten-skip:size' };
}

/**
 * 커맨드 처리 - 작은 함수들로 위임
 */
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
): Promise<CommandResult> {
  const commandCtx: CommandContext = {
    exchange: ctx.exchange,
    price: ctx.price,
    tradableThreshold: ctx.tradableThreshold,
    notionalMin: ctx.notionalMin,
    runtimeCfg: ctx.runtimeCfg,
    thresholds: ctx.thresholds,
  };

  const state: CommandState = {
    equity: ctx.equity,
    balances: ctx.balances,
    mark: ctx.mark,
    position: ctx.position,
    entryPrice: ctx.entryPrice,
    openBracket: ctx.openBracket,
    lastTradeTs: ctx.lastTradeTs,
  };

  if (command.type === 'manual-buy') {
    return await handleManualBuy(command, commandCtx, state);
  } else if (command.type === 'manual-sell') {
    return await handleManualSell(command, commandCtx, state);
  } else if (command.type === 'flatten') {
    return await handleFlatten(command, commandCtx, state);
  }

  return { ...state, event: `unknown-command:${command.type}` };
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

/**
 * 현재 상태를 스냅샷으로 기록하는 헬퍼 함수
 * publishSnapshot 호출의 중복을 제거
 */
async function publishCurrentState(event: string, context: LoopContext) {
  const drawdown = (context.equity / context.dayStartEquity - 1) * 100;
  await publishSnapshot({
    price: context.price,
    signal: context.signal,
    signals: context.signals,
    position: context.position,
    entryPrice: context.entryPrice,
    openBracket: context.openBracket,
    thresholds: context.thresholds,
    equity: context.equity,
    drawdown,
    mark: context.mark,
    balances: context.balances,
    lastTradeTs: context.lastTradeTs,
    event,
    runtimeCfg: context.runtimeCfg,
    candleTs: context.latestTs,
    candle: context.latestCandle,
  });
}

/**
 * 신호 핸들러 결과 타입
 */
type SignalHandlerResult = {
  handled: boolean; // 핸들러가 액션을 취했는지
  shouldContinue: boolean; // 메인 loop를 continue해야 하는지
  position: number;
  entryPrice: number;
  openBracket: Bracket | null;
  lastTradeTs: number | null;
  equity: number;
  balances: BalanceSnapshot;
  mark: number;
};

/**
 * Bracket hit (손절/익절) 처리
 */
async function handleBracketHit(
  context: LoopContext,
  exchange: Exchange,
  tradableThreshold: number,
  notionalMin: number,
  baseMin: number
): Promise<SignalHandlerResult | null> {
  const { position, openBracket, price, thresholds, runtimeCfg, signal, signals, dayStartEquity, latestTs, latestCandle } = context;
  let { entryPrice, lastTradeTs, equity, balances, mark } = context;

  if (position <= 0 || !openBracket) {
    return null; // No bracket to check
  }

  const hit = hitBracket(price, openBracket);
  if (!hit) {
    return null; // Bracket not hit
  }

  const amount = adjustSellAmount(toAmountPrecision, exchange, position, position, tradableThreshold);
  const notional = amount * price;

  if (amount >= tradableThreshold && notional >= notionalMin) {
    const previousBracket = openBracket;
    const order = await placeMarket(exchange, 'sell', amount);
    const executedAt = Date.now();
    const newOpenBracket = null;
    const newEntryPrice = 0;
    lastTradeTs = executedAt;

    console.log(`[${hit}] exit @ ~${price}`);

    const refreshed = await refreshTradeState(exchange);
    equity = refreshed.equity;
    balances = refreshed.balances;
    mark = refreshed.mark;
    const newPosition = refreshed.position;

    const event = hit === 'STOP' ? 'bracket-stop' : 'bracket-take';
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
      position: newPosition,
      equity,
      orderId: details.orderId,
      clientOrderId: details.clientOrderId,
      metadata,
    });

    await publishCurrentState(event, {
      ...context,
      position: newPosition,
      entryPrice: newEntryPrice,
      openBracket: newOpenBracket,
      equity,
      balances,
      mark,
      lastTradeTs,
    });

    await sleep(SLEEP_DURATIONS.ON_ERROR);

    return {
      handled: true,
      shouldContinue: true,
      position: newPosition,
      entryPrice: newEntryPrice,
      openBracket: newOpenBracket,
      lastTradeTs,
      equity,
      balances,
      mark,
    };
  }

  // Size too small
  console.log(
    `[SKIP] Bracket exit size too small (amount=${amount}, notional=${notional}, minAmount=${tradableThreshold}, minNotional=${notionalMin})`
  );

  await publishCurrentState('skip-bracket-size', context);
  await sleep(SLEEP_DURATIONS.ON_ERROR);

  return {
    handled: true,
    shouldContinue: true,
    position,
    entryPrice,
    openBracket,
    lastTradeTs,
    equity,
    balances,
    mark,
  };
}

/**
 * 매수 신호 처리
 */
async function handleBuySignal(
  context: LoopContext,
  exchange: Exchange,
  tradableThreshold: number,
  notionalMin: number,
  baseMin: number
): Promise<SignalHandlerResult | null> {
  const { signal, position, price, thresholds, runtimeCfg, dayStartEquity } = context;
  let { lastTradeTs, entryPrice, openBracket, equity, balances, mark } = context;

  if (signal !== 'LONG' || position >= 1) {
    return null; // Not a buy signal or already in position
  }

  console.log('It is time to long');

  // Check cooldown
  if (withinCooldown(lastTradeTs, runtimeCfg.cooldownMin)) {
    console.log('[COOLDOWN] Skip long');
    await publishCurrentState('skip-cooldown', context);
    await sleep(SLEEP_DURATIONS.ON_ERROR);

    return {
      handled: true,
      shouldContinue: true,
      position,
      entryPrice,
      openBracket,
      lastTradeTs,
      equity,
      balances,
      mark,
    };
  }

  // Refresh equity before calculating size
  const refreshed = await refreshTradeState(exchange);
  equity = refreshed.equity;
  balances = refreshed.balances;
  mark = refreshed.mark;

  const eqQuote = equity;
  const rawQty = sizeByRisk(eqQuote, price, runtimeCfg.riskPerTrade);
  const amount = adjustAmountWithThreshold(toAmountPrecision, exchange, rawQty, tradableThreshold);
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

    const refreshedAfter = await refreshTradeState(exchange);
    equity = refreshedAfter.equity;
    balances = refreshedAfter.balances;
    mark = refreshedAfter.mark;
    const newPosition = refreshedAfter.position;

    const event = 'buy';
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
      position: newPosition,
      equity,
      orderId: details.orderId,
      clientOrderId: details.clientOrderId,
      metadata,
    });

    await publishCurrentState(event, {
      ...context,
      position: newPosition,
      entryPrice,
      openBracket,
      equity,
      balances,
      mark,
      lastTradeTs,
    });

    return {
      handled: true,
      shouldContinue: false,
      position: newPosition,
      entryPrice,
      openBracket,
      lastTradeTs,
      equity,
      balances,
      mark,
    };
  }

  // Size too small
  console.log(
    `[SKIP] Long size too small (amount=${amount}, minAmount=${tradableThreshold}, notional=${notional}, minNotional=${notionalMin})`
  );

  await publishCurrentState('skip-buy-size', context);

  return {
    handled: true,
    shouldContinue: false,
    position,
    entryPrice,
    openBracket,
    lastTradeTs,
    equity,
    balances,
    mark,
  };
}

/**
 * 청산 신호 처리
 */
async function handleExitSignal(
  context: LoopContext,
  exchange: Exchange,
  tradableThreshold: number,
  notionalMin: number
): Promise<SignalHandlerResult | null> {
  const { signal, position, price, thresholds, runtimeCfg } = context;
  let { lastTradeTs, equity, balances, mark } = context;

  if (signal !== 'EXIT' || position <= 0) {
    return null; // Not an exit signal or no position
  }

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
    const newOpenBracket = null;
    const newEntryPrice = 0;
    lastTradeTs = executedAt;

    console.log(`EXIT @ ~${price}`);

    const refreshed = await refreshTradeState(exchange);
    equity = refreshed.equity;
    balances = refreshed.balances;
    mark = refreshed.mark;
    const newPosition = refreshed.position;

    const event = 'exit';
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
      position: newPosition,
      equity,
      orderId: details.orderId,
      clientOrderId: details.clientOrderId,
      metadata,
    });

    await publishCurrentState(event, {
      ...context,
      position: newPosition,
      entryPrice: newEntryPrice,
      openBracket: newOpenBracket,
      equity,
      balances,
      mark,
      lastTradeTs,
    });

    return {
      handled: true,
      shouldContinue: false,
      position: newPosition,
      entryPrice: newEntryPrice,
      openBracket: newOpenBracket,
      lastTradeTs,
      equity,
      balances,
      mark,
    };
  }

  // Size too small
  console.log(
    `[SKIP] Exit size too small (amount=${amount}, minAmount=${tradableThreshold}, notional=${notional}, minNotional=${notionalMin})`
  );

  await publishCurrentState('skip-exit-size', context);

  return {
    handled: true,
    shouldContinue: false,
    position,
    entryPrice: context.entryPrice,
    openBracket: context.openBracket,
    lastTradeTs,
    equity,
    balances,
    mark,
  };
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
      const candles = parseOHLCVToCandles(raw);
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
      const tradableThreshold = calculateTradableThreshold(baseMin, notionalMin, baseStep, price);
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
        const loopContext: LoopContext = {
          price,
          signal,
          signals,
          position,
          entryPrice,
          openBracket,
          thresholds,
          equity,
          dayStartEquity,
          mark,
          balances,
          lastTradeTs,
          runtimeCfg,
          latestTs,
          latestCandle,
        };
        await publishCurrentState('halt-drawdown', loopContext);
        await sleep(SLEEP_DURATIONS.LONG_WAIT);
        continue;
      }

      // Loop context for signal handlers
      const loopContext: LoopContext = {
        price,
        signal,
        signals,
        position,
        entryPrice,
        openBracket,
        thresholds,
        equity,
        dayStartEquity,
        mark,
        balances,
        lastTradeTs,
        runtimeCfg,
        latestTs,
        latestCandle,
      };

      // Check bracket hit (stop/take profit)
      const bracketResult = await handleBracketHit(loopContext, exchange, tradableThreshold, notionalMin, baseMin);
      if (bracketResult) {
        position = bracketResult.position;
        entryPrice = bracketResult.entryPrice;
        openBracket = bracketResult.openBracket;
        lastTradeTs = bracketResult.lastTradeTs;
        equity = bracketResult.equity;
        balances = bracketResult.balances;
        mark = bracketResult.mark;
        if (bracketResult.shouldContinue) {
          continue;
        }
      }

      console.log(position);

      // Update loop context with latest state
      loopContext.position = position;
      loopContext.entryPrice = entryPrice;
      loopContext.openBracket = openBracket;
      loopContext.equity = equity;
      loopContext.balances = balances;
      loopContext.mark = mark;
      loopContext.lastTradeTs = lastTradeTs;

      // Handle buy signal
      const buyResult = await handleBuySignal(loopContext, exchange, tradableThreshold, notionalMin, baseMin);
      if (buyResult) {
        position = buyResult.position;
        entryPrice = buyResult.entryPrice;
        openBracket = buyResult.openBracket;
        lastTradeTs = buyResult.lastTradeTs;
        equity = buyResult.equity;
        balances = buyResult.balances;
        mark = buyResult.mark;
        if (buyResult.shouldContinue) {
          continue;
        }
      } else {
        // Handle exit signal if buy didn't trigger
        const exitResult = await handleExitSignal(loopContext, exchange, tradableThreshold, notionalMin);
        if (exitResult) {
          position = exitResult.position;
          entryPrice = exitResult.entryPrice;
          openBracket = exitResult.openBracket;
          lastTradeTs = exitResult.lastTradeTs;
          equity = exitResult.equity;
          balances = exitResult.balances;
          mark = exitResult.mark;
          if (exitResult.shouldContinue) {
            continue;
          }
        }
      }

      // Update final loop context state
      loopContext.position = position;
      loopContext.entryPrice = entryPrice;
      loopContext.openBracket = openBracket;
      loopContext.equity = equity;
      loopContext.balances = balances;
      loopContext.mark = mark;
      loopContext.lastTradeTs = lastTradeTs;

      // Publish idle state if no handler took action
      if (event === 'idle') {
        await publishCurrentState('idle', loopContext);
      }

      await sleep(SLEEP_DURATIONS.LOOP_INTERVAL);
    } catch (error) {
      // Structured error logging
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      const stack = error instanceof Error ? error.stack : undefined;

      console.error('[LOOP_ERROR] Trading loop encountered an error', {
        message,
        stack,
        timestamp: new Date().toISOString(),
        symbol: CFG.symbol,
        exchange: CFG.exchange,
      });

      // Error state snapshot
      const errorContext: LoopContext = {
        price: 0,
        signal: 'HOLD',
        signals: ['HOLD'],
        position: 0,
        entryPrice,
        openBracket,
        thresholds: { baseMin: 0, baseStep: 0, notionalMin: 0, tradable: 0 },
        equity: 0,
        dayStartEquity,
        mark: 0,
        balances: { quoteFree: 0, quoteTotal: 0, baseFree: 0, baseTotal: 0 },
        lastTradeTs,
        runtimeCfg,
        latestTs: Date.now(),
        latestCandle: null,
      };
      await publishCurrentState(`error:${message}`, errorContext);
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
