import ccxt, { type Exchange, type OHLCV, type Order } from 'ccxt';
import { v4 as uuidv4 } from 'uuid';
import { CFG } from '@scalper/bot/infrastructure/config.js';

/**
 * Creates exchange instance and loads market metadata
 * @returns Connected exchange instance
 * @throws Error if exchange is unsupported, connection fails, or markets can't be loaded
 */
export async function connect(): Promise<Exchange> {
  const klass = (ccxt as Record<string, any>)[CFG.exchange];
  if (!klass) {
    throw new Error(`[EXCHANGE] Unsupported exchange: ${CFG.exchange}`);
  }

  let exchange: Exchange;
  try {
    exchange = new klass({
      apiKey: CFG.apiKey,
      secret: CFG.apiSecret,
      enableRateLimit: true,
      options: { adjustForTimeDifference: true },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[EXCHANGE] Failed to initialize exchange: ${message}`);
  }

  if (CFG.exchange === 'binance' && 'setSandboxMode' in exchange) {
    try {
      (exchange as any).setSandboxMode?.(CFG.useSandbox);
      console.log(`[EXCHANGE] Binance sandbox mode: ${CFG.useSandbox}`);
    } catch (error) {
      console.warn('[EXCHANGE] Failed to set sandbox mode:', error);
    }
  }

  // Load markets with retry
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await exchange.loadMarkets();

      // Verify markets were loaded
      if (!exchange.markets || Object.keys(exchange.markets).length === 0) {
        throw new Error('Markets loaded but no market data found');
      }

      // Verify target symbol exists
      if (!exchange.markets[CFG.symbol]) {
        throw new Error(`Symbol ${CFG.symbol} not found in exchange markets`);
      }

      console.log(`[EXCHANGE] Connected to ${CFG.exchange}. Markets loaded: ${Object.keys(exchange.markets).length}`);
      return exchange;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < 3) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.warn(`[EXCHANGE] loadMarkets attempt ${attempt}/3 failed: ${lastError.message}. Retrying in ${backoffMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw new Error(`[EXCHANGE] Failed to load markets after 3 attempts. Last error: ${lastError?.message}`);
}

/**
 * Fetches recent OHLCV candle data from exchange
 * @param exchange - Connected exchange instance
 * @param limit - Number of candles to fetch (default: 300)
 * @returns Array of OHLCV arrays [timestamp, open, high, low, close, volume]
 * @throws Error if fetch fails or data is invalid
 */
export async function fetchOHLCV(exchange: Exchange, limit = 300): Promise<OHLCV[]> {
  try {
    const ohlcv = await exchange.fetchOHLCV(CFG.symbol, CFG.timeframe, undefined, limit);

    // Validate response
    if (!Array.isArray(ohlcv)) {
      throw new Error('fetchOHLCV returned non-array response');
    }

    if (ohlcv.length === 0) {
      throw new Error('fetchOHLCV returned empty array');
    }

    // Validate first candle structure
    const first = ohlcv[0];
    if (!Array.isArray(first) || first.length < 6) {
      throw new Error('Invalid OHLCV candle structure');
    }

    // Validate data types
    if (!Number.isFinite(first[0]) || !Number.isFinite(first[1]) ||
        !Number.isFinite(first[2]) || !Number.isFinite(first[3]) ||
        !Number.isFinite(first[4]) || !Number.isFinite(first[5])) {
      throw new Error('OHLCV candle contains invalid numeric values');
    }

    return ohlcv;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[EXCHANGE] fetchOHLCV failed: ${message}`);
  }
}

// 전체 잔고 조회 (재사용 목적)
export async function fetchBalance(exchange: Exchange) {
  return exchange.fetchBalance();
}

/**
 * Places a market order (dry-run mode just logs)
 * @param exchange - Connected exchange instance
 * @param side - Order side ('buy' or 'sell')
 * @param amount - Order amount in base currency (must be > 0)
 * @returns Order object with id and clientOrderId
 * @throws Error if order placement fails or amount is invalid
 */
export async function placeMarket(
  exchange: Exchange,
  side: 'buy' | 'sell',
  amount: number
): Promise<Order | { id: string; clientOrderId: string }> {
  // Validate inputs
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`[EXCHANGE] Invalid order amount: ${amount}. Must be > 0`);
  }

  if (side !== 'buy' && side !== 'sell') {
    throw new Error(`[EXCHANGE] Invalid order side: ${side}. Must be 'buy' or 'sell'`);
  }

  const clientOrderId = uuidv4();

  if (CFG.dryRun) {
    console.log(`[DRY] ${side.toUpperCase()} ${amount} ${CFG.symbol}`);
    return { id: `dry-${clientOrderId}`, clientOrderId };
  }

  try {
    console.log(`[ORDER] ${side.toUpperCase()} ${amount} ${CFG.symbol} (clientOrderId: ${clientOrderId})`);
    const order = await exchange.createOrder(CFG.symbol, 'market', side, amount, undefined, { clientOrderId });

    // Validate order response
    if (!order || !order.id) {
      throw new Error('Order response missing id');
    }

    console.log(`[ORDER] Success - orderId: ${order.id}, status: ${order.status}`);
    return order;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[EXCHANGE] Failed to place ${side} order for ${amount}: ${message}`);
  }
}

// 보유 중인 베이스 자산 수량 추출
export async function getPositionQty(exchange: Exchange): Promise<number> {
  const balance = await exchange.fetchBalance();
  const market = exchange.market(CFG.symbol);
  const baseCode = typeof market?.base === 'string' ? market.base : CFG.base;
  const asset = balance[baseCode] ?? balance[CFG.base];
  const total = asset?.total;
  if (typeof total === 'number') {
    return total;
  }
  if (typeof asset?.free === 'number') {
    return asset.free;
  }
  return 0;
}

// 거래소의 최소 주문 수량과 스텝을 계산
export async function quotePrecision(
  exchange: Exchange
): Promise<{ baseMin: number; baseStep: number; notionalMin: number }> {
  const market = exchange.market(CFG.symbol);
  const lot = (market?.limits?.amount?.min ?? 0.00001) as number; // 최소 주문 수량
  const precision = typeof market?.precision?.amount === 'number' ? market.precision.amount : undefined;
  const filters = Array.isArray((market as any)?.info?.filters) ? (market as any).info.filters : [];
  const lotSize = filters?.find?.((f: any) => f?.filterType === 'LOT_SIZE');
  const stepFromFilter = lotSize?.stepSize !== undefined ? Number(lotSize.stepSize) : undefined;
  const step =
    (typeof stepFromFilter === 'number' && !Number.isNaN(stepFromFilter) && stepFromFilter > 0
      ? stepFromFilter
      : precision !== undefined
        ? Math.pow(10, -precision)
        : undefined) ?? 0.00001; // 수량 스텝
  const notionalFilter = filters?.find?.((f: any) => f?.filterType === 'MIN_NOTIONAL' || f?.filterType === 'NOTIONAL');
  const notionalFromFilter =
    notionalFilter?.minNotional ?? notionalFilter?.notional ?? notionalFilter?.minValue ?? notionalFilter?.minQty;
  const limitsAny = market?.limits as Record<string, any> | undefined;
  const costLimitMin = limitsAny?.cost?.min;
  const quoteLimitMin = limitsAny?.quote?.min;
  const notionalMinCandidate =
    typeof notionalFromFilter === 'string' ? Number(notionalFromFilter) : notionalFromFilter;
  const notionalMin =
    (typeof notionalMinCandidate === 'number' && !Number.isNaN(notionalMinCandidate) && notionalMinCandidate > 0
      ? notionalMinCandidate
      : typeof costLimitMin === 'number' && costLimitMin > 0
        ? costLimitMin
        : typeof quoteLimitMin === 'number' && quoteLimitMin > 0
          ? quoteLimitMin
        : 0) as number;
  return { baseMin: lot, baseStep: step, notionalMin };
}

// 거래소 정밀도에 맞춰 수량을 절삭
export function roundStep(amount: number, step: number): number {
  if (step <= 0) return amount;
  const scaled = Math.floor(amount / step + 1e-12) * step;
  return Number.isFinite(scaled) ? scaled : 0;
}

// 거래소 포맷에 맞춰 수량을 반올림
export function toAmountPrecision(exchange: Exchange, amount: number): number {
  const precise = exchange.amountToPrecision(CFG.symbol, amount);
  const numeric = typeof precise === 'string' ? Number(precise) : precise;
  return Number.isFinite(numeric) ? numeric : 0;
}
