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

function parseBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  console.warn(`[CFG] Invalid boolean for ${name}: ${raw}. Using default ${fallback}`);
  return fallback;
}

function parseNumber(name: string, fallback: number, divideBy = 1): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (Number.isFinite(value)) {
    return value / divideBy;
  }
  console.warn(`[CFG] Invalid number for ${name}: ${raw}. Using default ${fallback}`);
  return fallback;
}

const runtimeDir = process.env.RUNTIME_DIR
  ? path.resolve(process.env.RUNTIME_DIR)
  : path.resolve(moduleDir, '..', '..', '..', 'runtime');

// 환경변수 기반 런타임 설정을 한곳에 모은 객체
export const CFG = {
  exchange: (process.env.EXCHANGE || 'binance') as ExchangeId, // 사용할 거래소 ID
  useSandbox: parseBoolean('USE_SANDBOX', true), // 샌드박스 모드 여부
  apiKey: process.env.API_KEY || '', // 거래소 API 키
  apiSecret: process.env.API_SECRET || '', // 거래소 API 시크릿
  symbol: process.env.SYMBOL || 'BTC/USDT', // 거래 심볼
  timeframe: process.env.TIMEFRAME || '5m', // 캔들 주기
  base: process.env.BASE_ASSET || 'BTC', // 베이스 자산 심볼
  quote: process.env.QUOTE_ASSET || 'USDT', // 쿼트 자산 심볼
  riskPerTrade: parseNumber('RISK_PER_TRADE', 0.01), // 1회 진입 시 계좌 대비 위험 비율
  maxDailyLossPct: parseNumber('MAX_DAILY_LOSS_PCT', 3), // 일일 최대 손실 허용치(%)
  rsiLen: parseNumber('RSI_LEN', 14), // RSI 계산 기간
  rsiEntry: parseNumber('RSI_ENTRY', 30), // RSI 롱 진입 임계값
  rsiExit: parseNumber('RSI_EXIT', 50), // RSI 청산 임계값
  stopPct: parseNumber('STOP_PCT', 0.7, 100), // 진입가 대비 손절 비율
  takePct: parseNumber('TAKE_PCT', 1.2, 100), // 진입가 대비 익절 비율
  cooldownMin: parseNumber('COOLDOWN_MIN', 10), // 쿨다운 시간(분)
  dryRun: parseBoolean('DRY_RUN', false), // 주문 미체결 시뮬레이션 모드
  logLevel: process.env.LOG_LEVEL || 'info', // 로그 레벨
  pgEnable: parseBoolean('PG_ENABLE', false), // Postgres 기록 활성화 여부
  pgUrl: process.env.PG_URL || '', // Postgres 연결 문자열
  pgHost: process.env.PG_HOST || '127.0.0.1', // Postgres 호스트
  pgPort: parseNumber('PG_PORT', 5432), // Postgres 포트
  pgUser: process.env.PG_USER || 'postgres', // Postgres 사용자
  pgPassword: process.env.PG_PASSWORD || '', // Postgres 비밀번호
  pgDatabase: process.env.PG_DATABASE || 'scalper', // Postgres 데이터베이스
  runtimeDir,
  dbAutoSync: parseBoolean('DB_AUTO_SYNC', false),
} as const;

const requiredEnv = ['API_KEY', 'API_SECRET'];
for (const key of requiredEnv) {
  if (!process.env[key] && !CFG.dryRun) {
    console.warn(`[CFG] ${key} is not set. Live trading may fail.`);
  }
}
