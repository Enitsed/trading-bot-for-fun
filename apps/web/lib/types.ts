export type ManualActionType = 'manual-buy' | 'manual-sell' | 'flatten';

export type ManualActionPayload = {
  type: ManualActionType;
  amount?: number;
};

export type ManualCommand = ManualActionPayload & {
  id: string;
  createdAt: number;
};

export type RuntimeOverrideKey =
  | 'rsiLen'
  | 'rsiEntry'
  | 'rsiExit'
  | 'riskPerTrade'
  | 'stopPct'
  | 'takePct'
  | 'cooldownMin';

export type RuntimeOverrides = Partial<Record<RuntimeOverrideKey, number>>;
export type RuntimeOverridesPayload = Partial<Record<RuntimeOverrideKey, number | null>>;

export type HistoryTimeframe = '5m' | '15m' | '1h' | '1d';

export type HistoryCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type LinePoint = {
  timestamp: number;
  value: number;
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

export type TelemetrySnapshot = {
  timestamp: number;
  price: number;
  signal: string;
  recentSignals: string[];
  position: number;
  entryPrice: number;
  openBracket: { stop: number; take: number } | null;
  thresholds?: {
    baseMin?: number;
    baseStep?: number;
    notionalMin?: number;
    tradable?: number;
  } | null;
  equity: number;
  drawdown: number;
  mark: number;
  balances?: {
    quoteFree?: number;
    quoteTotal?: number;
    baseFree?: number;
    baseTotal?: number;
  } | null;
  lastTradeTs: number | null;
  event: string;
  runtimeCfg: RuntimeCfg;
};

export type HistoryApiResponse = {
  ok: boolean;
  candles: HistoryCandle[];
  equity: LinePoint[];
  timeframe: HistoryTimeframe;
  error?: string;
};
