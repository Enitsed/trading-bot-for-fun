import { sizeByRisk, computeBracket, hitBracket, withinCooldown, markToMarket } from '../risk.js';
import type { Candle } from '../types.js';

describe('sizeByRisk', () => {
  it('should calculate position size correctly', () => {
    const size = sizeByRisk(10000, 50000, 0.01);
    expect(size).toBe(0.002); // (10000 * 0.01) / 50000
  });

  it('should return 0 for invalid equity', () => {
    expect(sizeByRisk(0, 50000, 0.01)).toBe(0);
    expect(sizeByRisk(-1000, 50000, 0.01)).toBe(0);
    expect(sizeByRisk(NaN, 50000, 0.01)).toBe(0);
    expect(sizeByRisk(Infinity, 50000, 0.01)).toBe(0);
  });

  it('should return 0 for invalid price', () => {
    expect(sizeByRisk(10000, 0, 0.01)).toBe(0);
    expect(sizeByRisk(10000, -50000, 0.01)).toBe(0);
    expect(sizeByRisk(10000, NaN, 0.01)).toBe(0);
  });

  it('should return 0 for invalid riskPerTrade', () => {
    expect(sizeByRisk(10000, 50000, 0)).toBe(0);
    expect(sizeByRisk(10000, 50000, -0.01)).toBe(0);
    expect(sizeByRisk(10000, 50000, 1.5)).toBe(0);
    expect(sizeByRisk(10000, 50000, NaN)).toBe(0);
  });
});

describe('computeBracket', () => {
  it('should compute bracket prices correctly', () => {
    const bracket = computeBracket(50000, { stopPct: 0.01, takePct: 0.02 });
    expect(bracket.stop).toBe(49500); // 50000 * (1 - 0.01)
    expect(bracket.take).toBe(51000); // 50000 * (1 + 0.02)
  });

  it('should throw for invalid entryPrice', () => {
    expect(() => computeBracket(0, { stopPct: 0.01, takePct: 0.02 })).toThrow();
    expect(() => computeBracket(-50000, { stopPct: 0.01, takePct: 0.02 })).toThrow();
    expect(() => computeBracket(NaN, { stopPct: 0.01, takePct: 0.02 })).toThrow();
  });

  it('should throw for invalid stopPct', () => {
    expect(() => computeBracket(50000, { stopPct: 0, takePct: 0.02 })).toThrow();
    expect(() => computeBracket(50000, { stopPct: -0.01, takePct: 0.02 })).toThrow();
    expect(() => computeBracket(50000, { stopPct: 1.5, takePct: 0.02 })).toThrow();
  });

  it('should throw for invalid takePct', () => {
    expect(() => computeBracket(50000, { stopPct: 0.01, takePct: 0 })).toThrow();
    expect(() => computeBracket(50000, { stopPct: 0.01, takePct: -0.02 })).toThrow();
    expect(() => computeBracket(50000, { stopPct: 0.01, takePct: 1.5 })).toThrow();
  });

  it('should throw if stopPct >= takePct', () => {
    expect(() => computeBracket(50000, { stopPct: 0.02, takePct: 0.01 })).toThrow();
    expect(() => computeBracket(50000, { stopPct: 0.02, takePct: 0.02 })).toThrow();
  });
});

describe('hitBracket', () => {
  const bracket = { stop: 49500, take: 51000 };

  it('should return STOP when price hits stop', () => {
    expect(hitBracket(49500, bracket)).toBe('STOP');
    expect(hitBracket(49000, bracket)).toBe('STOP');
  });

  it('should return TAKE when price hits take', () => {
    expect(hitBracket(51000, bracket)).toBe('TAKE');
    expect(hitBracket(52000, bracket)).toBe('TAKE');
  });

  it('should return null when price is between brackets', () => {
    expect(hitBracket(50000, bracket)).toBe(null);
    expect(hitBracket(50500, bracket)).toBe(null);
  });

  it('should throw for invalid price', () => {
    expect(() => hitBracket(0, bracket)).toThrow();
    expect(() => hitBracket(-1000, bracket)).toThrow();
    expect(() => hitBracket(NaN, bracket)).toThrow();
  });

  it('should throw for invalid bracket', () => {
    expect(() => hitBracket(50000, { stop: 0, take: 51000 })).toThrow();
    expect(() => hitBracket(50000, { stop: 49500, take: 0 })).toThrow();
    expect(() => hitBracket(50000, { stop: 51000, take: 49500 })).toThrow(); // Inverted
  });
});

describe('withinCooldown', () => {
  it('should return false if lastTradeTs is null', () => {
    expect(withinCooldown(null, 10)).toBe(false);
  });

  it('should return false if cooldown is 0', () => {
    expect(withinCooldown(Date.now(), 0)).toBe(false);
  });

  it('should return true if within cooldown period', () => {
    const recentTrade = Date.now() - 5 * 60 * 1000; // 5 minutes ago
    expect(withinCooldown(recentTrade, 10)).toBe(true); // 10 min cooldown
  });

  it('should return false if outside cooldown period', () => {
    const oldTrade = Date.now() - 15 * 60 * 1000; // 15 minutes ago
    expect(withinCooldown(oldTrade, 10)).toBe(false); // 10 min cooldown
  });

  it('should handle invalid lastTradeTs', () => {
    expect(withinCooldown(0, 10)).toBe(false);
    expect(withinCooldown(-1000, 10)).toBe(false);
    expect(withinCooldown(NaN, 10)).toBe(false);
  });

  it('should handle future timestamp (clock skew)', () => {
    const futureTs = Date.now() + 1000;
    expect(withinCooldown(futureTs, 10)).toBe(false);
  });
});

describe('markToMarket', () => {
  const candle: Candle = {
    ts: Date.now(),
    open: 50000,
    high: 51000,
    low: 49000,
    close: 50500,
    vol: 100,
  };

  it('should calculate equity correctly', () => {
    const equity = markToMarket(candle, 1000, 0.1);
    expect(equity).toBe(6050); // 1000 + 0.1 * 50500
  });

  it('should handle zero position', () => {
    const equity = markToMarket(candle, 1000, 0);
    expect(equity).toBe(1000);
  });

  it('should handle negative cash', () => {
    const equity = markToMarket(candle, -500, 0.1);
    expect(equity).toBe(4550); // -500 + 0.1 * 50500
  });

  it('should throw for invalid candle close', () => {
    const invalidCandle = { ...candle, close: 0 };
    expect(() => markToMarket(invalidCandle, 1000, 0.1)).toThrow();
  });

  it('should throw for invalid cash', () => {
    expect(() => markToMarket(candle, NaN, 0.1)).toThrow();
  });

  it('should throw for invalid quantity', () => {
    expect(() => markToMarket(candle, 1000, NaN)).toThrow();
  });
});
