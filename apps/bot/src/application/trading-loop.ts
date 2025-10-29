import type { Exchange, OHLCV } from 'ccxt';
import { botLogger, type Candle as SharedCandle, type Signal, getRuntimeOverrides } from '@scalper/shared';
import {
  connect,
  fetchOHLCV,
  getPositionQty,
  placeMarket,
  quotePrecision,
  toAmountPrecision,
} from '@scalper/bot/infrastructure/exchange.js';
import {
  rsiReversionSignals,
  sizeByRisk,
  computeBracket,
  hitBracket,
  withinCooldown,
  type Candle as StrategyCandle,
  type Bracket,
} from '@scalper/domain';
import {
  prepareStorage,
  recordPriceTick,
  recordTrade,
  type PriceTickPayload,
  type TradeRecordPayload,
} from '@scalper/bot/infrastructure/storage.js';
import { calculateEquity } from '@scalper/bot/infrastructure/balance.js';
import { publishSnapshot, type RuntimeCfg } from '@scalper/bot/infrastructure/telemetry.js';
import { CFG } from '@scalper/bot/infrastructure/config.js';

export async function executeTradingLoop(): Promise<void> {
  await botLogger.info('Starting trading loop', 'LOOP');

  const exchange = await connect();
  const maxCandles = 500;
  const loopIntervalMs = 30_000;

  await prepareStorage();

  let entryPrice = 0;
  let openBracket: Bracket | null = null;
  let lastTradeTs: number | null = null;
  let signals: Signal[] = [];
  let equityHwm = 0;
  let initialEquity: number | null = null;

  // Circuit breaker state
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 5;
  let errorBackoffMs = 10_000;

  while (true) {
    try {
      // Fetch candles and runtime config with individual error handling
      let rawCandles: OHLCV[];
      let runtimeCfg: RuntimeCfg;

      try {
        [rawCandles, runtimeCfg] = await Promise.all([
          fetchOHLCV(exchange, maxCandles),
          loadRuntimeConfig(),
        ]);
      } catch (error) {
        // Handle partial failures
        const message = error instanceof Error ? error.message : String(error);
        await botLogger.error(`Failed to fetch data: ${message}`, 'LOOP');

        // Try individual fetches as fallback
        try {
          rawCandles = await fetchOHLCV(exchange, maxCandles);
          runtimeCfg = await loadRuntimeConfig();
        } catch (fallbackError) {
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          await botLogger.error(`Fallback fetch also failed: ${fallbackMessage}`, 'LOOP');
          throw error; // Re-throw original error to trigger outer catch
        }
      }

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

      let bracketHit: 'STOP' | 'TAKE' | null = null;
      try {
        bracketHit = openBracket ? hitBracket(latestPrice, openBracket) : null;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await botLogger.error(`Bracket validation failed: ${message}`, 'TRADE');
        // Reset invalid bracket
        openBracket = null;
      }

      if (openBracket && bracketHit) {
        await botLogger.info(`Bracket hit (${bracketHit}) at price ${latestPrice}`, 'TRADE');

        if (Math.abs(position) > thresholds.baseMin) {
          const closeSide = position > 0 ? 'sell' : 'buy';
          const closeQty = Math.abs(position);

          try {
            const order = await placeMarket(exchange, closeSide, closeQty);

            // Verify position was actually closed
            const newPosition = await getPositionQty(exchange);

            if (Math.abs(newPosition) > thresholds.baseMin) {
              await botLogger.warn(
                `Position not fully closed. Expected 0, got ${newPosition}`,
                'TRADE'
              );
              position = newPosition;
            } else {
              position = 0;
            }

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
            const message = error instanceof Error ? error.message : String(error);
            const stack = error instanceof Error ? error.stack : undefined;
            await botLogger.error(`Bracket close failed: ${message}`, 'TRADE');
            if (stack) {
              await botLogger.debug(stack, 'TRADE');
            }
            // Don't update position on failure
            continue;
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
          const buyQty = toAmountPrecision(exchange, tradeSize);

          if (buyQty >= thresholds.baseMin && buyQty * latestPrice >= thresholds.notionalMin) {
            try {
              const order = await placeMarket(exchange, 'buy', buyQty);

              // Verify position was actually opened
              const newPosition = await getPositionQty(exchange);

              if (newPosition < thresholds.baseMin) {
                await botLogger.warn(
                  `Position not opened. Expected ~${buyQty}, got ${newPosition}`,
                  'TRADE'
                );
                position = newPosition;
                // Don't set entryPrice or bracket if position didn't open
              } else {
                position = newPosition;
                entryPrice = latestPrice;

                try {
                  openBracket = computeBracket(entryPrice, {
                    stopPct: runtimeCfg.stopPct,
                    takePct: runtimeCfg.takePct,
                  });
                } catch (bracketError) {
                  const bracketMessage = bracketError instanceof Error ? bracketError.message : String(bracketError);
                  await botLogger.error(`Failed to compute bracket: ${bracketMessage}`, 'TRADE');
                  openBracket = null;
                }

                lastTradeTs = Date.now();
                event = 'buy';

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
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              const stack = error instanceof Error ? error.stack : undefined;
              await botLogger.error(`Buy order failed: ${message}`, 'TRADE');
              if (stack) {
                await botLogger.debug(stack, 'TRADE');
              }
            }
          }
        }
      }

      if (isExitSignal && Math.abs(position) > thresholds.baseMin) {
        const closeQty = Math.abs(position);

        try {
          const order = await placeMarket(exchange, 'sell', closeQty);

          // Verify position was actually closed
          const newPosition = await getPositionQty(exchange);

          if (Math.abs(newPosition) > thresholds.baseMin) {
            await botLogger.warn(
              `Position not fully closed. Expected 0, got ${newPosition}`,
              'TRADE'
            );
            position = newPosition;
          } else {
            position = 0;
          }

          entryPrice = 0;
          openBracket = null;
          lastTradeTs = Date.now();
          event = 'exit';

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
          const message = error instanceof Error ? error.message : String(error);
          const stack = error instanceof Error ? error.stack : undefined;
          await botLogger.error(`Exit order failed: ${message}`, 'TRADE');
          if (stack) {
            await botLogger.debug(stack, 'TRADE');
          }
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

      // Reset error counter on successful loop iteration
      consecutiveErrors = 0;
      errorBackoffMs = 10_000;

      await sleep(loopIntervalMs);
    } catch (error) {
      consecutiveErrors++;

      const message = error instanceof Error ? error.message : JSON.stringify(error);
      const stack = error instanceof Error ? error.stack : undefined;

      await botLogger.error(
        `Loop error (${consecutiveErrors}/${maxConsecutiveErrors}): ${message}`,
        'LOOP'
      );

      if (stack) {
        await botLogger.debug(stack, 'LOOP');
      }

      // Circuit breaker: if too many consecutive errors, exit
      if (consecutiveErrors >= maxConsecutiveErrors) {
        await botLogger.error(
          `Circuit breaker triggered after ${consecutiveErrors} consecutive errors. Exiting.`,
          'LOOP'
        );

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
          event: `circuit-breaker:${message}`,
          runtimeCfg: getDefaultRuntimeConfig(),
          candleTs: Date.now(),
          candle: null,
        });

        throw new Error(`Trading loop stopped due to circuit breaker: ${message}`);
      }

      // Publish error snapshot
      try {
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
      } catch (snapshotError) {
        // Don't crash loop if snapshot fails
        await botLogger.warn('Failed to publish error snapshot', 'LOOP');
      }

      // Exponential backoff with max limit
      const maxBackoff = 60_000; // 1 minute max
      errorBackoffMs = Math.min(errorBackoffMs * 2, maxBackoff);

      await botLogger.info(`Retrying in ${errorBackoffMs / 1000}s...`, 'LOOP');
      await sleep(errorBackoffMs);
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
  const candles: StrategyCandle[] = [];
  for (const [ts, open, high, low, close, volume] of raw) {
    const tsNum = typeof ts === 'number' ? ts : Number(ts);
    const openNum = typeof open === 'number' ? open : Number(open);
    const highNum = typeof high === 'number' ? high : Number(high);
    const lowNum = typeof low === 'number' ? low : Number(low);
    const closeNum = typeof close === 'number' ? close : Number(close);
    const volumeNum = typeof volume === 'number' ? volume : Number(volume);

    if (
      !Number.isFinite(tsNum) ||
      !Number.isFinite(openNum) ||
      !Number.isFinite(highNum) ||
      !Number.isFinite(lowNum) ||
      !Number.isFinite(closeNum) ||
      !Number.isFinite(volumeNum)
    ) {
      continue;
    }

    candles.push({
      ts: tsNum,
      open: openNum,
      high: highNum,
      low: lowNum,
      close: closeNum,
      vol: volumeNum,
    });
  }
  return candles;
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
