import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const MAX_HOURS = 240;
let pool: Pool | null = null;

const PG_ENABLE = (process.env.PG_ENABLE || '').toLowerCase() === 'true';
const PG_URL = process.env.PG_URL || '';
const PG_HOST = process.env.PG_HOST || '127.0.0.1';
const PG_PORT = Number(process.env.PG_PORT || '5432');
const PG_USER = process.env.PG_USER || 'postgres';
const PG_PASSWORD = process.env.PG_PASSWORD || '';
const PG_DATABASE = process.env.PG_DATABASE || 'scalper';

type RawTick = {
  candle_at: string;
  price_open: string;
  price_high: string;
  price_low: string;
  price_close: string;
  volume: string;
};

type HourlyCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type Bucket = HourlyCandle & {
  firstTs: number;
  lastTs: number;
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

function quantizeHour(timestamp: number): number {
  const date = new Date(timestamp);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

function aggregateHourly(rows: RawTick[]): HourlyCandle[] {
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
    const bucketKey = quantizeHour(candleTs);
    const existing = buckets.get(bucketKey);
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
  }

  return Array.from(buckets.values())
    .map(({ firstTs: _firstTs, lastTs: _lastTs, ...rest }) => rest)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function GET(request: Request) {
  if (!PG_ENABLE) {
    return NextResponse.json({ ok: false, error: 'PG_DISABLED' }, { status: 503 });
  }

  const url = new URL(request.url);
  const hours = normalizeHours(url.searchParams.get('hours'));

  try {
    const client = ensurePool();
    const { rows } = await client.query<RawTick>(
      `
        SELECT candle_at, price_open, price_high, price_low, price_close, volume
        FROM price_ticks
        WHERE candle_at >= NOW() - ($1::int * INTERVAL '1 hour')
        ORDER BY candle_at ASC
      `,
      [hours]
    );
    const candles = aggregateHourly(rows);
    return NextResponse.json({ ok: true, candles });
  } catch (error) {
    console.error('[history] query failed', error);
    return NextResponse.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
