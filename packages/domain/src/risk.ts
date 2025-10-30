import type { Candle, Bracket } from './types.js';

export type BracketParams = {
  stopPct: number;
  takePct: number;
};

/**
 * 자산과 리스크 파라미터를 기반으로 포지션 크기 계산
 * @param equityQuote - 현재 자산 (quote 화폐 기준, 반드시 > 0)
 * @param price - 현재 자산 가격 (반드시 > 0)
 * @param riskPerTrade - 거래당 리스크 비율 (반드시 0 < x < 1)
 * @returns 기준 화폐 단위의 포지션 크기, 입력이 유효하지 않으면 0 반환
 *
 * 공식: (equity * riskPerTrade) / price
 * 예시: 자산 $10,000, BTC 가격 $50,000, 리스크 0.01 → 0.002 BTC 포지션
 */
export function sizeByRisk(equityQuote: number, price: number, riskPerTrade: number): number {
  // 자산 검증
  if (!Number.isFinite(equityQuote) || equityQuote <= 0) {
    console.warn(`[RISK] Invalid equity: ${equityQuote}. Must be > 0`);
    return 0;
  }

  // 가격 검증
  if (!Number.isFinite(price) || price <= 0) {
    console.warn(`[RISK] Invalid price: ${price}. Must be > 0`);
    return 0;
  }

  // 리스크 비율 검증
  if (!Number.isFinite(riskPerTrade) || riskPerTrade <= 0 || riskPerTrade >= 1) {
    console.warn(`[RISK] Invalid riskPerTrade: ${riskPerTrade}. Must be 0 < x < 1`);
    return 0;
  }

  const cash = equityQuote * riskPerTrade;
  const size = cash / price;

  if (!Number.isFinite(size) || size <= 0) {
    console.warn(`[RISK] Calculated invalid size: ${size}`);
    return 0;
  }

  return size;
}

/**
 * 진입 가격으로부터 손절/익절 브래킷 계산
 * @param entryPrice - 포지션 진입 가격 (반드시 > 0)
 * @param params - stopPct와 takePct를 포함한 브래킷 파라미터 (둘 다 0 < x < 1)
 * @returns 손절가와 익절가를 포함한 브래킷
 * @throws entryPrice가 유효하지 않거나 stopPct >= takePct이면 에러 발생
 *
 * 예시: 진입가 $50,000, stopPct=0.01 (1%), takePct=0.02 (2%)
 * → 손절가=$49,500, 익절가=$51,000
 */
export function computeBracket(entryPrice: number, params: BracketParams): Bracket {
  // 진입 가격 검증
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error(`[RISK] Invalid entryPrice: ${entryPrice}. Must be > 0`);
  }

  // 손절 비율 검증
  if (!Number.isFinite(params.stopPct) || params.stopPct <= 0 || params.stopPct >= 1) {
    throw new Error(`[RISK] Invalid stopPct: ${params.stopPct}. Must be 0 < x < 1`);
  }

  // 익절 비율 검증
  if (!Number.isFinite(params.takePct) || params.takePct <= 0 || params.takePct >= 1) {
    throw new Error(`[RISK] Invalid takePct: ${params.takePct}. Must be 0 < x < 1`);
  }

  // 익절이 손절보다 커야 양의 리스크/보상 비율
  if (params.stopPct >= params.takePct) {
    throw new Error(
      `[RISK] stopPct (${params.stopPct}) must be less than takePct (${params.takePct}) for positive risk/reward`
    );
  }

  const stopPrice = entryPrice * (1 - params.stopPct);
  const takePrice = entryPrice * (1 + params.takePct);

  // 계산된 가격 검증
  if (!Number.isFinite(stopPrice) || stopPrice <= 0) {
    throw new Error(`[RISK] Calculated invalid stop price: ${stopPrice}`);
  }
  if (!Number.isFinite(takePrice) || takePrice <= 0) {
    throw new Error(`[RISK] Calculated invalid take price: ${takePrice}`);
  }

  return {
    stop: stopPrice,
    take: takePrice,
  };
}

