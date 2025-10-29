import type { Candle, Bracket } from './types.js';

export type BracketParams = {
  stopPct: number;
  takePct: number;
};

/**
 * Calculates position size based on equity and risk parameters
 * @param equityQuote - Current equity in quote currency (must be > 0)
 * @param price - Current asset price (must be > 0)
 * @param riskPerTrade - Risk ratio per trade (must be 0 < x < 1)
 * @returns Position size in base currency, or 0 if inputs are invalid
 *
 * Formula: (equity * riskPerTrade) / price
 * Example: With $10,000 equity, $50,000 BTC price, 0.01 risk → 0.002 BTC position
 */
export function sizeByRisk(equityQuote: number, price: number, riskPerTrade: number): number {
  // Validate equity
  if (!Number.isFinite(equityQuote) || equityQuote <= 0) {
    console.warn(`[RISK] Invalid equity: ${equityQuote}. Must be > 0`);
    return 0;
  }

  // Validate price
  if (!Number.isFinite(price) || price <= 0) {
    console.warn(`[RISK] Invalid price: ${price}. Must be > 0`);
    return 0;
  }

  // Validate risk ratio
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
 * Computes stop-loss and take-profit bracket from entry price
 * @param entryPrice - Position entry price (must be > 0)
 * @param params - Bracket parameters with stopPct and takePct (both must be 0 < x < 1)
 * @returns Bracket with stop and take prices
 * @throws Error if entryPrice is invalid or stopPct >= takePct
 *
 * Example: Entry at $50,000, stopPct=0.01 (1%), takePct=0.02 (2%)
 * → stop=$49,500, take=$51,000
 */
export function computeBracket(entryPrice: number, params: BracketParams): Bracket {
  // Validate entry price
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error(`[RISK] Invalid entryPrice: ${entryPrice}. Must be > 0`);
  }

  // Validate stopPct
  if (!Number.isFinite(params.stopPct) || params.stopPct <= 0 || params.stopPct >= 1) {
    throw new Error(`[RISK] Invalid stopPct: ${params.stopPct}. Must be 0 < x < 1`);
  }

  // Validate takePct
  if (!Number.isFinite(params.takePct) || params.takePct <= 0 || params.takePct >= 1) {
    throw new Error(`[RISK] Invalid takePct: ${params.takePct}. Must be 0 < x < 1`);
  }

  // Validate that take is greater than stop for positive risk/reward
  if (params.stopPct >= params.takePct) {
    throw new Error(
      `[RISK] stopPct (${params.stopPct}) must be less than takePct (${params.takePct}) for positive risk/reward`
    );
  }

  const stopPrice = entryPrice * (1 - params.stopPct);
  const takePrice = entryPrice * (1 + params.takePct);

  // Sanity check calculated prices
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
 * Checks if current price has hit stop-loss or take-profit bracket
 * @param price - Current market price (must be > 0)
 * @param bracket - Stop and take price levels
 * @returns 'STOP' if stop hit, 'TAKE' if take hit, null otherwise
 * @throws Error if inputs are invalid or bracket is malformed
 *
 * Uses <= for stop and >= for take to ensure triggers fire
 */
export function hitBracket(price: number, bracket: Bracket): 'STOP' | 'TAKE' | null {
  // Validate price
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`[RISK] Invalid price: ${price}. Must be > 0`);
  }

  // Validate bracket
  if (!Number.isFinite(bracket.stop) || bracket.stop <= 0) {
    throw new Error(`[RISK] Invalid bracket.stop: ${bracket.stop}. Must be > 0`);
  }
  if (!Number.isFinite(bracket.take) || bracket.take <= 0) {
    throw new Error(`[RISK] Invalid bracket.take: ${bracket.take}. Must be > 0`);
  }

  // Validate bracket structure
  if (bracket.stop >= bracket.take) {
    throw new Error(
      `[RISK] Malformed bracket: stop (${bracket.stop}) must be < take (${bracket.take})`
    );
  }

  // Check if stop or take hit
  if (price <= bracket.stop) return 'STOP';
  if (price >= bracket.take) return 'TAKE';
  return null;
}

/**
 * Checks if a trade is within cooldown period
 * @param lastTradeTs - Timestamp of last trade in milliseconds (must be <= now)
 * @param cooldownMin - Cooldown period in minutes (must be >= 0)
 * @returns true if within cooldown, false otherwise
 */
export function withinCooldown(lastTradeTs: number | null, cooldownMin: number): boolean {
  if (!lastTradeTs) return false;

  // Validate lastTradeTs
  if (!Number.isFinite(lastTradeTs) || lastTradeTs <= 0) {
    console.warn(`[RISK] Invalid lastTradeTs: ${lastTradeTs}`);
    return false;
  }

  // Check for future timestamp (clock skew or error)
  const now = Date.now();
  if (lastTradeTs > now) {
    console.warn(`[RISK] lastTradeTs (${lastTradeTs}) is in the future. Current time: ${now}`);
    return false;
  }

  // Validate cooldown
  if (!Number.isFinite(cooldownMin) || cooldownMin < 0) {
    console.warn(`[RISK] Invalid cooldownMin: ${cooldownMin}. Must be >= 0`);
    return false;
  }

  if (cooldownMin === 0) return false;

  const cooldownMs = cooldownMin * 60 * 1000;
  return now - lastTradeTs < cooldownMs;
}

/**
 * Calculates mark-to-market equity value
 * @param candle - Current candle with close price
 * @param cash - Cash holdings in quote currency
 * @param qty - Base asset quantity
 * @returns Total equity in quote currency
 * @throws Error if candle.close is invalid
 */
export function markToMarket(candle: Candle, cash: number, qty: number): number {
  // Validate candle close price
  if (!Number.isFinite(candle.close) || candle.close <= 0) {
    throw new Error(`[RISK] Invalid candle.close: ${candle.close}. Must be > 0`);
  }

  // Validate cash
  if (!Number.isFinite(cash)) {
    throw new Error(`[RISK] Invalid cash: ${cash}. Must be finite number`);
  }

  // Validate qty
  if (!Number.isFinite(qty)) {
    throw new Error(`[RISK] Invalid qty: ${qty}. Must be finite number`);
  }

  const equity = cash + qty * candle.close;

  if (!Number.isFinite(equity)) {
    throw new Error(`[RISK] Calculated invalid equity: ${equity}`);
  }

  return equity;
}
