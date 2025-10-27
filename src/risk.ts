import type { Candle } from './strategy.js';
import { CFG } from './config.js';

export type Bracket = { stop?: number; take?: number }; // 손절/익절 가격을 담는 구조

// 총 평가금액과 가격을 이용해 위험 비율에 맞는 포지션 크기 계산
export function sizeByRisk(equityQuote: number, price: number, riskPerTrade = CFG.riskPerTrade): number {
  const ratio = Number.isFinite(riskPerTrade) && riskPerTrade > 0 ? riskPerTrade : CFG.riskPerTrade;
  const cash = equityQuote * ratio; // 이번 트레이드에 사용할 자본
  return cash / price;
}

// 진입가 기준으로 스탑/테이크 가격 계산
export function computeBracket(entryPrice: number, params?: { stopPct?: number; takePct?: number }): Bracket {
  const stopPct = params?.stopPct ?? CFG.stopPct;
  const takePct = params?.takePct ?? CFG.takePct;
  return {
    stop: entryPrice * (1 - stopPct),
    take: entryPrice * (1 + takePct),
  };
}

// 현재 가격이 스탑 또는 테이크에 도달했는지 판별
export function hitBracket(price: number, bracket: Bracket): 'STOP' | 'TAKE' | null {
  if (bracket.stop && price <= bracket.stop) return 'STOP';
  if (bracket.take && price >= bracket.take) return 'TAKE';
  return null;
}

// 마지막 체결 이후 쿨다운 시간이 지났는지 확인
export function withinCooldown(lastTradeTs: number | null, cooldownMin = CFG.cooldownMin): boolean {
  if (!lastTradeTs) return false;
  const coolMin = Number.isFinite(cooldownMin) && cooldownMin > 0 ? cooldownMin : CFG.cooldownMin;
  const ms = coolMin * 60 * 1000;
  return Date.now() - lastTradeTs < ms;
}

// 백테스트 시 간단히 평가금액을 계산하기 위한 헬퍼
export function markToMarket(candle: Candle, cash: number, qty: number): number {
  return cash + qty * candle.close;
}
