import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import type { HistoryCandle, LinePoint, HistoryTimeframe } from '@scalper/shared';

const MAX_HOURS = 24 * 180;
let pool: Pool | null = null;

const PG_ENABLE = (process.env.PG_ENABLE || '').toLowerCase() === 'true';
const PG_URL = process.env.PG_URL || '';
const PG_HOST = process.env.PG_HOST || '127.0.0.1';
const PG_PORT = Number(process.env.PG_PORT || '5432');
const PG_USER = process.env.PG_USER || 'postgres';
const PG_PASSWORD = process.env.PG_PASSWORD || '';
const PG_DATABASE = process.env.PG_DATABASE || 'scalper';

const TIMEFRAME_MS: Record<HistoryTimeframe, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

const DEFAULT_TIMEFRAME: HistoryTimeframe = '1h';

type RawTick = {
  candle_at: string;
  price_open: string;
  price_high: string;
  price_low: string;
  price_close: string;
  volume: string;
  equity: string | null;
};

type Bucket = HistoryCandle & {
  firstTs: number;
  lastTs: number;
  equity: number | null;
  equityTs: number;
};

function ensurePool(): Pool {
  if (!pool) {
    if (!PG_ENABLE) {
      throw new Error('PG_DISABLED');
    }
    const hasUrl = PG_URL && PG_URL.length > 0;
    pool = hasUrl
      ? new Pool({ connectionString: PG_URL })
      : new Pool({
          host: PG_HOST,
          port: PG_PORT,
          user: PG_USER,
          password: PG_PASSWORD || undefined,
          database: PG_DATABASE,
        });
    pool.on('error', (error) => {
      console.error('[history] pool error', error);
    });
  }
  return pool;
}

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
    const candleTs = new Date(row.candle_at).getTime();
    if (!Number.isFinite(candleTs)) continue;
    const open = Number(row.price_open);
    const high = Number(row.price_high);
    const low = Number(row.price_low);
    const close = Number(row.price_close);
    const volume = Number(row.volume);
    if (![open, high, low, close, volume].every((value) => Number.isFinite(value))) {
      continue;
    }
    const bucketKey = quantizeToWindow(candleTs, windowMs);
    const existing = buckets.get(bucketKey);
    const equity = row.equity !== null ? Number(row.equity) : Number.NaN;

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
        equity: Number.isFinite(equity) ? equity : null,
        equityTs: Number.isFinite(equity) ? candleTs : Number.NEGATIVE_INFINITY,
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

    if (Number.isFinite(equity) && candleTs >= existing.equityTs) {
      existing.equity = equity;
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
    const client = ensurePool();
    const { rows } = await client.query<RawTick>(
      `
        SELECT candle_at, price_open, price_high, price_low, price_close, volume, equity
        FROM price_ticks
        WHERE candle_at >= to_timestamp($1 / 1000.0)
          AND candle_at < to_timestamp($2 / 1000.0)
        ORDER BY candle_at ASC
      `,
      [windowStart, windowEnd]
    );
    const { candles, equitySeries } = aggregateByWindow(rows, windowMs);

    const [prevResult, nextResult] = await Promise.all([
      client.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM price_ticks
          WHERE candle_at < to_timestamp($1 / 1000.0)
        ) AS exists;`,
        [windowStart]
      ),
      client.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM price_ticks
          WHERE candle_at >= to_timestamp($1 / 1000.0)
        ) AS exists;`,
        [windowEnd]
      ),
    ]);

    const hasPrev = prevResult.rows[0]?.exists ?? false;
    const hasNext = nextResult.rows[0]?.exists ?? false;

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
    console.error('[history] query failed', error);
    return NextResponse.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
