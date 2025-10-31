// constants/trading.ts
// 트레이딩 관련 상수 정의 - 매직 넘버 제거

/**
 * 거래소 수수료 비율
 */
export const DEFAULT_FEE_RATE = 0.0006; // 0.06%

/**
 * 부동소수점 연산 정밀도 엡실론
 * 수량 계산 시 반올림 오류를 방지하기 위한 허용 오차
 */
export const FLOATING_POINT_EPSILON = 1e-12;

/**
 * 캔들 데이터 관련 상수
 */
export const CANDLE_LIMITS = {
  /** 기본 캔들 조회 개수 (live.ts) */
  DEFAULT: 300,
  /** 최대 캔들 개수 (trading-loop.ts) */
  MAX: 500,
} as const;

/**
 * 대기 시간 (밀리초)
 */
export const SLEEP_DURATIONS = {
  /** 캔들 없을 때 대기 (30초) */
  NO_CANDLE: 30_000,
  /** 일반 루프 간격 (30초) */
  LOOP_INTERVAL: 30_000,
  /** 에러 발생 시 대기 (5초) */
  ON_ERROR: 5_000,
  /** 긴 대기 시간 (60초) */
  LONG_WAIT: 60_000,
} as const;

/**
 * 에러 처리 관련 상수
 */
export const ERROR_HANDLING = {
  /** 최대 연속 에러 허용 횟수 */
  MAX_CONSECUTIVE_ERRORS: 5,
  /** 초기 백오프 시간 (밀리초) */
  INITIAL_BACKOFF_MS: 10_000,
  /** 백오프 배수 */
  BACKOFF_MULTIPLIER: 2,
} as const;

/**
 * 검증 관련 상수
 */
export const VALIDATION = {
  /** API 키 최소 길이 */
  MIN_API_KEY_LENGTH: 8,
  /** RSI 최소값 */
  MIN_RSI_VALUE: 1,
  /** RSI 최대값 */
  MAX_RSI_VALUE: 99,
  /** 최소 RSI 기간 */
  MIN_RSI_PERIOD: 2,
} as const;

/**
 * 위험 관리 상수
 */
export const RISK_MANAGEMENT = {
  /** 최대 일일 손실 비율 (기본값) */
  DEFAULT_MAX_DAILY_LOSS_PCT: 0.05, // 5%
  /** 최소 위험 비율 */
  MIN_RISK_PER_TRADE: 0.001, // 0.1%
  /** 최대 위험 비율 */
  MAX_RISK_PER_TRADE: 0.1, // 10%
} as const;

/**
 * 시간 관련 상수
 */
export const TIME = {
  /** 1분 (밀리초) */
  ONE_MINUTE_MS: 60_000,
  /** 1시간 (밀리초) */
  ONE_HOUR_MS: 3_600_000,
  /** 1일 (밀리초) */
  ONE_DAY_MS: 86_400_000,
} as const;

/**
 * 재시도 관련 상수
 */
export const RETRY = {
  /** 거래소 연결 최대 재시도 횟수 */
  MAX_CONNECT_ATTEMPTS: 3,
  /** 재시도 간격 (밀리초) */
  RETRY_DELAY_MS: 2_000,
} as const;
