export type Candle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
};

export type Signal = 'LONG' | 'EXIT' | 'HOLD';

export type StrategyCfg = {
  rsiLen: number;
  entry: number;
  exit: number;
};

export type Bracket = {
  stop: number;
  take: number;
};
