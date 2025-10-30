// utils/amount-precision.ts
// 금액 정밀도 조정 유틸리티 - 코드 중복 제거

import type { Exchange } from 'ccxt';

/**
 * 거래소 정밀도에 맞춰 금액을 조정하고 임계값을 적용
 *
 * @param toAmountPrecision - 거래소별 정밀도 조정 함수
 * @param desiredAmount - 원하는 주문 수량
 * @param tradableThreshold - 최소 거래 가능 수량
 * @returns 조정된 주문 수량 (항상 >= 0)
 *
 * 로직:
 * 1. 원하는 수량을 거래소 정밀도에 맞춰 조정
 * 2. 조정 후 금액이 임계값보다 작지만 원래 desired가 임계값 이상이었다면
 *    -> 임계값으로 다시 조정 (반올림으로 인한 거래 불가 방지)
 */
export function adjustAmountWithThreshold(
  toAmountPrecision: (exchange: Exchange, amount: number) => number,
  exchange: Exchange,
  desiredAmount: number,
  tradableThreshold: number
): number {
  let amount = Math.max(toAmountPrecision(exchange, desiredAmount), 0);

  // 반올림으로 인해 임계값 아래로 떨어진 경우 임계값으로 조정
  if (amount < tradableThreshold && desiredAmount >= tradableThreshold) {
    amount = Math.max(toAmountPrecision(exchange, tradableThreshold), 0);
  }

  return amount;
}

/**
 * 주문 가능 여부 검증
 *
 * @param amount - 주문 수량
 * @param price - 현재 가격
 * @param tradableThreshold - 최소 거래 가능 수량
 * @param notionalMin - 최소 주문 금액 (USD 기준)
 * @returns 주문 가능 여부
 */
export function isOrderable(
  amount: number,
  price: number,
  tradableThreshold: number,
  notionalMin: number
): boolean {
  if (amount < tradableThreshold) {
    return false;
  }

  const notional = amount * price;
  return notional >= notionalMin;
}

/**
 * 수량을 포지션 크기로 제한
 *
 * @param toAmountPrecision - 거래소별 정밀도 조정 함수
 * @param exchange - 거래소 객체
 * @param desiredAmount - 원하는 수량
 * @param maxPosition - 최대 포지션 크기
 * @returns 제한된 수량
 */
export function capAmountToPosition(
  toAmountPrecision: (exchange: Exchange, amount: number) => number,
  exchange: Exchange,
  desiredAmount: number,
  maxPosition: number
): number {
  const amount = Math.max(toAmountPrecision(exchange, desiredAmount), 0);
  return Math.min(amount, maxPosition);
}

/**
 * 매도용 수량 조정 (포지션 제한 + 임계값 적용)
 *
 * @param toAmountPrecision - 거래소별 정밀도 조정 함수
 * @param exchange - 거래소 객체
 * @param desiredAmount - 원하는 매도 수량
 * @param currentPosition - 현재 보유 포지션
 * @param tradableThreshold - 최소 거래 가능 수량
 * @returns 조정된 매도 수량
 */
export function adjustSellAmount(
  toAmountPrecision: (exchange: Exchange, amount: number) => number,
  exchange: Exchange,
  desiredAmount: number,
  currentPosition: number,
  tradableThreshold: number
): number {
  let amount = Math.max(toAmountPrecision(exchange, desiredAmount), 0);

  // 임계값 조정
  if (amount < tradableThreshold && currentPosition >= tradableThreshold) {
    amount = Math.max(toAmountPrecision(exchange, tradableThreshold), 0);
  }
  // 포지션 초과 방지
  else if (amount > currentPosition) {
    amount = currentPosition;
  }

  // 최종 정밀도 조정
  amount = Math.max(toAmountPrecision(exchange, amount), 0);

  return amount;
}
