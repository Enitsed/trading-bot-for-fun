import type { Candle, Bracket } from './types.js';

export type BracketParams = {
  stopPct: number;
  takePct: number;
};

export function sizeByRisk(equityQuote: number, price: number, riskPerTrade: number): number {
  if (!Number.isFinite(equityQuote) || equityQuote <= 0) return 0;
  if (!Number.isFinite(price) || price <= 0) return 0;
  const ratio = Number.isFinite(riskPerTrade) && riskPerTrade > 0 ? riskPerTrade : 0;
  if (ratio <= 0) return 0;
  const cash = equityQuote * ratio;
  return cash > 0 ? cash / price : 0;
}

export function computeBracket(entryPrice: number, params: BracketParams): Bracket {
  const stopPct = Number.isFinite(params.stopPct) && params.stopPct > 0 ? params.stopPct : 0;
  const takePct = Number.isFinite(params.takePct) && params.takePct > 0 ? params.takePct : 0;
  return {
    stop: stopPct > 0 ? entryPrice * (1 - stopPct) : entryPrice,
    take: takePct > 0 ? entryPrice * (1 + takePct) : entryPrice,
  };
}

export function hitBracket(price: number, bracket: Bracket): 'STOP' | 'TAKE' | null {
  if (bracket.stop && price <= bracket.stop) return 'STOP';
  if (bracket.take && price >= bracket.take) return 'TAKE';
  return null;
}

export function withinCooldown(lastTradeTs: number | null, cooldownMin: number): boolean {
  if (!lastTradeTs) return false;
  const coolMin = Number.isFinite(cooldownMin) && cooldownMin > 0 ? cooldownMin : 0;
  if (coolMin <= 0) return false;
  const ms = coolMin * 60 * 1000;
  return Date.now() - lastTradeTs < ms;
}

export function markToMarket(candle: Candle, cash: number, qty: number): number {
  return cash + qty * candle.close;
}
