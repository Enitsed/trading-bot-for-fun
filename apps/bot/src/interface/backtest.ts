import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import {
  rsiReversionSignals,
  type Candle,
  computeBracket,
  hitBracket,
  sizeByRisk,
  type Bracket,
} from '@scalper/domain';
import { CFG } from '@scalper/bot/infrastructure/config.js';
import { DEFAULT_FEE_RATE } from '@scalper/shared';

/** CSV format assumed: ts,open,high,low,close,volume (ts in ms) */
function readCsv(filePath: string): Candle[] {
  const absPath = path.resolve(filePath);
  const text = fs.readFileSync(absPath, 'utf8');
  const rows = parse(text, { columns: true });
  return rows.map((row: Record<string, string>) => ({
    ts: Number(row.ts),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    vol: Number(row.volume ?? row.vol ?? 0),
  }));
}

/** 백테스트 초기 자본 (USDT) */
const INITIAL_EQUITY = 10000;

function backtest(candles: Candle[]) {
  const signals = rsiReversionSignals(candles, { rsiLen: CFG.rsiLen, entry: CFG.rsiEntry, exit: CFG.rsiExit }); // 캔들별 전략 시그널
  let cash = INITIAL_EQUITY; // 쿼트 통화 잔고(예: USDT)
  let qty = 0; // 보유 중인 베이스 자산 수량(예: BTC)
  let entryPrice = 0; // 현재 포지션의 진입 가격
  let bracket: Bracket | null = null; // 활성화된 스탑/익절 구간
  const equityCurve: number[] = []; // 시간별 총 평가금액 기록

  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];
    const price = candle.close; // 현재 단계에서의 기준 가격
    const equity = cash + qty * price; // 실현/미실현 손익을 모두 반영한 평가금액
    equityCurve.push(equity);

    if (qty > 0 && bracket) {
      const hit = hitBracket(price, bracket); // 손절 또는 익절 조건 충족 여부
      if (hit) {
        cash += qty * price * (1 - DEFAULT_FEE_RATE);
        qty = 0;
        bracket = null;
        entryPrice = 0;
        continue;
      }
    }

    const signal = signals[i]; // 현재 캔들의 시그널
    if (signal === 'LONG' && qty === 0) {
      const size = sizeByRisk(equity, price, CFG.riskPerTrade);
      const feeAdj = size * price * DEFAULT_FEE_RATE;
      const spend = Math.min(cash, size * price + feeAdj);
      const buyQty = spend / price;
      if (buyQty > 0) {
        qty += buyQty;
        cash -= spend;
        entryPrice = price;
        bracket = computeBracket(entryPrice, { stopPct: CFG.stopPct, takePct: CFG.takePct });
      }
    } else if (signal === 'EXIT' && qty > 0) {
      cash += qty * price * (1 - DEFAULT_FEE_RATE);
      qty = 0;
      bracket = null;
      entryPrice = 0;
    }
  }

  const finalEquity = cash + qty * candles.at(-1)!.close;
  const ret = finalEquity / INITIAL_EQUITY - 1;
  const maxDrawdown = (() => {
    let peak = equityCurve[0] || 0;
    let mdd = 0;
    for (const value of equityCurve) {
      peak = Math.max(peak, value);
      if (peak > 0) {
        mdd = Math.min(mdd, value / peak - 1);
      }
    }
    return mdd;
  })();
  console.log({
    finalEquity: finalEquity.toFixed(2),
    returnPct: `${(ret * 100).toFixed(2)}%`,
    maxDD: `${(maxDrawdown * 100).toFixed(2)}%`,
  });
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node dist/backtest.js <data.csv>');
    process.exit(1);
  }
  const candles = readCsv(input);
  if (!candles.length) {
    console.error('No candles parsed from CSV.');
    process.exit(1);
  }
  backtest(candles);
}

main();
