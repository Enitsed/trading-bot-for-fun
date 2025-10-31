// utils/candle-parser.ts
// OHLCV 배열을 Candle 객체로 변환하는 유틸리티

import type { OHLCV } from 'ccxt';

/**
 * Strategy Candle 타입 (domain 패키지와 호환)
 * ts/vol 필드를 사용하는 형식
 */
export type StrategyCandle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
};

/**
 * Validate OHLC values for a single candle
 */
function isValidOHLC(open: number, high: number, low: number, close: number): boolean {
  // All values must be positive
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
    return false;
  }

  // High must be >= all other prices
  if (high < open || high < low || high < close) {
    return false;
  }

  // Low must be <= all other prices
  if (low > open || low > high || low > close) {
    return false;
  }

  return true;
}

/**
 * OHLCV 배열을 StrategyCandle 객체 배열로 변환
 * 유효하지 않은 데이터는 자동으로 건너뜀
 *
 * @param raw - CCXT에서 반환된 OHLCV 배열
 * @returns 변환된 StrategyCandle 배열
 */
export function parseOHLCVToCandles(raw: OHLCV[]): StrategyCandle[] {
  if (!Array.isArray(raw)) {
    throw new Error('parseOHLCVToCandles: input must be an array');
  }

  const candles: StrategyCandle[] = [];
  let skippedCount = 0;

  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 6) {
      skippedCount++;
      continue;
    }

    const ts = typeof row[0] === 'number' ? row[0] : Number(row[0]);
    const open = typeof row[1] === 'number' ? row[1] : Number(row[1]);
    const high = typeof row[2] === 'number' ? row[2] : Number(row[2]);
    const low = typeof row[3] === 'number' ? row[3] : Number(row[3]);
    const close = typeof row[4] === 'number' ? row[4] : Number(row[4]);
    const vol = typeof row[5] === 'number' ? row[5] : Number(row[5] ?? 0);

    // Check if all values are finite numbers
    if (
      !Number.isFinite(ts) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      !Number.isFinite(vol)
    ) {
      skippedCount++;
      continue;
    }

    // Validate OHLC relationship
    if (!isValidOHLC(open, high, low, close)) {
      skippedCount++;
      continue;
    }

    candles.push({ ts, open, high, low, close, vol });
  }

  if (skippedCount > 0 && skippedCount === raw.length) {
    throw new Error(`parseOHLCVToCandles: all ${raw.length} candles were invalid`);
  }

  return candles;
}
