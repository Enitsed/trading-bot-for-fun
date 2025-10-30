import ccxt, { type Exchange, type OHLCV, type Order } from 'ccxt';
import { v4 as uuidv4 } from 'uuid';
import { CFG } from '@scalper/bot/infrastructure/config.js';

/**
 * Binance 거래소 확장 인터페이스 (샌드박스 모드 지원)
 */
interface WithSandboxMode {
  setSandboxMode: (enable: boolean) => void;
}

/**
 * 타입 가드: setSandboxMode를 지원하는 거래소 확인
 */
function hasSandboxMode(exchange: Exchange): exchange is Exchange & WithSandboxMode {
  return 'setSandboxMode' in exchange && typeof (exchange as WithSandboxMode).setSandboxMode === 'function';
}

/**
 * Creates exchange instance and loads market metadata
 * @returns Connected exchange instance
 * @throws Error if exchange is unsupported, connection fails, or markets can't be loaded
 */
export async function connect(): Promise<Exchange> {
  // CCXT 동적 클래스 접근
  // Note: CCXT 라이브러리 구조상 타입 단언 필요
  const ExchangeClass = (ccxt as unknown as Record<string, new (config: unknown) => Exchange>)[CFG.exchange];

  if (!ExchangeClass) {
    throw new Error(`[EXCHANGE] Unsupported exchange: ${CFG.exchange}`);
  }

  let exchange: Exchange;
  try {
    exchange = new ExchangeClass({
      apiKey: CFG.apiKey,
      secret: CFG.apiSecret,
      enableRateLimit: true,
      options: { adjustForTimeDifference: true },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[EXCHANGE] Failed to initialize exchange: ${message}`);
  }

  // Binance 샌드박스 모드 설정
  if (CFG.exchange === 'binance' && hasSandboxMode(exchange)) {
    try {
      exchange.setSandboxMode(CFG.useSandbox);
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

/**
 * 거래소별 거래 제약 조건 타입
 */
type MarketInfo = {
  filters?: Array<{
    filterType?: string;
    stepSize?: string | number;
    minNotional?: string | number;
    notional?: string | number;
    minValue?: string | number;
    minQty?: string | number;
  }>;
};

type MarketWithInfo = {
  info?: MarketInfo;
  limits?: {
    amount?: { min?: number };
    cost?: { min?: number };
    quote?: { min?: number };
  };
  precision?: { amount?: number };
};

/**
 * 거래소의 최소 주문 수량과 스텝을 계산
 */
export async function quotePrecision(
  exchange: Exchange
): Promise<{ baseMin: number; baseStep: number; notionalMin: number }> {
  const market = exchange.market(CFG.symbol) as MarketWithInfo | undefined;

  // 1. 최소 주문 수량 (baseMin)
  const minOrderQuantity = market?.limits?.amount?.min ?? 0.00001;

  // 2. 수량 스텝 (baseStep) - LOT_SIZE 필터 우선, 없으면 precision 사용
  const quantityStep = extractQuantityStep(market);

  // 3. 최소 주문 금액 (notionalMin) - 필터 우선, 없으면 limits 사용
  const minNotional = extractMinNotional(market);

  return {
    baseMin: minOrderQuantity,
    baseStep: quantityStep,
    notionalMin: minNotional,
  };
}

/**
 * LOT_SIZE 필터 또는 precision에서 수량 스텝 추출
 */
function extractQuantityStep(market: MarketWithInfo | undefined): number {
  const DEFAULT_STEP = 0.00001;

  if (!market) {
    return DEFAULT_STEP;
  }

  // LOT_SIZE 필터에서 stepSize 추출 시도
  const filters = market.info?.filters ?? [];
  const lotSizeFilter = filters.find((f) => f.filterType === 'LOT_SIZE');

  if (lotSizeFilter?.stepSize !== undefined) {
    const stepSize = Number(lotSizeFilter.stepSize);
    if (Number.isFinite(stepSize) && stepSize > 0) {
      return stepSize;
    }
  }

  // precision에서 계산 시도
  const precision = market.precision?.amount;
  if (typeof precision === 'number') {
    return Math.pow(10, -precision);
  }

  return DEFAULT_STEP;
}

/**
 * MIN_NOTIONAL 필터 또는 limits에서 최소 주문 금액 추출
 */
function extractMinNotional(market: MarketWithInfo | undefined): number {
  if (!market) {
    return 0;
  }

  // 1. MIN_NOTIONAL 또는 NOTIONAL 필터에서 추출 시도
  const filters = market.info?.filters ?? [];
  const notionalFilter = filters.find(
    (f) => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL'
  );

  if (notionalFilter) {
    const value =
      notionalFilter.minNotional ??
      notionalFilter.notional ??
      notionalFilter.minValue ??
      notionalFilter.minQty;

    if (value !== undefined) {
      const numeric = typeof value === 'string' ? Number(value) : value;
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
      }
    }
  }

  // 2. limits.cost.min 확인
  const costMin = market.limits?.cost?.min;
  if (typeof costMin === 'number' && costMin > 0) {
    return costMin;
  }

  // 3. limits.quote.min 확인
  const quoteMin = market.limits?.quote?.min;
  if (typeof quoteMin === 'number' && quoteMin > 0) {
    return quoteMin;
  }

  return 0;
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
