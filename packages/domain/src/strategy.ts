import { rsi } from './indicators.js';
import type { Candle, Signal, StrategyCfg } from './types.js';

/**
 * Generate RSI reversion signals for a candle series.
 * - Issues LONG when RSI crosses back above the entry threshold after dipping below.
 * - Issues EXIT when RSI is above the exit threshold while in position.
 */
export function rsiReversionSignals(candles: Candle[], cfg: StrategyCfg): Signal[] {
  const closes = candles.map((candle) => candle.close);
  const r = rsi(closes, cfg.rsiLen);
  const out: Signal[] = [];
  let wasBelow = false;

  for (let i = 0; i < candles.length; i++) {
    const rv = r[i];
    if (!Number.isFinite(rv)) {
      out.push('HOLD');
      continue;
    }
    if (rv < cfg.entry) wasBelow = true;
    if (wasBelow && rv >= cfg.entry) {
      out.push('LONG');
      wasBelow = false;
      continue;
    }
    if (rv >= cfg.exit) {
      out.push('EXIT');
      continue;
    }
    out.push('HOLD');
  }
  return out;
}
