'use client';

import { useMemo } from 'react';
import type { HistoryCandle } from '@scalper/shared';

const WIDTH = 800;
const HEIGHT = 320;
const PAD_X = 60;
const PAD_Y = 36;
const CANDLE_GAP = 0.25;

function formatHourLabel(ts: number): string {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(ts));
}

function formatPriceLabel(value: number): string {
  return new Intl.NumberFormat('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

type CandlestickChartProps = {
  candles: HistoryCandle[];
  emptyLabel?: string;
};

type CandleRender = {
  x: number;
  wickTop: number;
  wickBottom: number;
  bodyTop: number;
  bodyBottom: number;
  bodyHeight: number;
  isBullish: boolean;
  timestamp: number;
};

type AxisTick = {
  x: number;
  label: string;
};

type YTick = {
  y: number;
  label: string;
};

type ChartDataset = {
  renders: CandleRender[];
  xTicks: AxisTick[];
  yTicks: YTick[];
  bodyWidth: number;
};

export function CandlestickChart({ candles, emptyLabel = '표시할 데이터가 없습니다.' }: CandlestickChartProps): JSX.Element {
  const dataset = useMemo<ChartDataset | null>(() => {
    if (!candles || candles.length === 0) {
      return null;
    }

    const lows = candles.map((candle) => candle.low);
    const highs = candles.map((candle) => candle.high);
    const minPrice = Math.min(...lows);
    const maxPrice = Math.max(...highs);
    const range = maxPrice - minPrice || 1;

    const innerWidth = WIDTH - PAD_X * 2;
    const innerHeight = HEIGHT - PAD_Y * 2;
    const candleWidth = innerWidth / Math.max(candles.length, 1);
    const bodyWidth = candleWidth * (1 - CANDLE_GAP);

    const scaleY = (price: number) => PAD_Y + innerHeight - ((price - minPrice) / range) * innerHeight;

    const renders: CandleRender[] = candles.map((candle, index) => {
      const centerX = PAD_X + candleWidth * index + candleWidth / 2;
      const highY = scaleY(candle.high);
      const lowY = scaleY(candle.low);
      const openY = scaleY(candle.open);
      const closeY = scaleY(candle.close);
      const isBullish = candle.close >= candle.open;
      const bodyTop = isBullish ? closeY : openY;
      const bodyBottom = isBullish ? openY : closeY;
      const bodyHeight = Math.max(Math.abs(closeY - openY), 2);
      return {
        x: centerX,
        wickTop: highY,
        wickBottom: lowY,
        bodyTop,
        bodyBottom,
        bodyHeight,
        isBullish,
        timestamp: candle.timestamp,
      };
    });

    const tickCount = Math.min(6, candles.length);
    const tickStep = candles.length > 1 ? Math.floor((candles.length - 1) / (tickCount - 1 || 1)) : 1;
    const xTicks: AxisTick[] = [];
    for (let i = 0; i < candles.length; i += tickStep) {
      const candle = candles[i];
      const centerX = PAD_X + candleWidth * i + candleWidth / 2;
      xTicks.push({ x: centerX, label: formatHourLabel(candle.timestamp) });
      if (xTicks.length === tickCount) break;
    }

    const yTicks: YTick[] = [minPrice, minPrice + range / 2, maxPrice].map((value) => ({
      y: scaleY(value),
      label: formatPriceLabel(value),
    }));

    return { renders, xTicks, yTicks, bodyWidth };
  }, [candles]);

  if (!dataset) {
    return <p className="chart-empty">{emptyLabel}</p>;
  }

  return (
    <div className="chart-wrapper">
      <svg className="chart-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Hourly candlestick chart">
        {dataset.yTicks.map((tick, idx) => (
          <g key={`y-${idx}`} transform={`translate(0, ${tick.y})`}>
            <line x1={PAD_X} x2={WIDTH - PAD_X} className="chart-grid" />
            <text x="12" y="4" className="chart-label">
              {tick.label}
            </text>
          </g>
        ))}

        {dataset.renders.map((candle, idx) => (
          <g key={`candle-${idx}`}>
            <line
              x1={candle.x}
              x2={candle.x}
              y1={candle.wickTop}
              y2={candle.wickBottom}
              className="candle-wick"
            />
            <rect
              x={candle.x - dataset.bodyWidth / 2}
              y={Math.min(candle.bodyTop, candle.bodyBottom)}
              width={dataset.bodyWidth}
              height={candle.bodyHeight}
              rx={2}
              className={candle.isBullish ? 'candle-body bullish' : 'candle-body bearish'}
            />
          </g>
        ))}

        {dataset.xTicks.map((tick, idx) => (
          <g key={`x-${idx}`} transform={`translate(${tick.x}, ${HEIGHT - PAD_Y})`}>
            <line y2="8" className="chart-axis" />
            <text y="22" textAnchor="middle" className="chart-label">
              {tick.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
