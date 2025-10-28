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

const requiredEnv = ['API_KEY', 'API_SECRET'];
for (const key of requiredEnv) {
  if (!process.env[key] && !CFG.dryRun) {
    console.warn(`[CFG] ${key} is not set. Live trading may fail.`);
  }
}
