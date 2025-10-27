import ccxt, { type Exchange, type OHLCV, type Order } from 'ccxt';
// @ts-expect-error uuid 9.0 타입 정의가 wrapper.mjs에서 제대로 작동하지 않음
import { v4 as uuidv4 } from 'uuid';
import { CFG } from './config.js';

// 거래소 인스턴스를 생성하고 마켓 정보를 미리 로드
export async function connect(): Promise<Exchange> {
  const klass = (ccxt as Record<string, any>)[CFG.exchange]; // 선택된 거래소 클래스
  if (!klass) {
    throw new Error(`Unsupported exchange: ${CFG.exchange}`);
  }
  const exchange: Exchange = new klass({
    apiKey: CFG.apiKey,
    secret: CFG.apiSecret,
    enableRateLimit: true,
    options: { adjustForTimeDifference: true },
  });

  if (CFG.exchange === 'binance' && 'setSandboxMode' in exchange) {
    // Binance 테스트넷 지원 (타 거래소는 미지원)
    (exchange as any).setSandboxMode?.(CFG.useSandbox);
  }

  await exchange.loadMarkets(); // 마켓 메타데이터 로드
  return exchange;
}

// 최근 OHLCV 캔들 조회
export async function fetchOHLCV(exchange: Exchange, limit = 300): Promise<OHLCV[]> {
  return exchange.fetchOHLCV(CFG.symbol, CFG.timeframe, undefined, limit);
}

// 전체 잔고 조회 (재사용 목적)
export async function fetchBalance(exchange: Exchange) {
  return exchange.fetchBalance();
}

// 마켓가 주문 실행 (dry-run 모드면 로그만 출력)
export async function placeMarket(
  exchange: Exchange,
  side: 'buy' | 'sell',
  amount: number
): Promise<Order | { id: string; clientOrderId: string }> {
  const clientOrderId = uuidv4(); // 재시도 시 idempotent 하게 사용
  if (CFG.dryRun) {
    console.log(`[DRY] ${side.toUpperCase()} ${amount}`);
    return { id: `dry-${clientOrderId}`, clientOrderId };
  }
  console.log(`${side.toUpperCase()} ${amount}`);
  return exchange.createOrder(CFG.symbol, 'market', side, amount, undefined, { clientOrderId });
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
