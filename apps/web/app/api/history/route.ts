import { NextResponse } from 'next/server';
import { ensureDbConnection, Op, PriceTickModel, isUndefinedTableError, logMissingTable } from '@scalper/shared';
import type { HistoryCandle, LinePoint, HistoryTimeframe } from '@scalper/shared';

const MAX_HOURS = 24 * 180;

const PG_ENABLE = (process.env.PG_ENABLE || '').toLowerCase() === 'true';

const TIMEFRAME_MS: Record<HistoryTimeframe, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

const DEFAULT_TIMEFRAME: HistoryTimeframe = '1h';

type RawTick = {
  candleAt: Date | string;
  priceOpen: string | number;
  priceHigh: string | number;
  priceLow: string | number;
  priceClose: string | number;
  volume: string | number;
  equity: string | number | null;
};

type Bucket = HistoryCandle & {
  firstTs: number;
  lastTs: number;
  equity: number | null;
  equityTs: number;
};

function normalizeHours(param: string | null): number {
  if (!param) return 24;
  const parsed = Number(param);
  if (!Number.isFinite(parsed) || parsed <= 0) return 24;
  return Math.min(Math.floor(parsed), MAX_HOURS);
}

function resolveTimeframe(param: string | null): HistoryTimeframe {
  if (!param) return DEFAULT_TIMEFRAME;
  const key = param.toLowerCase();
  if (key === '5m' || key === '15m' || key === '1h' || key === '1d') {
    return key;
  }
  return DEFAULT_TIMEFRAME;
}

function quantizeToWindow(timestamp: number, windowMs: number): number {
  return Math.floor(timestamp / windowMs) * windowMs;
}

function aggregateByWindow(rows: RawTick[], windowMs: number): { candles: HistoryCandle[]; equitySeries: LinePoint[] } {
  const buckets = new Map<number, Bucket>();

  for (const row of rows) {
    const candleTs = new Date(row.candleAt).getTime();
    if (!Number.isFinite(candleTs)) continue;
    const open = toFinite(row.priceOpen);
    const high = toFinite(row.priceHigh);
    const low = toFinite(row.priceLow);
    const close = toFinite(row.priceClose);
    const volume = toFinite(row.volume);
    if (
      !isFiniteNumber(open) ||
      !isFiniteNumber(high) ||
      !isFiniteNumber(low) ||
      !isFiniteNumber(close) ||
      !isFiniteNumber(volume)
    ) {
      continue;
    }
    const bucketKey = quantizeToWindow(candleTs, windowMs);
    const existing = buckets.get(bucketKey);
    const equityValue = row.equity !== null ? toFinite(row.equity) : null;

    if (!existing) {
      buckets.set(bucketKey, {
        timestamp: bucketKey,
        open,
        high,
        low,
        close,
        volume,
        firstTs: candleTs,
        lastTs: candleTs,
        equity: isFiniteNumber(equityValue) ? equityValue : null,
        equityTs: isFiniteNumber(equityValue) ? candleTs : Number.NEGATIVE_INFINITY,
      });
      continue;
    }

    if (candleTs < existing.firstTs) {
      existing.firstTs = candleTs;
      existing.open = open;
    }
    if (candleTs > existing.lastTs) {
      existing.lastTs = candleTs;
      existing.close = close;
    }
    if (high > existing.high) {
      existing.high = high;
    }
    if (low < existing.low) {
      existing.low = low;
    }
    existing.volume += volume;

    if (isFiniteNumber(equityValue) && candleTs >= existing.equityTs) {
      existing.equity = equityValue;
      existing.equityTs = candleTs;
    }
  }

  const ordered = Array.from(buckets.values()).sort((a, b) => a.timestamp - b.timestamp);

  const candles = ordered.map(({ firstTs: _firstTs, lastTs: _lastTs, equity: _equity, equityTs: _eqTs, ...rest }) => rest);
  const equitySeries = ordered
    .filter((item) => Number.isFinite(item.equity))
    .map((item) => ({ timestamp: item.timestamp, value: item.equity as number }));

  return { candles, equitySeries };
}

function parseTimestamp(param: string | null): number | null {
  if (!param) return null;
  if (/^\d+$/.test(param)) {
    const value = Number(param);
    return Number.isFinite(value) ? value : null;
  }
  const date = new Date(param);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export async function GET(request: Request) {
  if (!PG_ENABLE) {
    return NextResponse.json({ ok: false, error: 'PG_DISABLED' }, { status: 503 });
  }

  const url = new URL(request.url);
  const hours = normalizeHours(url.searchParams.get('hours'));
  const timeframe = resolveTimeframe(url.searchParams.get('tf'));
  const windowMs = TIMEFRAME_MS[timeframe];
  const endParam = parseTimestamp(url.searchParams.get('end'));
  const startParam = parseTimestamp(url.searchParams.get('start'));

  let windowEnd = endParam ?? Date.now();
  let windowStart = startParam ?? windowEnd - hours * 60 * 60 * 1000;

  if (windowStart >= windowEnd) {
    windowStart = windowEnd - hours * 60 * 60 * 1000;
  }
  if (windowStart < 0) {
    windowStart = 0;
  }
  const maxRangeMs = MAX_HOURS * 60 * 60 * 1000;
  if (windowEnd - windowStart > maxRangeMs) {
    windowStart = windowEnd - maxRangeMs;
  }

  windowStart = Math.floor(windowStart);
  windowEnd = Math.floor(windowEnd);

  try {
    await ensureDbConnection();
    const rows = (await PriceTickModel.findAll({
      attributes: ['candleAt', 'priceOpen', 'priceHigh', 'priceLow', 'priceClose', 'volume', 'equity'],
      where: {
        candleAt: {
          [Op.gte]: new Date(windowStart),
          [Op.lt]: new Date(windowEnd),
        },
      },
      order: [['candle_at', 'ASC']],
      raw: true,
    })) as RawTick[];

    const { candles, equitySeries } = aggregateByWindow(rows, windowMs);

    const [prevResult, nextResult] = await Promise.all([
      PriceTickModel.findOne({
        attributes: ['id'],
        where: {
          candleAt: {
            [Op.lt]: new Date(windowStart),
          },
        },
        order: [['candle_at', 'DESC']],
      }),
      PriceTickModel.findOne({
        attributes: ['id'],
        where: {
          candleAt: {
            [Op.gte]: new Date(windowEnd),
          },
        },
        order: [['candle_at', 'ASC']],
      }),
    ]);

    const hasPrev = Boolean(prevResult);
    const hasNext = Boolean(nextResult);

    return NextResponse.json({
      ok: true,
      timeframe,
      candles,
      equity: equitySeries,
      windowStart,
      windowEnd,
      hasPrev,
      hasNext,
    });
  } catch (error) {
    if (isUndefinedTableError(error)) {
      logMissingTable('price_ticks');
      return NextResponse.json({ ok: false, error: 'DATA_UNAVAILABLE' }, { status: 503 });
    }
    console.error('[history] query failed', error);
    return NextResponse.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

function toFinite(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFiniteNumber(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
