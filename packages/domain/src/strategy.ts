import { rsi } from './indicators.js';
import type { Candle, Signal, StrategyCfg } from './types.js';

/**
 * Generate RSI reversion signals for a candle series.
 *
 * Strategy logic:
 * - Issues LONG when RSI crosses back above the entry threshold after dipping below
 * - Issues EXIT when RSI is above the exit threshold while in position
 * - Issues HOLD in all other cases
 *
 * @param candles - Array of OHLCV candles (must not be empty)
 * @param cfg - Strategy configuration with RSI parameters
 * @param cfg.rsiLen - RSI period length (must be >= 2)
 * @param cfg.entry - RSI entry threshold (must be 0-100, typically 20-40 for oversold)
 * @param cfg.exit - RSI exit threshold (must be 0-100, must be > entry)
 * @returns Array of signals corresponding to each candle
 * @throws Error if validation fails
 *
 * Example:
 * - entry=30, exit=50
 * - RSI drops to 25 → wasBelow flag set
 * - RSI rises to 32 → LONG signal issued, wasBelow reset
 * - RSI rises to 55 → EXIT signal issued
 */
export function rsiReversionSignals(candles: Candle[], cfg: StrategyCfg): Signal[] {
  // Validate inputs
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('[STRATEGY] candles array must not be empty');
  }

  if (!Number.isFinite(cfg.rsiLen) || cfg.rsiLen < 2) {
    throw new Error(`[STRATEGY] cfg.rsiLen must be >= 2. Got: ${cfg.rsiLen}`);
  }

  if (!Number.isFinite(cfg.entry) || cfg.entry < 0 || cfg.entry > 100) {
    throw new Error(`[STRATEGY] cfg.entry must be 0-100. Got: ${cfg.entry}`);
  }

  if (!Number.isFinite(cfg.exit) || cfg.exit < 0 || cfg.exit > 100) {
    throw new Error(`[STRATEGY] cfg.exit must be 0-100. Got: ${cfg.exit}`);
  }

  if (cfg.entry >= cfg.exit) {
    throw new Error(
      `[STRATEGY] cfg.entry (${cfg.entry}) must be less than cfg.exit (${cfg.exit}) for LONG reversion strategy`
    );
  }

  // Validate candle data
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    if (!Number.isFinite(candle.close) || candle.close <= 0) {
      throw new Error(`[STRATEGY] Invalid close price at candle ${i}: ${candle.close}`);
    }
  }

  // Calculate RSI
  const closes = candles.map((candle) => candle.close);
  const r = rsi(closes, cfg.rsiLen);

  if (r.length !== candles.length) {
    throw new Error(
      `[STRATEGY] RSI calculation returned unexpected length. Expected ${candles.length}, got ${r.length}`
    );
  }

  // Generate signals
  const out: Signal[] = [];
  let wasBelow = false; // State machine: tracks if RSI dipped below entry threshold

  for (let i = 0; i < candles.length; i++) {
    const rv = r[i];

    // Handle NaN RSI (not enough data for calculation)
    if (!Number.isFinite(rv)) {
      out.push('HOLD');
      continue;
    }

    // Check if RSI dropped below entry threshold
    if (rv < cfg.entry) {
      wasBelow = true;
    }

    // Check for LONG signal: RSI crossed back above entry after being below
    if (wasBelow && rv >= cfg.entry) {
      out.push('LONG');
      wasBelow = false; // Reset state machine
      continue;
    }

    // Check for EXIT signal: RSI above exit threshold
    if (rv >= cfg.exit) {
      out.push('EXIT');
      continue;
    }

    // Default: no signal
    out.push('HOLD');
  }

  return out;
}
