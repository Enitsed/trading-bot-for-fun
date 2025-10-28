import type { Exchange, OHLCV } from 'ccxt';
import { botLogger, type Candle as SharedCandle, type Signal, getRuntimeOverrides } from '@scalper/shared';
import {
  connect,
  fetchOHLCV,
  getPositionQty,
  placeMarket,
  quotePrecision,
  toAmountPrecision,
} from './exchange.js';
import { rsiReversionSignals, type Candle as StrategyCandle } from './strategy.js';
import { sizeByRisk, computeBracket, hitBracket, withinCooldown } from './risk.js';
import { prepareStorage, recordPriceTick, recordTrade, type PriceTickPayload, type TradeRecordPayload } from './storage.js';
import { calculateEquity } from './balance.js';
import { publishSnapshot, type RuntimeCfg } from './telemetry.js';
import { CFG } from './config.js';

export async function executeTradingLoop(): Promise<void> {
  await botLogger.info('Starting trading loop', 'LOOP');

  const exchange = await connect();
  const maxCandles = 500;
  const loopIntervalMs = 30_000;

  await prepareStorage();

  let entryPrice = 0;
  let openBracket: { stop: number; take: number } | null = null;
  let lastTradeTs: number | null = null;
  let signals: Signal[] = [];
  let equityHwm = 0;
  let initialEquity: number | null = null;

  while (true) {
    try {
      const [rawCandles, runtimeCfg] = await Promise.all([
        fetchOHLCV(exchange, maxCandles),
        loadRuntimeConfig(),
      ]);

      const candles = mapCandles(rawCandles);

      if (candles.length === 0) {
        await botLogger.warn('No candle data available', 'LOOP');
        await sleep(loopIntervalMs);
        continue;
      }

      const latestCandle = candles[candles.length - 1];
      const latestSharedCandle: SharedCandle = toSharedCandle(latestCandle);
      const latestTs = latestCandle.ts;
      const latestPrice = latestCandle.close;

      signals = rsiReversionSignals(candles, {
        rsiLen: runtimeCfg.rsiLen,
        entry: runtimeCfg.rsiEntry,
        exit: runtimeCfg.rsiExit,
      });
      const latestSignal = signals[signals.length - 1] ?? 'HOLD';

      let position = await getPositionQty(exchange);
      const { equity, balances, mark } = await calculateEquity(exchange);

      if (initialEquity === null) {
        initialEquity = equity;
        equityHwm = equity;
      }

      equityHwm = Math.max(equityHwm, equity);
      const drawdown = equityHwm > 0 ? (equity - equityHwm) / equityHwm : 0;

      const precision = await quotePrecision(exchange);
      const thresholds = {
        baseMin: precision.baseMin,
        baseStep: precision.baseStep,
        notionalMin: precision.notionalMin,
        tradable: precision.baseMin,
      };

      const totalPnl = initialEquity !== null ? equity - initialEquity : 0;
      const totalPnlPct = initialEquity && initialEquity !== 0 ? totalPnl / initialEquity : 0;

      let event = 'idle';

      const bracketHit = openBracket ? hitBracket(latestPrice, openBracket) : null;
      if (openBracket && bracketHit) {
        await botLogger.info(`Bracket hit (${bracketHit}) at price ${latestPrice}`, 'TRADE');

        if (Math.abs(position) > thresholds.baseMin) {
          const closeSide = position > 0 ? 'sell' : 'buy';
          const closeQty = Math.abs(position);

          try {
            const order = await placeMarket(exchange, closeSide, closeQty);
            position = 0;
            const tradePayload: TradeRecordPayload = {
              side: closeSide,
              amount: closeQty,
              price: latestPrice,
              event: 'bracket',
              orderId: order?.id,
              symbol: CFG.symbol,
              ts: Date.now(),
              position,
              equity,
            };
            await recordTrade(tradePayload);

            lastTradeTs = Date.now();
            event = bracketHit === 'TAKE' ? 'take-profit' : 'stop-loss';
            await botLogger.info(`Position closed via bracket: ${closeSide} ${closeQty}`, 'TRADE');
          } catch (error) {
            const message = error instanceof Error ? error.message : JSON.stringify(error);
            await botLogger.error(`Bracket close failed: ${message}`, 'TRADE');
          }
        }

        entryPrice = 0;
        openBracket = null;
      }

      const isLongSignal = latestSignal === 'LONG' || latestSignal === 'BUY';
      const isExitSignal = latestSignal === 'EXIT' || latestSignal === 'SELL';

      if (isLongSignal && Math.abs(position) < thresholds.baseMin) {
        if (withinCooldown(lastTradeTs, runtimeCfg.cooldownMin)) {
          await botLogger.info('Trade skipped due to cooldown', 'COOLDOWN');
        } else {
          const tradeSize = sizeByRisk(equity, latestPrice, runtimeCfg.riskPerTrade);
          const buyQty = await toAmountPrecision(exchange, tradeSize);

          if (buyQty >= thresholds.baseMin && buyQty * latestPrice >= thresholds.notionalMin) {
            try {
              const order = await placeMarket(exchange, 'buy', buyQty);
              entryPrice = latestPrice;
              openBracket = computeBracket(entryPrice, {
                stopPct: runtimeCfg.stopPct,
                takePct: runtimeCfg.takePct,
              });
              lastTradeTs = Date.now();
              event = 'buy';

              position += buyQty;
              const tradePayload: TradeRecordPayload = {
                side: 'buy',
                amount: buyQty,
                price: latestPrice,
                event: 'signal',
                orderId: order?.id,
                symbol: CFG.symbol,
                ts: Date.now(),
                position,
                equity,
              };

              await recordTrade(tradePayload);

              await botLogger.info(`Long position opened: ${buyQty} at ${latestPrice}`, 'TRADE');
            } catch (error) {
              const message = error instanceof Error ? error.message : JSON.stringify(error);
              await botLogger.error(`Buy order failed: ${message}`, 'TRADE');
            }
          }
        }
      }

      if (isExitSignal && Math.abs(position) > thresholds.baseMin) {
        const closeQty = Math.abs(position);

        try {
          const order = await placeMarket(exchange, 'sell', closeQty);
          entryPrice = 0;
          openBracket = null;
          lastTradeTs = Date.now();
          event = 'exit';

          position = 0;
          const tradePayload: TradeRecordPayload = {
            side: 'sell',
            amount: closeQty,
            price: latestPrice,
            event: 'signal',
            orderId: order?.id,
            symbol: CFG.symbol,
            ts: Date.now(),
            position,
            equity,
          };

          await recordTrade(tradePayload);

          await botLogger.info(`Position closed via signal: sell ${closeQty}`, 'TRADE');
        } catch (error) {
          const message = error instanceof Error ? error.message : JSON.stringify(error);
          await botLogger.error(`Exit order failed: ${message}`, 'TRADE');
        }
      }

      const priceTickPayload: PriceTickPayload = {
        symbol: CFG.symbol,
        candleTs: latestSharedCandle.timestamp,
        open: latestSharedCandle.open,
        high: latestSharedCandle.high,
        low: latestSharedCandle.low,
        close: latestSharedCandle.close,
        volume: latestSharedCandle.volume,
        signal: latestSignal,
        position,
        equity,
        totalPnl,
        totalPnlPct,
        event,
        runtimeCfg,
      };

      await recordPriceTick(priceTickPayload);

      await publishSnapshot({
        price: latestPrice,
        signal: latestSignal,
        signals,
        position,
        entryPrice,
        openBracket,
        thresholds,
        equity,
        drawdown,
        totalPnl,
        totalPnlPct,
        mark,
        balances,
        lastTradeTs,
        event,
        runtimeCfg,
        candleTs: latestTs,
        candle: latestSharedCandle,
      });

      await sleep(loopIntervalMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      await botLogger.error(`Loop error: ${message}`, 'LOOP');

      await publishSnapshot({
        price: 0,
        signal: 'HOLD',
        signals: ['HOLD'],
        position: 0,
        entryPrice,
        openBracket,
        thresholds: { baseMin: 0, baseStep: 0, notionalMin: 0, tradable: 0 },
        equity: 0,
        drawdown: 0,
        totalPnl: 0,
        totalPnlPct: 0,
        mark: 0,
        balances: { quoteFree: 0, quoteTotal: 0, baseFree: 0, baseTotal: 0 },
        lastTradeTs,
        event: `error:${message}`,
        runtimeCfg: getDefaultRuntimeConfig(),
        candleTs: Date.now(),
        candle: null,
      });

      await sleep(10_000);
    }
  }
}

async function loadRuntimeConfig(): Promise<RuntimeCfg> {
  try {
    const overrides = await getRuntimeOverrides();
    return {
      rsiLen: overrides.rsiLen ?? CFG.rsiLen,
      rsiEntry: overrides.rsiEntry ?? CFG.rsiEntry,
      rsiExit: overrides.rsiExit ?? CFG.rsiExit,
      riskPerTrade: overrides.riskPerTrade ?? CFG.riskPerTrade,
      stopPct: overrides.stopPct ?? CFG.stopPct,
      takePct: overrides.takePct ?? CFG.takePct,
      cooldownMin: overrides.cooldownMin ?? CFG.cooldownMin,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await botLogger.warn(`Failed to load overrides: ${message}`, 'CONFIG');
    return getDefaultRuntimeConfig();
  }
}

function getDefaultRuntimeConfig(): RuntimeCfg {
  return {
    rsiLen: CFG.rsiLen,
    rsiEntry: CFG.rsiEntry,
    rsiExit: CFG.rsiExit,
    riskPerTrade: CFG.riskPerTrade,
    stopPct: CFG.stopPct,
    takePct: CFG.takePct,
    cooldownMin: CFG.cooldownMin,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function mapCandles(raw: OHLCV[]): StrategyCandle[] {
  return raw.map(([ts, open, high, low, close, volume]) => ({
    ts: typeof ts === 'number' ? ts : Date.now(),
    open: typeof open === 'number' ? open : 0,
    high: typeof high === 'number' ? high : 0,
    low: typeof low === 'number' ? low : 0,
    close: typeof close === 'number' ? close : 0,
    vol: typeof volume === 'number' ? volume : 0,
  }));
}

function toSharedCandle(candle: StrategyCandle): SharedCandle {
  return {
    timestamp: candle.ts,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.vol,
  };
}
