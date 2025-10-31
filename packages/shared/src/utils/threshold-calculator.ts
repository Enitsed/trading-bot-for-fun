// utils/threshold-calculator.ts
// 거래 가능한 최소 수량을 계산하는 유틸리티

import { FLOATING_POINT_EPSILON } from '../constants/trading.js';

/**
 * 거래 가능한 최소 수량을 계산
 * baseMin, notionalMin, baseStep을 고려하여 실제 주문 가능한 최소 수량 반환
 *
 * @param baseMin - 거래소의 최소 주문 수량
 * @param notionalMin - 거래소의 최소 주문 금액 (0이면 무시)
 * @param baseStep - 수량 단위 (0 이하면 무시)
 * @param price - 현재 가격
 * @returns 거래 가능한 최소 수량
 * @throws Error if parameters are invalid
 */
export function calculateTradableThreshold(
  baseMin: number,
  notionalMin: number,
  baseStep: number,
  price: number
): number {
  // Validate inputs
  if (!Number.isFinite(baseMin) || baseMin < 0) {
    throw new Error(`Invalid baseMin: ${baseMin}. Must be a non-negative finite number.`);
  }

  if (!Number.isFinite(notionalMin) || notionalMin < 0) {
    throw new Error(`Invalid notionalMin: ${notionalMin}. Must be a non-negative finite number.`);
  }

  if (!Number.isFinite(baseStep) || baseStep < 0) {
    throw new Error(`Invalid baseStep: ${baseStep}. Must be a non-negative finite number.`);
  }

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid price: ${price}. Must be a positive finite number.`);
  }

  // 1. baseMin과 notionalMin 중 큰 값 선택
  const minQtyFromNotional = notionalMin > 0 ? notionalMin / price : 0;
  const thresholdRaw = Math.max(baseMin, minQtyFromNotional);

  // 2. baseStep이 있으면 스텝에 맞춰 올림
  if (baseStep > 0) {
    return Math.ceil((thresholdRaw - FLOATING_POINT_EPSILON) / baseStep) * baseStep;
  }

  return thresholdRaw;
}
