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

/**
 * 초기화 상태 관리
 * - null: 초기화 안됨
 * - Promise: 초기화 진행 중 또는 완료
 */
let initPromise: Promise<boolean> | null = null;

/**
 * 경쟁 조건을 방지하기 위한 원자적 초기화로 데이터베이스 스토리지 준비
 *
 * @returns 스토리지가 준비되면 true, 그 외 false
 *
 * 동작:
 * - 첫 번째 호출: 초기화 Promise 생성 및 실행
 * - 동시 호출: 동일한 Promise를 재사용하여 중복 초기화 방지
 * - 실패 후 재호출: 새로운 초기화 시도
 */
export async function prepareStorage(): Promise<boolean> {
  if (!CFG.pgEnable) {
    return false;
  }

  // 이미 초기화 중이거나 완료된 경우, 동일한 Promise 재사용
  if (initPromise) {
    return initPromise;
  }

  // 새로운 초기화 시작
  initPromise = (async (): Promise<boolean> => {
    try {
      await ensureDbConnection();

      if (CFG.dbAutoSync) {
        await syncModels({ alter: true });
      }

      console.log('[STORAGE] Storage prepared successfully');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[STORAGE] Storage initialization failed:', message);

      // 초기화 실패 시 null로 재설정하여 재시도 허용
      initPromise = null;
      return false;
    }
  })();

  return initPromise;
}

/**
 * 포괄적인 OHLC 검증을 통해 price tick을 데이터베이스에 기록
 * 차트를 손상시킬 수 있는 유효하지 않은 데이터는 스킵함
 */
export async function recordPriceTick(payload: PriceTickPayload): Promise<void> {
  if (!pgEnabled()) return;
  if (!(await prepareStorage())) return;

  // 타임스탬프 검증
  const candleAtMs = Number(payload.candleTs);
  if (!Number.isFinite(candleAtMs) || candleAtMs <= 0) {
    console.warn('[DB] ⚠️  Skip price tick: Invalid timestamp', candleAtMs);
    return;
  }

  // OHLC 가격 검증 (양수이고 유한해야 함)
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

  // OHLC 관계 검증
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

  // 거래량 검증
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
