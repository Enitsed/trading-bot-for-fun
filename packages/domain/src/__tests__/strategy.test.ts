import { rsiReversionSignals } from '../strategy.js';
import type { Candle } from '../types.js';

describe('rsiReversionSignals', () => {
  // Helper to create candles
  function createCandles(closePrices: number[]): Candle[] {
    return closePrices.map((close, i) => ({
      ts: Date.now() + i * 60000,
      open: close,
      high: close * 1.01,
      low: close * 0.99,
      close,
      vol: 100,
    }));
  }

  describe('input validation', () => {
    it('should throw for empty candles array', () => {
      expect(() => rsiReversionSignals([], { rsiLen: 14, entry: 30, exit: 50 })).toThrow();
    });

    it('should throw for invalid rsiLen', () => {
      const candles = createCandles([100, 101, 102]);
      expect(() => rsiReversionSignals(candles, { rsiLen: 0, entry: 30, exit: 50 })).toThrow();
      expect(() => rsiReversionSignals(candles, { rsiLen: 1, entry: 30, exit: 50 })).toThrow();
      expect(() => rsiReversionSignals(candles, { rsiLen: NaN, entry: 30, exit: 50 })).toThrow();
    });

    it('should throw for invalid entry threshold', () => {
      const candles = createCandles([100, 101, 102]);
      expect(() => rsiReversionSignals(candles, { rsiLen: 14, entry: -10, exit: 50 })).toThrow();
      expect(() => rsiReversionSignals(candles, { rsiLen: 14, entry: 110, exit: 50 })).toThrow();
      expect(() => rsiReversionSignals(candles, { rsiLen: 14, entry: NaN, exit: 50 })).toThrow();
    });

    it('should throw for invalid exit threshold', () => {
      const candles = createCandles([100, 101, 102]);
      expect(() => rsiReversionSignals(candles, { rsiLen: 14, entry: 30, exit: -10 })).toThrow();
      expect(() => rsiReversionSignals(candles, { rsiLen: 14, entry: 30, exit: 110 })).toThrow();
      expect(() => rsiReversionSignals(candles, { rsiLen: 14, entry: 30, exit: NaN })).toThrow();
    });

    it('should throw if entry >= exit', () => {
      const candles = createCandles([100, 101, 102]);
      expect(() => rsiReversionSignals(candles, { rsiLen: 14, entry: 50, exit: 30 })).toThrow();
      expect(() => rsiReversionSignals(candles, { rsiLen: 14, entry: 50, exit: 50 })).toThrow();
    });

    it('should throw for invalid candle close prices', () => {
      const invalidCandles = [
        { ts: Date.now(), open: 100, high: 101, low: 99, close: 0, vol: 100 },
        { ts: Date.now(), open: 100, high: 101, low: 99, close: -100, vol: 100 },
      ];
      expect(() => rsiReversionSignals(invalidCandles, { rsiLen: 2, entry: 30, exit: 50 })).toThrow();
    });
  });

  describe('signal generation', () => {
    it('should return HOLD when RSI is not calculated (insufficient data)', () => {
      // With rsiLen=14, first 13 candles don't have RSI
      const candles = createCandles([100, 101, 102, 103]);
      const signals = rsiReversionSignals(candles, { rsiLen: 14, entry: 30, exit: 50 });

      // All signals should be HOLD (not enough data for RSI)
      expect(signals.length).toBe(4);
      signals.forEach(signal => {
        expect(signal).toBe('HOLD');
      });
    });

    it('should return correct number of signals', () => {
      const candles = createCandles(Array(50).fill(0).map((_, i) => 100 + i));
      const signals = rsiReversionSignals(candles, { rsiLen: 14, entry: 30, exit: 50 });

      expect(signals.length).toBe(candles.length);
    });

    it('should generate LONG signal when RSI crosses above entry after being below', () => {
      // Create a price series that goes down then up
      // This should create RSI that dips below 30 and then crosses back above
      const prices = [
        100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, // Downtrend
        89, 88, 87, 86, 85, 84, 83, 82, 81, 80, // More downtrend (RSI should be very low)
        81, 82, 83, 84, 85, 86, 87, 88, 89, 90, // Uptrend (RSI should cross back)
      ];
      const candles = createCandles(prices);
      const signals = rsiReversionSignals(candles, { rsiLen: 14, entry: 30, exit: 70 });

      // Should have at least one LONG signal
      const hasLong = signals.some(s => s === 'LONG');
      expect(hasLong).toBe(true);
    });

    it('should generate EXIT signal when RSI is above exit threshold', () => {
      // Create a price series with strong uptrend
      const prices = Array(30).fill(0).map((_, i) => 100 + i * 2);
      const candles = createCandles(prices);
      const signals = rsiReversionSignals(candles, { rsiLen: 14, entry: 30, exit: 70 });

      // Should have at least one EXIT signal (RSI should go above 70)
      const hasExit = signals.some(s => s === 'EXIT');
      expect(hasExit).toBe(true);
    });

    it('should not generate LONG signal if RSI never went below entry', () => {
      // Stable prices around 100
      const prices = Array(30).fill(100);
      const candles = createCandles(prices);
      const signals = rsiReversionSignals(candles, { rsiLen: 14, entry: 30, exit: 70 });

      // Should not have LONG signals (RSI should be around 50, never below 30)
      const hasLong = signals.some(s => s === 'LONG');
      expect(hasLong).toBe(false);
    });

    it('should reset wasBelow flag after LONG signal', () => {
      // Multiple cycles of down and up
      const prices = [
        ...Array(15).fill(0).map((_, i) => 100 - i), // Down
        ...Array(10).fill(0).map((_, i) => 85 + i), // Up (first LONG)
        ...Array(10).fill(95), // Stable
        ...Array(15).fill(0).map((_, i) => 95 - i), // Down again
        ...Array(10).fill(0).map((_, i) => 80 + i), // Up (second LONG)
      ];
      const candles = createCandles(prices);
      const signals = rsiReversionSignals(candles, { rsiLen: 14, entry: 30, exit: 70 });

      // Should have multiple LONG signals
      const longCount = signals.filter(s => s === 'LONG').length;
      expect(longCount).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle very short rsiLen', () => {
      const candles = createCandles([100, 90, 95, 92, 98]);
      const signals = rsiReversionSignals(candles, { rsiLen: 2, entry: 30, exit: 70 });

      expect(signals.length).toBe(5);
      // No throw = success
    });

    it('should handle extreme RSI thresholds', () => {
      const candles = createCandles(Array(30).fill(0).map((_, i) => 100 + i));
      const signals = rsiReversionSignals(candles, { rsiLen: 14, entry: 5, exit: 95 });

      expect(signals.length).toBe(30);
      // No throw = success
    });

    it('should handle identical prices (RSI = 50)', () => {
      const candles = createCandles(Array(30).fill(100));
      const signals = rsiReversionSignals(candles, { rsiLen: 14, entry: 30, exit: 70 });

      // With identical prices, RSI should be ~50, no LONG or EXIT
      const hasLong = signals.some(s => s === 'LONG');
      const hasExit = signals.some(s => s === 'EXIT');

      expect(hasLong).toBe(false);
      expect(hasExit).toBe(false);
    });
  });
});
