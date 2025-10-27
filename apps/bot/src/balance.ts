import type { Exchange } from 'ccxt';
import { CFG } from './config.js';
import { botLogger } from '@scalper/shared/logger.js';

export type BalanceSnapshot = {
  quoteFree: number;
  quoteTotal: number;
  baseFree: number;
  baseTotal: number;
};

export async function calculateEquity(exchange: Exchange): Promise<{
  equity: number;
  balances: BalanceSnapshot;
  mark: number;
}> {
  const balance = await exchange.fetchBalance();
  const market = exchange.market(CFG.symbol);
  const quoteCode = typeof market?.quote === 'string' ? market.quote : CFG.quote;
  const baseCode = typeof market?.base === 'string' ? market.base : CFG.base;
  const quote = balance[quoteCode];
  const base = balance[baseCode];
  const quoteFree = typeof quote?.free === 'number' ? quote.free : typeof quote?.total === 'number' ? quote.total : 0;
  const quoteTotal = typeof quote?.total === 'number' ? quote.total : quoteFree;
  const baseFree = typeof base?.free === 'number' ? base.free : typeof base?.total === 'number' ? base.total : 0;
  const baseTotal = typeof base?.total === 'number' ? base.total : baseFree;

  await botLogger.info(`Balance: QUOTE {free: ${quoteFree}, total: ${quoteTotal}}, BASE {free: ${baseFree}, total: ${baseTotal}}`, 'BALANCE');

  let mark = 0;
  try {
    const ticker = await exchange.fetchTicker(CFG.symbol);
    mark = (ticker?.last ?? ticker?.close ?? 0) as number;
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    await botLogger.warn(`Ticker fetch failed: ${message}`, 'BALANCE');
  }

  const equity = quoteFree + baseTotal * (mark || 0);
  return {
    equity,
    balances: { quoteFree, quoteTotal, baseFree, baseTotal },
    mark,
  };
}