import type { Exchange } from 'ccxt';
import { connect, fetchOHLCV, getPositionQty, placeMarket, quotePrecision, toAmountPrecision } from './exchange.js';
import { rsiReversionSignals, type Candle } from './strategy.js';
import { sizeByRisk, computeBracket, hitBracket, withinCooldown } from './risk.js';
import { CFG } from './config.js';

let lastTradeTs: number | null = null; // 마지막 체결 시각(ms)
let openBracket: ReturnType<typeof computeBracket> | null = null; // 현재 포지션의 스탑/익절 정보
let entryPrice = 0; // 현재 포지션 진입가

async function loop() {
  console.log('Loading exchange...');
  const exchange = await connect(); // ccxt 거래소 인스턴스
  console.log('Exchange loaded.');

  const { baseMin, baseStep, notionalMin } = await quotePrecision(exchange); // 최소 주문 수량과 스텝
  console.log(`Base min: ${baseMin}, step: ${baseStep}, notional min: ${notionalMin}`);
  const dayStartEquity = await equityQuote(exchange); // 일 시작 시점 평가금액

  console.log(`Starting bot on ${CFG.exchange} ${CFG.symbol} (sandbox=${CFG.useSandbox})`);
  let lastBarTs = 0;
  while (true) {
    try {
      const raw = await fetchOHLCV(exchange, 300); // 최신 OHLCV 캔들
      const candles: Candle[] = raw.map((row) => ({
        ts: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        vol: Number(row[5]),
      }));
      const latestTs = candles.at(-1)?.ts ?? 0; // 가장 최근 캔들 시간
      if (latestTs === lastBarTs) {
        await sleep(30_000);
        continue;
      }
      lastBarTs = latestTs;

      const equity = await equityQuote(exchange); // 현재 평가금액
      const drawdown = (equity / dayStartEquity - 1) * 100; // 일일 손익률
      console.log(`Current equity: ${equity.toFixed(2)} (${drawdown.toFixed(2)}%)`);
      if (drawdown <= -CFG.maxDailyLossPct) {
        console.warn(`[GUARD] Daily loss ${drawdown.toFixed(2)}% ≤ -${CFG.maxDailyLossPct}% → halt`);
        await sleep(60_000);
        continue;
      }

      const signals = rsiReversionSignals(candles, { rsiLen: CFG.rsiLen, entry: CFG.rsiEntry, exit: CFG.rsiExit });
      console.log(signals.slice(-10).reverse());
      const signal = signals.at(-1)!; // 최신 캔들에 대한 시그널
      const price = candles.at(-1)!.close; // 현재 종가
      const position = await getPositionQty(exchange); // 보유 수량
      const tradableThreshold = Math.max(baseMin, notionalMin > 0 ? notionalMin / price : 0);

      if (position > 0 && openBracket) {
        const hit = hitBracket(price, openBracket);
        if (hit) {
          let amount = Math.max(toAmountPrecision(exchange, position), 0);
          if (amount < tradableThreshold && position >= tradableThreshold) {
            amount = tradableThreshold;
          } else if (amount > position) {
            amount = position;
          }
          const notional = amount * price;
          if (amount >= tradableThreshold && notional >= notionalMin) {
            await placeMarket(exchange, 'sell', amount);
            openBracket = null;
            entryPrice = 0;
            lastTradeTs = Date.now();
            console.log(`[${hit}] exit @ ~${price}`);
            await sleep(5_000);
            continue;
          }
          console.log(
            `[SKIP] Bracket exit size too small (amount=${amount}, notional=${notional}, minAmount=${tradableThreshold}, minNotional=${notionalMin})`
          );
          await sleep(5_000);
          continue;
        }
      }

      console.log(position);

      if (signal === 'LONG' && position < 1) {
        console.log('It is time to long');
        if (withinCooldown(lastTradeTs)) {
          console.log('[COOLDOWN] Skip long');
          await sleep(5_000);
          continue;
        }
        const eqQuote = await equityQuote(exchange); // 최신 평가금액
        const rawQty = sizeByRisk(eqQuote, price); // 위험 비율 기반 수량
        let amount = Math.max(toAmountPrecision(exchange, rawQty), 0); // 거래소 정밀도에 맞춘 수량
        if (amount < tradableThreshold && rawQty >= tradableThreshold) {
          amount = tradableThreshold;
        }
        const notional = amount * price;
        console.log(
          `buying amount : ${amount}, price : ${price}, eqQuote : ${eqQuote}, rawQty : ${rawQty}, baseMin : ${baseMin}, minNotional : ${notionalMin}, notional : ${notional}`
        );
        if (amount >= tradableThreshold && notional >= notionalMin) {
          await placeMarket(exchange, 'buy', amount);
          entryPrice = price;
          openBracket = computeBracket(entryPrice);
          lastTradeTs = Date.now();
          console.log(`BUY ${amount} @ ~${price} bracket=${JSON.stringify(openBracket)}`);
        } else {
          console.log(
            `[SKIP] Long size too small (amount=${amount}, minAmount=${tradableThreshold}, notional=${notional}, minNotional=${notionalMin})`
          );
        }
      } else if (signal === 'EXIT' && position > 0) {
        let amount = Math.max(toAmountPrecision(exchange, position), 0);
        if (amount < tradableThreshold && position >= tradableThreshold) {
          amount = tradableThreshold;
        } else if (amount > position) {
          amount = position;
        }
        const notional = amount * price;
        if (amount >= tradableThreshold && notional >= notionalMin) {
          await placeMarket(exchange, 'sell', amount);
          openBracket = null;
          entryPrice = 0;
          lastTradeTs = Date.now();
          console.log(`EXIT @ ~${price}`);
        } else {
          console.log(
            `[SKIP] Exit size too small (amount=${amount}, minAmount=${tradableThreshold}, notional=${notional}, minNotional=${notionalMin})`
          );
        }
      }

      await sleep(30_000);
    } catch (error) {
      console.dir(error);
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      console.error('Loop error:', message);
      await sleep(10_000);
    }
  }
}

async function equityQuote(exchange: Exchange): Promise<number> {
  const balance = await exchange.fetchBalance(); // 거래소 잔고
  const market = exchange.market(CFG.symbol);
  const quoteCode = typeof market?.quote === 'string' ? market.quote : CFG.quote;
  const baseCode = typeof market?.base === 'string' ? market.base : CFG.base;
  console.log('Balance:', { QUOTE: balance[quoteCode], BASE: balance[baseCode] });
  const quote = balance[quoteCode];
  const base = balance[baseCode];
  const quoteFree = typeof quote?.free === 'number' ? quote.free : 0; // 사용 가능한 쿼트 잔고
  const baseQty = typeof base?.total === 'number' ? base.total : typeof base?.free === 'number' ? base.free : 0;
  let mark = 0; // 베이스 자산 마킹 가격
  try {
    const ticker = await exchange.fetchTicker(CFG.symbol); // 최신 호가로 마킹
    mark = (ticker?.last ?? ticker?.close ?? 0) as number;
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    console.warn('Ticker fetch failed:', message);
  }
  return quoteFree + baseQty * (mark || 0);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

loop().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