/**
 * 현재 가격이 손절/익절 브래킷에 도달했는지 확인
 * @param price - 현재 시장 가격 (반드시 > 0)
 * @param bracket - 손절가와 익절가 레벨
 * @returns 손절 도달 시 'STOP', 익절 도달 시 'TAKE', 그 외 null 반환
 * @throws 입력이 유효하지 않거나 브래킷이 잘못 구성되면 에러 발생
 *
 * 트리거 발동을 보장하기 위해 손절은 <=, 익절은 >= 사용
 */
export function hitBracket(price: number, bracket: Bracket): 'STOP' | 'TAKE' | null {
  // 가격 검증
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`[RISK] Invalid price: ${price}. Must be > 0`);
  }

  // 브래킷 검증
  if (!Number.isFinite(bracket.stop) || bracket.stop <= 0) {
    throw new Error(`[RISK] Invalid bracket.stop: ${bracket.stop}. Must be > 0`);
  }
  if (!Number.isFinite(bracket.take) || bracket.take <= 0) {
    throw new Error(`[RISK] Invalid bracket.take: ${bracket.take}. Must be > 0`);
  }

  // 브래킷 구조 검증
  if (bracket.stop >= bracket.take) {
    throw new Error(
      `[RISK] Malformed bracket: stop (${bracket.stop}) must be < take (${bracket.take})`
    );
  }

  // 손절/익절 도달 확인
  if (price <= bracket.stop) return 'STOP';
  if (price >= bracket.take) return 'TAKE';
  return null;
}

/**
 * 거래가 쿨다운 기간 내에 있는지 확인
 * @param lastTradeTs - 마지막 거래 타임스탬프 (밀리초, 반드시 <= 현재 시간)
 * @param cooldownMin - 쿨다운 기간 (분, 반드시 >= 0)
 * @returns 쿨다운 기간 내이면 true, 그 외 false
 */
export function withinCooldown(lastTradeTs: number | null, cooldownMin: number): boolean {
  if (!lastTradeTs) return false;

  // 마지막 거래 타임스탬프 검증
  if (!Number.isFinite(lastTradeTs) || lastTradeTs <= 0) {
    console.warn(`[RISK] Invalid lastTradeTs: ${lastTradeTs}`);
    return false;
  }

  // 미래 타임스탬프 확인 (시계 오차 또는 에러)
  const now = Date.now();
  if (lastTradeTs > now) {
    console.warn(`[RISK] lastTradeTs (${lastTradeTs}) is in the future. Current time: ${now}`);
    return false;
  }

  // 쿨다운 검증
  if (!Number.isFinite(cooldownMin) || cooldownMin < 0) {
    console.warn(`[RISK] Invalid cooldownMin: ${cooldownMin}. Must be >= 0`);
    return false;
  }

  if (cooldownMin === 0) return false;

  const cooldownMs = cooldownMin * 60 * 1000;
  return now - lastTradeTs < cooldownMs;
}

/**
 * 시가평가 기준 자산 가치 계산
 * @param candle - 종가를 포함한 현재 캔들
 * @param cash - quote 화폐 기준 현금 보유량
 * @param qty - base 자산 수량
 * @returns quote 화폐 기준 총 자산
 * @throws candle.close가 유효하지 않으면 에러 발생
 */
export function markToMarket(candle: Candle, cash: number, qty: number): number {
  // 캔들 종가 검증
  if (!Number.isFinite(candle.close) || candle.close <= 0) {
    throw new Error(`[RISK] Invalid candle.close: ${candle.close}. Must be > 0`);
  }

  // 현금 검증
  if (!Number.isFinite(cash)) {
    throw new Error(`[RISK] Invalid cash: ${cash}. Must be finite number`);
  }

  // 수량 검증
  if (!Number.isFinite(qty)) {
    throw new Error(`[RISK] Invalid qty: ${qty}. Must be finite number`);
  }

  const equity = cash + qty * candle.close;

  if (!Number.isFinite(equity)) {
    throw new Error(`[RISK] Calculated invalid equity: ${equity}`);
  }

  return equity;
}
