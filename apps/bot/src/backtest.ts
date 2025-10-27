import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { rsiReversionSignals, type Candle } from './strategy.js';
import { computeBracket, hitBracket, sizeByRisk } from './risk.js';
import { CFG } from './config.js';

/** CSV format assumed: ts,open,high,low,close,volume (ts in ms) */
function readCsv(filePath: string): Candle[] {
  const absPath = path.resolve(filePath);

  // 1. 파일 존재 확인
  if (!fs.existsSync(absPath)) {
    throw new Error(`CSV file not found: ${absPath}`);
  }

  const text = fs.readFileSync(absPath, 'utf8');
  const rows = parse(text, { columns: true }) as Record<string, string>[];

  // 2. 빈 파일 확인
  if (rows.length === 0) {
    throw new Error('CSV file is empty');
  }

  // 3. 필수 컬럼 확인
  const firstRow = rows[0];
  const requiredColumns = ['ts', 'open', 'high', 'low', 'close'];
  const missingColumns = requiredColumns.filter((col) => !(col in firstRow));
  if (missingColumns.length > 0) {
    throw new Error(`CSV missing required columns: ${missingColumns.join(', ')}. Found: ${Object.keys(firstRow).join(', ')}`);
  }

  let lastTs = -1;
  const candles = rows.map((row, idx) => {
    const lineNum = idx + 2; // CSV는 1번 줄이 헤더, 2번 줄부터 데이터

    // 4. 숫자 변환 및 검증
    const ts = Number(row.ts);
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    const vol = Number(row.volume ?? row.vol ?? 0);

    // NaN 확인
    if (Number.isNaN(ts)) {
      throw new Error(`Invalid timestamp at line ${lineNum}: "${row.ts}"`);
    }
    if (Number.isNaN(open)) {
      throw new Error(`Invalid open price at line ${lineNum}: "${row.open}"`);
    }
    if (Number.isNaN(high)) {
      throw new Error(`Invalid high price at line ${lineNum}: "${row.high}"`);
    }
    if (Number.isNaN(low)) {
      throw new Error(`Invalid low price at line ${lineNum}: "${row.low}"`);
    }
    if (Number.isNaN(close)) {
      throw new Error(`Invalid close price at line ${lineNum}: "${row.close}"`);
    }
    if (Number.isNaN(vol)) {
      throw new Error(`Invalid volume at line ${lineNum}: "${row.volume ?? row.vol}"`);
    }

    // Infinity 확인
    if (!Number.isFinite(ts) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
      throw new Error(`Infinite value detected at line ${lineNum}`);
    }

    // 음수 가격 확인
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
      throw new Error(`Non-positive price at line ${lineNum}: open=${open}, high=${high}, low=${low}, close=${close}`);
    }

    // OHLC 논리 검증 (high >= low, high >= open, high >= close, low <= open, low <= close)
    if (high < low) {
      throw new Error(`High (${high}) < Low (${low}) at line ${lineNum}`);
    }
    if (high < open || high < close) {
      throw new Error(`High (${high}) is less than open (${open}) or close (${close}) at line ${lineNum}`);
    }
    if (low > open || low > close) {
      throw new Error(`Low (${low}) is greater than open (${open}) or close (${close}) at line ${lineNum}`);
    }

    // 5. 타임스탬프 순차 증가 확인
    if (ts <= lastTs) {
      throw new Error(`Timestamp not increasing at line ${lineNum}: ${ts} <= ${lastTs}`);
    }
    lastTs = ts;

    // 음수 볼륨 확인
    if (vol < 0) {
      throw new Error(`Negative volume at line ${lineNum}: ${vol}`);
    }

    return { ts, open, high, low, close, vol };
  });

  return candles;
}

function backtest(candles: Candle[]) {
  const signals = rsiReversionSignals(candles, { rsiLen: CFG.rsiLen, entry: CFG.rsiEntry, exit: CFG.rsiExit }); // 캔들별 전략 시그널
  let cash = 10000; // 쿼트 통화 잔고(예: USDT)
  let qty = 0; // 보유 중인 베이스 자산 수량(예: BTC)
  let entryPrice = 0; // 현재 포지션의 진입 가격
  let bracket: ReturnType<typeof computeBracket> | null = null; // 활성화된 스탑/익절 구간
  const equityCurve: number[] = []; // 시간별 총 평가금액 기록

  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];
    const price = candle.close; // 현재 단계에서의 기준 가격
    const equity = cash + qty * price; // 실현/미실현 손익을 모두 반영한 평가금액
    equityCurve.push(equity);

    if (qty > 0 && bracket) {
      const hit = hitBracket(price, bracket); // 손절 또는 익절 조건 충족 여부
      if (hit) {
        cash += qty * price * (1 - 0.0006);
        qty = 0;
        bracket = null;
        entryPrice = 0;
        continue;
      }
    }

    const signal = signals[i]; // 현재 캔들의 시그널
    if (signal === 'LONG' && qty === 0) {
      const size = sizeByRisk(equity, price);
      const feeAdj = size * price * 0.0006;
      const spend = Math.min(cash, size * price + feeAdj);
      const buyQty = spend / price;
      if (buyQty > 0) {
        qty += buyQty;
        cash -= spend;
        entryPrice = price;
        bracket = computeBracket(entryPrice);
      }
    } else if (signal === 'EXIT' && qty > 0) {
      cash += qty * price * (1 - 0.0006);
      qty = 0;
      bracket = null;
      entryPrice = 0;
    }
  }

  const finalEquity = cash + qty * candles.at(-1)!.close;
  const ret = finalEquity / 10000 - 1;
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
