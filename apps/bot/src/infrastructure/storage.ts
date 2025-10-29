import { CFG } from '@scalper/bot/infrastructure/config.js';
import { ensureDbConnection, syncModels, PriceTickModel, TradeEventModel, isUndefinedTableError, logMissingTable } from '@scalper/shared';

export type PriceTickPayload = {
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
  totalPnl?: number;
  totalPnlPct?: number;
  event: string;
  runtimeCfg?: Record<string, unknown>;
  recordedAt?: number;
};

export type TradeRecordPayload = {
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

function pgEnabled(): boolean {
  return CFG.pgEnable;
}

let syncPromise: Promise<void> | null = null;
let isSyncing = false;

/**
 * Prepares database storage with atomic initialization to prevent race conditions
 * @returns true if storage is ready, false otherwise
 */
export async function prepareStorage(): Promise<boolean> {
  if (!CFG.pgEnable) {
    return false;
  }

  // Return existing promise if already initialized
  if (syncPromise) {
    try {
      await syncPromise;
      return true;
    } catch {
      // Previous initialization failed, allow retry
      syncPromise = null;
    }
  }

  // Prevent race condition with atomic flag
  if (isSyncing) {
    // Wait for existing sync to complete
    while (isSyncing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    // Sync completed - check if it succeeded
    // If syncPromise is still set, it succeeded. If null, it failed.
    return syncPromise !== null;
  }

  isSyncing = true;

  try {
    syncPromise = (async () => {
      await ensureDbConnection();
      if (CFG.dbAutoSync) {
        await syncModels({ alter: true });
      }
    })();

    await syncPromise;
    console.log('[STORAGE] Storage prepared successfully');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[STORAGE] Storage initialization failed:', message);
    syncPromise = null;
    return false;
  } finally {
    isSyncing = false;
  }
}

/**
 * Records price tick to database with comprehensive OHLC validation
 * Skips invalid data that would corrupt charts
 */
export async function recordPriceTick(payload: PriceTickPayload): Promise<void> {
  if (!pgEnabled()) return;
  if (!(await prepareStorage())) return;

  // Validate timestamp
  const candleAtMs = Number(payload.candleTs);
  if (!Number.isFinite(candleAtMs) || candleAtMs <= 0) {
    console.warn('[DB] ⚠️  Skip price tick: Invalid timestamp', candleAtMs);
    return;
  }

  // Validate OHLC prices (must be positive and finite)
  const priceFields = {
    open: payload.open,
    high: payload.high,
    low: payload.low,
    close: payload.close,
  } as const;

  for (const [key, value] of Object.entries(priceFields)) {
    if (!Number.isFinite(value) || value <= 0) {
      console.warn(`[DB] ⚠️  Skip price tick: ${key}=${value} (invalid/zero price)`, {
        symbol: payload.symbol,
        timestamp: new Date(candleAtMs).toISOString(),
        ohlc: priceFields,
      });
      return;
    }
  }

  // Validate OHLC relationships
  if (payload.high < payload.low) {
    console.warn('[DB] ⚠️  Skip price tick: high < low (corrupted candle)', {
      symbol: payload.symbol,
      high: payload.high,
      low: payload.low,
      timestamp: new Date(candleAtMs).toISOString(),
    });
    return;
  }

  if (payload.open > payload.high || payload.open < payload.low) {
    console.warn('[DB] ⚠️  Skip price tick: open outside [low, high] range', {
      symbol: payload.symbol,
      open: payload.open,
      high: payload.high,
      low: payload.low,
      timestamp: new Date(candleAtMs).toISOString(),
    });
    return;
  }

  if (payload.close > payload.high || payload.close < payload.low) {
    console.warn('[DB] ⚠️  Skip price tick: close outside [low, high] range', {
      symbol: payload.symbol,
      close: payload.close,
      high: payload.high,
      low: payload.low,
      timestamp: new Date(candleAtMs).toISOString(),
    });
    return;
  }

  // Validate volume
  if (!Number.isFinite(payload.volume) || payload.volume < 0) {
    console.warn('[DB] ⚠️  Skip price tick: Invalid volume', {
      symbol: payload.symbol,
      volume: payload.volume,
      timestamp: new Date(candleAtMs).toISOString(),
    });
    return;
  }

  const recordedAt = new Date(payload.recordedAt ?? Date.now());
  const candleAt = new Date(payload.candleTs);
  try {
    await PriceTickModel.create({
      symbol: payload.symbol,
      candleAt,
      priceOpen: payload.open,
      priceHigh: payload.high,
      priceLow: payload.low,
      priceClose: payload.close,
      volume: payload.volume,
      signal: payload.signal,
      position: Number.isFinite(payload.position) ? payload.position : null,
      equity: Number.isFinite(payload.equity) ? payload.equity : null,
      totalPnl: Number.isFinite(payload.totalPnl ?? NaN) ? payload.totalPnl : null,
      totalPnlPct: Number.isFinite(payload.totalPnlPct ?? NaN) ? payload.totalPnlPct : null,
      event: payload.event,
      runtimeCfg: payload.runtimeCfg ?? {},
      recordedAt,
    });
  } catch (error) {
    if (isUndefinedTableError(error)) {
      logMissingTable('price_ticks');
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[DB] Failed to record price tick:', message);
  }
}

export async function recordTrade(payload: TradeRecordPayload): Promise<void> {
  if (!pgEnabled()) return;
  if (!(await prepareStorage())) return;
  const tradedAt = new Date(payload.ts);
  const recordedAt = new Date(payload.recordedAt ?? Date.now());
  try {
    await TradeEventModel.create({
      symbol: payload.symbol,
      tradedAt,
      side: payload.side,
      amount: payload.amount,
      price: payload.price,
      event: payload.event,
      position: Number.isFinite(payload.position) ? payload.position : null,
      equity: Number.isFinite(payload.equity) ? payload.equity : null,
      orderId: payload.orderId ?? null,
      clientOrderId: payload.clientOrderId ?? null,
      metadata: payload.metadata ?? {},
      recordedAt,
    });
  } catch (error) {
    if (isUndefinedTableError(error)) {
      logMissingTable('trade_events');
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[DB] Failed to record trade:', message);
  }
}
