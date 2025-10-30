import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, '..', '..');
const repoRoot = path.resolve(projectRoot, '..', '..');
const localEnvPath = path.resolve(projectRoot, '.env');

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

/**
 * 설정 값의 유효 범위를 검증하고 유효하지 않으면 에러를 발생시킴
 */
function validateInRange(
  value: number,
  min: number,
  max: number,
  name: string,
  inclusive = true
): void {
  const valid = inclusive
    ? value >= min && value <= max
    : value > min && value < max;

  if (!valid) {
    throw new Error(
      `[CFG] ${name} must be ${inclusive ? '>=' : '>'} ${min} and ${inclusive ? '<=' : '<'} ${max}. Got: ${value}`
    );
  }
}

/**
 * 파싱된 설정값을 검증하여 거래 안정성을 보장
 */
function validateConfig(cfg: typeof CFG): void {
  // 거래소 검증
  const validExchanges = ['binance', 'upbit'];
  if (!validExchanges.includes(cfg.exchange)) {
    throw new Error(`[CFG] Invalid EXCHANGE: ${cfg.exchange}. Must be one of: ${validExchanges.join(', ')}`);
  }

  // 실거래 시 API 자격증명 검증
  if (!cfg.dryRun) {
    if (!cfg.apiKey || cfg.apiKey.trim().length === 0) {
      throw new Error('[CFG] API_KEY is required for live trading (dryRun=false)');
    }
    if (!cfg.apiSecret || cfg.apiSecret.trim().length === 0) {
      throw new Error('[CFG] API_SECRET is required for live trading (dryRun=false)');
    }
    // 기본 검증 - 키는 충분히 길어야 함
    if (cfg.apiKey.length < 8) {
      throw new Error('[CFG] API_KEY appears too short to be valid');
    }
    if (cfg.apiSecret.length < 8) {
      throw new Error('[CFG] API_SECRET appears too short to be valid');
    }
  }

  // 리스크 파라미터 검증
  validateInRange(cfg.riskPerTrade, 0, 1, 'RISK_PER_TRADE', false);
  validateInRange(cfg.maxDailyLossPct, 0, 100, 'MAX_DAILY_LOSS_PCT', false);

  // RSI 파라미터 검증
  validateInRange(cfg.rsiLen, 2, 200, 'RSI_LEN');
  validateInRange(cfg.rsiEntry, 0, 100, 'RSI_ENTRY');
  validateInRange(cfg.rsiExit, 0, 100, 'RSI_EXIT');

  if (cfg.rsiEntry >= cfg.rsiExit) {
    throw new Error(
      `[CFG] RSI_ENTRY (${cfg.rsiEntry}) must be less than RSI_EXIT (${cfg.rsiExit}) for LONG reversion strategy`
    );
  }

  // 브래킷 파라미터 검증
  validateInRange(cfg.stopPct, 0, 1, 'STOP_PCT', false);
  validateInRange(cfg.takePct, 0, 1, 'TAKE_PCT', false);

  if (cfg.stopPct >= cfg.takePct) {
    throw new Error(
      `[CFG] STOP_PCT (${cfg.stopPct}) should be less than TAKE_PCT (${cfg.takePct}) for positive risk/reward`
    );
  }

  // 쿨다운 검증
  if (cfg.cooldownMin < 0) {
    throw new Error(`[CFG] COOLDOWN_MIN must be >= 0. Got: ${cfg.cooldownMin}`);
  }

  // PostgreSQL 포트 검증
  if (cfg.pgEnable) {
    validateInRange(cfg.pgPort, 1, 65535, 'PG_PORT');

    if (!cfg.pgUrl && !cfg.pgHost) {
      throw new Error('[CFG] Either PG_URL or PG_HOST must be set when PG_ENABLE=true');
    }

    if (!cfg.pgDatabase || cfg.pgDatabase.trim().length === 0) {
      throw new Error('[CFG] PG_DATABASE must be set when PG_ENABLE=true');
    }
  }

  // 심볼 형식 검증
  if (!cfg.symbol.includes('/')) {
    throw new Error(`[CFG] SYMBOL must be in format BASE/QUOTE (e.g., BTC/USDT). Got: ${cfg.symbol}`);
  }

  // 타임프레임 형식 검증
  const validTimeframes = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'];
  if (!validTimeframes.includes(cfg.timeframe)) {
    console.warn(
      `[CFG] TIMEFRAME ${cfg.timeframe} may not be supported by all exchanges. Valid: ${validTimeframes.join(', ')}`
    );
  }
}

const runtimeDir = process.env.RUNTIME_DIR
  ? path.resolve(process.env.RUNTIME_DIR)
  : path.resolve(repoRoot, 'runtime');

export const CFG = {
  exchange: (process.env.EXCHANGE || 'binance') as ExchangeId,
  useSandbox: parseBoolean('USE_SANDBOX', true),
  apiKey: process.env.API_KEY || '',
  apiSecret: process.env.API_SECRET || '',
  symbol: process.env.SYMBOL || 'BTC/USDT',
  timeframe: process.env.TIMEFRAME || '5m',
  base: process.env.BASE_ASSET || 'BTC',
  quote: process.env.QUOTE_ASSET || 'USDT',
  riskPerTrade: parseNumber('RISK_PER_TRADE', 0.01),
  maxDailyLossPct: parseNumber('MAX_DAILY_LOSS_PCT', 3),
  rsiLen: parseNumber('RSI_LEN', 14),
  rsiEntry: parseNumber('RSI_ENTRY', 30),
  rsiExit: parseNumber('RSI_EXIT', 50),
  stopPct: parseNumber('STOP_PCT', 0.7, 100),
  takePct: parseNumber('TAKE_PCT', 1.2, 100),
  cooldownMin: parseNumber('COOLDOWN_MIN', 10),
  dryRun: parseBoolean('DRY_RUN', false),
  logLevel: process.env.LOG_LEVEL || 'info',
  pgEnable: parseBoolean('PG_ENABLE', false),
  pgUrl: process.env.PG_URL || '',
  pgHost: process.env.PG_HOST || '127.0.0.1',
  pgPort: parseNumber('PG_PORT', 5432),
  pgUser: process.env.PG_USER || 'postgres',
  pgPassword: process.env.PG_PASSWORD || '',
  pgDatabase: process.env.PG_DATABASE || 'scalper',
  runtimeDir,
  dbAutoSync: parseBoolean('DB_AUTO_SYNC', false),
} as const;

// 전체 설정 검증
try {
  validateConfig(CFG);
  console.log('[CFG] Configuration validated successfully');
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
