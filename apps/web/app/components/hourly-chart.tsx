'use client';

import { useMemo } from 'react';
import type { HistoryCandle } from '../../lib/types';

const WIDTH = 800;
const HEIGHT = 260;
const PAD_X = 40;
const PAD_Y = 28;

function formatHourLabel(ts: number): string {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(ts));
}

type ChartTick = {
  x: number;
  label: string;
};

type ChartYTick = {
  y: number;
  label: string;
};

type ChartDataset = {
  minClose: number;
  maxClose: number;
  points: string;
  area: string;
  ticks: ChartTick[];
  yTicks: ChartYTick[];
};

type HourlyChartProps = {
  candles: HistoryCandle[];
};

export function HourlyChart({ candles }: HourlyChartProps): JSX.Element {
  const dataset = useMemo<ChartDataset | null>(() => {
    if (!candles || candles.length === 0) {
      return null;
    }
    const closes = candles.map((item) => item.close);
    const minClose = Math.min(...closes);
    const maxClose = Math.max(...closes);
    const range = maxClose - minClose || 1;
    const innerWidth = WIDTH - PAD_X * 2;
    const innerHeight = HEIGHT - PAD_Y * 2;

    const points = candles.map((item, idx) => {
      const x = PAD_X + (candles.length > 1 ? (innerWidth * idx) / (candles.length - 1) : innerWidth / 2);
      const y = PAD_Y + innerHeight - ((item.close - minClose) / range) * innerHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });

    const fills = [...points];
    fills.push(`${WIDTH - PAD_X},${HEIGHT - PAD_Y}`);
    fills.push(`${PAD_X},${HEIGHT - PAD_Y}`);

    const tickCount = Math.min(5, candles.length);
    const tickStep = candles.length > 1 ? Math.floor((candles.length - 1) / (tickCount - 1 || 1)) : 1;
    const ticks: ChartTick[] = [];
    for (let i = 0; i < candles.length; i += tickStep) {
      const candle = candles[i];
      const x = PAD_X + (candles.length > 1 ? (innerWidth * i) / (candles.length - 1) : innerWidth / 2);
      ticks.push({ x, label: formatHourLabel(candle.timestamp) });
      if (ticks.length === tickCount) break;
    }

    const yTicks: ChartYTick[] = [minClose, minClose + range / 2, maxClose].map((value) => ({
      y: PAD_Y + innerHeight - ((value - minClose) / range) * innerHeight,
      label: new Intl.NumberFormat('ko-KR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value),
    }));

    return {
      minClose,
      maxClose,
      ticks,
      yTicks,
      points: points.join(' '),
      area: fills.join(' '),
    };
  }, [candles]);

  if (!dataset) {
    return <p className="chart-empty">표시할 데이터가 없습니다.</p>;
  }

  return (
    <div className="chart-wrapper">
      <svg className="chart-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Hourly price chart">
        <defs>
          <linearGradient id="price-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(96, 165, 250, 0.45)" />
            <stop offset="100%" stopColor="rgba(96, 165, 250, 0)" />
          </linearGradient>
        </defs>

        <polyline className="chart-area" points={dataset.area} fill="url(#price-gradient)" />
        <polyline className="chart-line" points={dataset.points} fill="none" />

        {dataset.ticks.map((tick, idx) => (
          <g key={`${tick.label}-${idx}`} transform={`translate(${tick.x}, ${HEIGHT - PAD_Y})`}>
            <line y2="8" className="chart-axis" />
            <text y="20" textAnchor="middle" className="chart-label">
              {tick.label}
            </text>
          </g>
        ))}

        {dataset.yTicks.map((tick, idx) => (
          <g key={`yt-${idx}`} transform={`translate(0, ${tick.y})`}>
            <line x1={PAD_X} x2={WIDTH - PAD_X} className="chart-grid" />
            <text x="12" y="4" className="chart-label">
              {tick.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
