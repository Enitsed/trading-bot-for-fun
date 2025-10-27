import { Pool } from 'pg';
import { CFG } from './config.js';

type PriceTickPayload = {
  symbol: string;
  candleTs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  signal: string;
  position: number;
  equity: number;
  event: string;
  runtimeCfg?: Record<string, unknown>;
  recordedAt?: number;
};

type TradeRecordPayload = {
  symbol: string;
  ts: number;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  event: string;
  position: number;
  equity: number;
  orderId?: string | null;
  clientOrderId?: string | null;
  metadata?: Record<string, unknown>;
  recordedAt?: number;
};

let pool: Pool | null = null;
let initPromise: Promise<void> | null = null;
let storageDisabled = false;
let storageReady = false;
let announcedReady = false;

function pgEnabled(): boolean {
  return CFG.pgEnable && !storageDisabled;
}

function getPool(): Pool | null {
  if (!pgEnabled()) return null;
  if (!pool) {
    const hasUrl = CFG.pgUrl && CFG.pgUrl.length > 0;
    pool = hasUrl
      ? new Pool({ connectionString: CFG.pgUrl })
      : new Pool({
          host: CFG.pgHost,
          port: CFG.pgPort,
          user: CFG.pgUser,
          password: CFG.pgPassword || undefined,
          database: CFG.pgDatabase,
        });
    pool.on('error', (err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[PG ERROR] Unexpected pool error: ${message}`);
      console.error(`[PG ERROR] Stack: ${err instanceof Error ? err.stack : 'N/A'}`);
      // Pool 에러는 연결이 끊어졌을 때 발생하므로, 재연결은 자동으로 시도됨
    });
  }
  return pool;
}

async function ensureInit(): Promise<boolean> {
  if (!pgEnabled()) return false;
  const target = getPool();
  if (!target) return false;
  if (!initPromise) {
    initPromise = (async () => {
      const client = await target.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS price_ticks (
            id BIGSERIAL PRIMARY KEY,
            symbol TEXT NOT NULL,
            candle_at TIMESTAMPTZ NOT NULL,
            price_open NUMERIC NOT NULL,
            price_high NUMERIC NOT NULL,
            price_low NUMERIC NOT NULL,
            price_close NUMERIC NOT NULL,
            volume NUMERIC NOT NULL,
            signal TEXT NOT NULL,
            position NUMERIC,
            equity NUMERIC,
            event TEXT NOT NULL,
            runtime_cfg JSONB NOT NULL DEFAULT '{}'::jsonb,
            recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS trade_events (
            id BIGSERIAL PRIMARY KEY,
            symbol TEXT NOT NULL,
            traded_at TIMESTAMPTZ NOT NULL,
            side TEXT NOT NULL,
            amount NUMERIC NOT NULL,
            price NUMERIC NOT NULL,
            event TEXT NOT NULL,
            position NUMERIC,
            equity NUMERIC,
            order_id TEXT,
            client_order_id TEXT,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);
        storageReady = true;
      } finally {
        client.release();
      }
    })().catch((error) => {
      storageDisabled = true;
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[PG] Storage disabled (init failed):', message);
      throw error;
    });
  }
  try {
    await initPromise;
    return storageReady;
  } catch {
    return false;
  }
}

export async function prepareStorage(): Promise<boolean> {
  if (!CFG.pgEnable) {
    return false;
  }
  const ready = await ensureInit();
  if (ready && !announcedReady) {
    console.log('[PG] Storage ready');
    announcedReady = true;
  }
  return ready;
}

// 재시도 헬퍼 함수
async function retryQuery<T>(
  operation: () => Promise<T>,
  maxRetries = 2,
  operationName = 'query'
): Promise<T | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isLastAttempt = attempt === maxRetries;

      if (isLastAttempt) {
        console.error(`[PG ERROR] ${operationName} failed after ${maxRetries} attempts: ${message}`);
        if (error instanceof Error && error.stack) {
          console.error(`[PG ERROR] Stack: ${error.stack}`);
        }
        return null;
      }

      console.warn(`[PG WARN] ${operationName} failed (attempt ${attempt}/${maxRetries}): ${message}. Retrying...`);
      // 재시도 전 짧은 대기 (100ms * attempt)
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
  return null;
}

export async function recordPriceTick(payload: PriceTickPayload): Promise<void> {
  if (!pgEnabled()) return;
  if (!(await ensureInit())) return;
  const target = getPool();
  if (!target) return;
  const recordedAt = new Date(payload.recordedAt ?? Date.now());
  const candleAt = new Date(payload.candleTs);

  await retryQuery(
    async () => {
      await target.query(
        `
          INSERT INTO price_ticks (
            symbol,
            candle_at,
            price_open,
            price_high,
            price_low,
            price_close,
            volume,
            signal,
            position,
            equity,
            event,
            runtime_cfg,
            recorded_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);
        `,
        [
          payload.symbol,
          candleAt,
          payload.open,
          payload.high,
          payload.low,
          payload.close,
          payload.volume,
          payload.signal,
          Number.isFinite(payload.position) ? payload.position : null,
          Number.isFinite(payload.equity) ? payload.equity : null,
          payload.event,
          payload.runtimeCfg ?? {},
          recordedAt,
        ]
      );
    },
    2,
    'recordPriceTick'
  );
}

export async function recordTrade(payload: TradeRecordPayload): Promise<void> {
  if (!pgEnabled()) return;
  if (!(await ensureInit())) return;
  const target = getPool();
  if (!target) return;
  const tradedAt = new Date(payload.ts);
  const recordedAt = new Date(payload.recordedAt ?? Date.now());

  await retryQuery(
    async () => {
      await target.query(
        `
          INSERT INTO trade_events (
            symbol,
            traded_at,
            side,
            amount,
            price,
            event,
            position,
            equity,
            order_id,
            client_order_id,
            metadata,
            recorded_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
        `,
        [
          payload.symbol,
          tradedAt,
          payload.side,
          payload.amount,
          payload.price,
          payload.event,
          Number.isFinite(payload.position) ? payload.position : null,
          Number.isFinite(payload.equity) ? payload.equity : null,
          payload.orderId ?? null,
          payload.clientOrderId ?? null,
          payload.metadata ?? {},
          recordedAt,
        ]
      );
    },
    2,
    'recordTrade'
  );
}
