import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const localEnvPath = path.resolve(moduleDir, '../.env');

if (!process.env.__BOT_ENV_LOADED__) {
  if (existsSync(localEnvPath)) {
    loadEnv({ path: localEnvPath });
  } else {
    loadEnv();
  }
  process.env.__BOT_ENV_LOADED__ = 'true';
}

export type ExchangeId = 'binance' | 'upbit';

// 환경변수 기반 런타임 설정을 한곳에 모은 객체
export const CFG = {
  exchange: (process.env.EXCHANGE || 'binance') as ExchangeId, // 사용할 거래소 ID
  useSandbox: (process.env.USE_SANDBOX || 'true').toLowerCase() === 'true', // 샌드박스 모드 여부
  apiKey: process.env.API_KEY || '', // 거래소 API 키
  apiSecret: process.env.API_SECRET || '', // 거래소 API 시크릿
  symbol: process.env.SYMBOL || 'BTC/USDT', // 거래 심볼
  timeframe: process.env.TIMEFRAME || '5m', // 캔들 주기
  base: process.env.BASE_ASSET || 'BTC', // 베이스 자산 심볼
  quote: process.env.QUOTE_ASSET || 'USDT', // 쿼트 자산 심볼
  riskPerTrade: Number(process.env.RISK_PER_TRADE || '0.01'), // 1회 진입 시 계좌 대비 위험 비율
  maxDailyLossPct: Number(process.env.MAX_DAILY_LOSS_PCT || '3'), // 일일 최대 손실 허용치(%)
  rsiLen: Number(process.env.RSI_LEN || '14'), // RSI 계산 기간
  rsiEntry: Number(process.env.RSI_ENTRY || '30'), // RSI 롱 진입 임계값
  rsiExit: Number(process.env.RSI_EXIT || '50'), // RSI 청산 임계값
  stopPct: Number(process.env.STOP_PCT || '0.7') / 100, // 진입가 대비 손절 비율
  takePct: Number(process.env.TAKE_PCT || '1.2') / 100, // 진입가 대비 익절 비율
  cooldownMin: Number(process.env.COOLDOWN_MIN || '10'), // 쿨다운 시간(분)
  dryRun: (process.env.DRY_RUN || 'false').toLowerCase() === 'true', // 주문 미체결 시뮬레이션 모드
  logLevel: process.env.LOG_LEVEL || 'info', // 로그 레벨
  pgEnable: (process.env.PG_ENABLE || 'false').toLowerCase() === 'true', // Postgres 기록 활성화 여부
  pgUrl: process.env.PG_URL || '', // Postgres 연결 문자열
  pgHost: process.env.PG_HOST || '127.0.0.1', // Postgres 호스트
  pgPort: Number(process.env.PG_PORT || '5432'), // Postgres 포트
  pgUser: process.env.PG_USER || 'postgres', // Postgres 사용자
  pgPassword: process.env.PG_PASSWORD || '', // Postgres 비밀번호
  pgDatabase: process.env.PG_DATABASE || 'scalper', // Postgres 데이터베이스
  runtimeDir: process.env.RUNTIME_DIR || path.resolve(moduleDir, '../../../runtime'), // Runtime 파일 디렉토리
} as const;

// 설정 검증 함수
function validateConfig() {
  const errors: string[] = [];

  // 1. API 자격 증명 검증 (샌드박스 모드가 아닐 때)
  if (!CFG.useSandbox) {
    if (!CFG.apiKey || CFG.apiKey.trim() === '') {
      errors.push('API_KEY is required for live trading (set USE_SANDBOX=true for testing)');
    }
    if (!CFG.apiSecret || CFG.apiSecret.trim() === '') {
      errors.push('API_SECRET is required for live trading (set USE_SANDBOX=true for testing)');
    }
  }

  // 2. RSI 파라미터 검증
  if (CFG.rsiEntry >= CFG.rsiExit) {
    errors.push(`RSI_ENTRY (${CFG.rsiEntry}) must be less than RSI_EXIT (${CFG.rsiExit})`);
  }
  if (CFG.rsiEntry < 0 || CFG.rsiEntry > 100) {
    errors.push(`RSI_ENTRY must be between 0 and 100, got ${CFG.rsiEntry}`);
  }
  if (CFG.rsiExit < 0 || CFG.rsiExit > 100) {
    errors.push(`RSI_EXIT must be between 0 and 100, got ${CFG.rsiExit}`);
  }

  // 3. 리스크 파라미터 검증
  if (CFG.riskPerTrade < 0.001 || CFG.riskPerTrade > 0.5) {
    errors.push(`RISK_PER_TRADE must be between 0.001 and 0.5, got ${CFG.riskPerTrade}`);
  }

  // 4. 손절/익절 비율 검증
  if (CFG.stopPct <= 0) {
    errors.push(`STOP_PCT must be positive, got ${CFG.stopPct * 100}%`);
  }
  if (CFG.takePct <= 0) {
    errors.push(`TAKE_PCT must be positive, got ${CFG.takePct * 100}%`);
  }

  // 5. 쿨다운 검증
  if (CFG.cooldownMin < 0) {
    errors.push(`COOLDOWN_MIN must be >= 0, got ${CFG.cooldownMin}`);
  }

  // 6. 일일 손실 한도 검증
  if (CFG.maxDailyLossPct <= 0 || CFG.maxDailyLossPct > 100) {
    errors.push(`MAX_DAILY_LOSS_PCT must be between 0 and 100, got ${CFG.maxDailyLossPct}`);
  }

  // 7. RSI 기간 검증
  if (CFG.rsiLen < 2 || CFG.rsiLen > 200) {
    errors.push(`RSI_LEN must be between 2 and 200, got ${CFG.rsiLen}`);
  }

  // 에러가 있으면 모두 출력하고 종료
  if (errors.length > 0) {
    console.error('\n[CONFIG ERROR] Invalid configuration detected:\n');
    errors.forEach((err, idx) => {
      console.error(`  ${idx + 1}. ${err}`);
    });
    console.error('\nPlease fix your .env file and try again.\n');
    process.exit(1);
  }
}

// 모듈 로드 시 즉시 검증 실행
validateConfig();
