import type { Exchange } from 'ccxt';
import { botLogger, type Candle, type Signal } from '@scalper/shared';
import {
  connect,
  fetchOHLCV,
  getPositionQty,
  placeMarket,
  quotePrecision,
  toAmountPrecision,
} from './exchange.js';
import { rsiReversionSignals } from './strategy.js';
import { sizeByRisk, computeBracket, hitBracket, withinCooldown } from './risk.js';
import { prepareStorage, recordPriceTick, recordTrade } from './storage.js';
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

  while (true) {
    try {
      const [candles, runtimeCfg] = await Promise.all([
        fetchOHLCV(exchange, maxCandles),
        loadRuntimeConfig(),
      ]);

      if (candles.length === 0) {
        await botLogger.warn('No candle data available', 'LOOP');
        await sleep(loopIntervalMs);
        continue;
      }

      const latestCandle = candles[candles.length - 1];
      const latestTs = latestCandle.timestamp;
      const latestPrice = latestCandle.close;

      signals = rsiReversionSignals(
        candles,
        runtimeCfg.rsiLen,
        runtimeCfg.rsiEntry,
        runtimeCfg.rsiExit
      );
      const latestSignal = signals[signals.length - 1] ?? 'HOLD';

      const currentPosition = await getPositionQty(exchange);
      const { equity, balances, mark } = await calculateEquity(exchange);

      equityHwm = Math.max(equityHwm, equity);
      const drawdown = equityHwm > 0 ? (equity - equityHwm) / equityHwm : 0;

      const thresholds = {
        baseMin: exchange.market(CFG.symbol)?.limits?.amount?.min ?? 0,
        baseStep: exchange.market(CFG.symbol)?.precision?.amount ?? 0,
        notionalMin: exchange.market(CFG.symbol)?.limits?.cost?.min ?? 0,
        tradable: await quotePrecision(exchange),
      };

      await recordPriceTick({
        candle: latestCandle,
        equity,
        drawdown,
        signal: latestSignal,
        position: currentPosition,
        entryPrice,
        openBracket,
      });

      let event = 'idle';

      if (openBracket && hitBracket(latestPrice, openBracket)) {
        await botLogger.info(`Bracket hit at price ${latestPrice}`, 'TRADE');

        if (Math.abs(currentPosition) > thresholds.baseMin) {
          const closeSide = currentPosition > 0 ? 'sell' : 'buy';
          const closeQty = Math.abs(currentPosition);

          try {
            const order = await placeMarket(exchange, closeSide, closeQty);
            await recordTrade({
              side: closeSide,
              qty: closeQty,
              price: latestPrice,
              event: 'bracket',
              orderId: order?.id,
            });

            lastTradeTs = Date.now();
            event = closeSide === 'sell' ? 'take-profit' : 'stop-loss';
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

      if (isLongSignal && Math.abs(currentPosition) < thresholds.baseMin) {
        if (withinCooldown(lastTradeTs, runtimeCfg.cooldownMin)) {
          await botLogger.info('Trade skipped due to cooldown', 'COOLDOWN');
        } else {
          const tradeSize = sizeByRisk(
            equity,
            latestPrice,
            runtimeCfg.riskPerTrade,
            runtimeCfg.stopPct
          );
          const buyQty = await toAmountPrecision(exchange, tradeSize);

          if (buyQty >= thresholds.baseMin && buyQty * latestPrice >= thresholds.notionalMin) {
            try {
              const order = await placeMarket(exchange, 'buy', buyQty);
              entryPrice = latestPrice;
              openBracket = computeBracket(entryPrice, runtimeCfg.stopPct, runtimeCfg.takePct);
              lastTradeTs = Date.now();
              event = 'buy';

              await recordTrade({
                side: 'buy',
                qty: buyQty,
                price: latestPrice,
                event: 'signal',
                orderId: order?.id,
              });

              await botLogger.info(`Long position opened: ${buyQty} at ${latestPrice}`, 'TRADE');
            } catch (error) {
              const message = error instanceof Error ? error.message : JSON.stringify(error);
              await botLogger.error(`Buy order failed: ${message}`, 'TRADE');
            }
          }
        }
      }

      if (isExitSignal && Math.abs(currentPosition) > thresholds.baseMin) {
        const closeQty = Math.abs(currentPosition);

        try {
          const order = await placeMarket(exchange, 'sell', closeQty);
          entryPrice = 0;
          openBracket = null;
          lastTradeTs = Date.now();
          event = 'exit';

          await recordTrade({
            side: 'sell',
            qty: closeQty,
            price: latestPrice,
            event: 'signal',
            orderId: order?.id,
          });

          await botLogger.info(`Position closed via signal: sell ${closeQty}`, 'TRADE');
        } catch (error) {
          const message = error instanceof Error ? error.message : JSON.stringify(error);
          await botLogger.error(`Exit order failed: ${message}`, 'TRADE');
        }
      }

      await publishSnapshot({
        price: latestPrice,
        signal: latestSignal,
        signals,
        position: currentPosition,
        entryPrice,
        openBracket,
        thresholds,
        equity,
        drawdown,
        mark,
        balances,
        lastTradeTs,
        event,
        runtimeCfg,
        candleTs: latestTs,
        candle: latestCandle,
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
  // This would load from runtime overrides file
  // For now, return default config
  return getDefaultRuntimeConfig();
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
