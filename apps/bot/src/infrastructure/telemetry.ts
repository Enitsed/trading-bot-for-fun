import type { Signal, Candle } from '@scalper/shared';
import { botLogger, saveTelemetrySnapshot } from '@scalper/shared';
import type { BalanceSnapshot } from './balance.js';
import { CFG } from '@scalper/bot/infrastructure/config.js';

export type Snapshot = {
  timestamp: number;
  price: number;
  signal: Signal;
  recentSignals: Signal[];
  position: number;
  entryPrice: number;
  openBracket: { stop: number; take: number } | null;
  thresholds: {
    baseMin: number;
    baseStep: number;
    notionalMin: number;
    tradable: number;
  };
  equity: number;
  drawdown: number;
  totalPnl: number;
  totalPnlPct: number;
  mark: number;
  balances: BalanceSnapshot;
  lastTradeTs: number | null;
  event: string;
  runtimeCfg: RuntimeCfg;
};

export type RuntimeCfg = {
  rsiLen: number;
  rsiEntry: number;
  rsiExit: number;
  riskPerTrade: number;
  stopPct: number;
  takePct: number;
  cooldownMin: number;
};

type PublishParams = {
  price: number;
  signal: Signal;
  signals: Signal[];
  position: number;
  entryPrice: number;
  openBracket: { stop: number; take: number } | null;
  thresholds: {
    baseMin: number;
    baseStep: number;
    notionalMin: number;
    tradable: number;
  };
  equity: number;
  drawdown: number;
  totalPnl: number;
  totalPnlPct: number;
  mark: number;
  balances: BalanceSnapshot;
  lastTradeTs: number | null;
  event: string;
  runtimeCfg: RuntimeCfg;
  candleTs: number;
  candle: Candle | null;
};

export async function publishSnapshot(params: PublishParams): Promise<void> {
  const snapshot: Snapshot = {
    timestamp: params.candleTs,
    price: params.price,
    signal: params.signal,
    recentSignals: params.signals.slice(-10),
    position: params.position,
    entryPrice: params.entryPrice,
    openBracket: params.openBracket,
    thresholds: params.thresholds,
    equity: params.equity,
    drawdown: params.drawdown,
    totalPnl: params.totalPnl,
    totalPnlPct: params.totalPnlPct,
    mark: params.mark,
    balances: params.balances,
    lastTradeTs: params.lastTradeTs,
    event: params.event,
    runtimeCfg: params.runtimeCfg,
  };

  try {
    await saveTelemetrySnapshot(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    await botLogger.error(`Failed to write telemetry: ${message}`, 'TELEMETRY');
  }
}
