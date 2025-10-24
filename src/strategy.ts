import { rsi } from './indicators.js';

export type Candle = {
  ts: number; // 타임스탬프(ms)
  open: number; // 시가
  high: number; // 고가
  low: number; // 저가
  close: number; // 종가
  vol: number; // 거래량
};

export type Signal = 'LONG' | 'EXIT' | 'HOLD';

export interface StrategyCfg {
  rsiLen: number; // RSI 기간
  entry: number; // 진입 임계값
  exit: number; // 청산 임계값
}

/**
 * RSI 기반 평균회귀 전략 시그널 생성기 (롱 전용).
 * - RSI가 진입 임계값 아래로 내려갔다가 다시 위로 올라오면 LONG
 * - 보유 중 RSI가 청산 임계값 이상이면 EXIT
 */
export function rsiReversionSignals(candles: Candle[], cfg: StrategyCfg): Signal[] {
  const closes = candles.map(c => c.close); // 종가 배열
  const r = rsi(closes, cfg.rsiLen); // RSI 시계열
  const out: Signal[] = [];
  let wasBelow = false; // 직전에 RSI가 진입 임계값 아래였는지 여부
  for (let i = 0; i < candles.length; i++) {
    const rv = r[i];
    if (!Number.isFinite(rv)) {
      out.push('HOLD');
      continue;
    }
    if (rv < cfg.entry) wasBelow = true; // 임계값 하회 상태 기억
    if (wasBelow && rv >= cfg.entry) {
      out.push('LONG');
      wasBelow = false;
      continue;
    }
    if (rv >= cfg.exit) {
      out.push('EXIT');
      continue;
    }
    out.push('HOLD');
  }
  return out;
}
