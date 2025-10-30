import { rsi } from './indicators.js';
import type { Candle, Signal, StrategyCfg } from './types.js';

/**
 * 캔들 시리즈에 대한 RSI 반전 시그널 생성
 *
 * 전략 로직:
 * - RSI가 진입 임계값 아래로 떨어졌다가 다시 위로 교차하면 LONG 발행
 * - 포지션 보유 중 RSI가 청산 임계값 위에 있으면 EXIT 발행
 * - 그 외 모든 경우 HOLD 발행
 *
 * @param candles - OHLCV 캔들 배열 (비어있으면 안됨)
 * @param cfg - RSI 파라미터를 포함한 전략 설정
 * @param cfg.rsiLen - RSI 기간 길이 (반드시 >= 2)
 * @param cfg.entry - RSI 진입 임계값 (0-100, 일반적으로 과매도 구간인 20-40)
 * @param cfg.exit - RSI 청산 임계값 (0-100, 반드시 > entry)
 * @returns 각 캔들에 대응하는 시그널 배열
 * @throws 검증 실패 시 에러 발생
 *
 * 예시:
 * - entry=30, exit=50
 * - RSI가 25로 하락 → wasBelow 플래그 설정
 * - RSI가 32로 상승 → LONG 시그널 발행, wasBelow 리셋
 * - RSI가 55로 상승 → EXIT 시그널 발행
 */
export function rsiReversionSignals(candles: Candle[], cfg: StrategyCfg): Signal[] {
  // 입력 검증
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('[STRATEGY] candles array must not be empty');
  }

  if (!Number.isFinite(cfg.rsiLen) || cfg.rsiLen < 2) {
    throw new Error(`[STRATEGY] cfg.rsiLen must be >= 2. Got: ${cfg.rsiLen}`);
  }

  if (!Number.isFinite(cfg.entry) || cfg.entry < 0 || cfg.entry > 100) {
    throw new Error(`[STRATEGY] cfg.entry must be 0-100. Got: ${cfg.entry}`);
  }

  if (!Number.isFinite(cfg.exit) || cfg.exit < 0 || cfg.exit > 100) {
    throw new Error(`[STRATEGY] cfg.exit must be 0-100. Got: ${cfg.exit}`);
  }

  if (cfg.entry >= cfg.exit) {
    throw new Error(
      `[STRATEGY] cfg.entry (${cfg.entry}) must be less than cfg.exit (${cfg.exit}) for LONG reversion strategy`
    );
  }

  // 캔들 데이터 검증
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    if (!Number.isFinite(candle.close) || candle.close <= 0) {
      throw new Error(`[STRATEGY] Invalid close price at candle ${i}: ${candle.close}`);
    }
  }

  // RSI 계산
  const closes = candles.map((candle) => candle.close);
  const r = rsi(closes, cfg.rsiLen);

  if (r.length !== candles.length) {
    throw new Error(
      `[STRATEGY] RSI calculation returned unexpected length. Expected ${candles.length}, got ${r.length}`
    );
  }

  // 시그널 생성
  const out: Signal[] = [];
  let wasBelow = false; // 상태 머신: RSI가 진입 임계값 아래로 떨어졌는지 추적

  for (let i = 0; i < candles.length; i++) {
    const rv = r[i];

    // NaN RSI 처리 (계산에 충분한 데이터가 없음)
    if (!Number.isFinite(rv)) {
      out.push('HOLD');
      continue;
    }

    // RSI가 진입 임계값 아래로 떨어졌는지 확인
    if (rv < cfg.entry) {
      wasBelow = true;
    }

    // LONG 시그널 확인: RSI가 아래에 있다가 진입 임계값 위로 교차
    if (wasBelow && rv >= cfg.entry) {
      out.push('LONG');
      wasBelow = false; // 상태 머신 리셋
      continue;
    }

    // EXIT 시그널 확인: RSI가 청산 임계값 위에 있음
    if (rv >= cfg.exit) {
      out.push('EXIT');
      continue;
    }

    // 기본값: 시그널 없음
    out.push('HOLD');
  }

  return out;
}
