import { CFG } from './config.js';
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

export async function prepareStorage(): Promise<boolean> {
  if (!CFG.pgEnable) {
    return false;
  }
  if (!syncPromise) {
    syncPromise = (async () => {
      await ensureDbConnection();
      if (CFG.dbAutoSync) {
        await syncModels({ alter: true });
      }
    })();
  }
  try {
    await syncPromise;
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[DB] Storage initialization failed:', message);
    syncPromise = null;
    return false;
  }
}

export async function recordPriceTick(payload: PriceTickPayload): Promise<void> {
  if (!pgEnabled()) return;
  if (!(await prepareStorage())) return;
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
