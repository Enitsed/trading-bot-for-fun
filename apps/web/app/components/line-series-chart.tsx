'use client';

import { useMemo } from 'react';
import type { LinePoint } from '../../lib/types';

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
  points: string;
  area: string;
  ticks: ChartTick[];
  yTicks: ChartYTick[];
};

type LineSeriesChartProps = {
  points: LinePoint[];
  emptyLabel?: string;
  color?: string;
  gradientId?: string;
};

export function LineSeriesChart({
  points: inputPoints,
  emptyLabel = '표시할 데이터가 없습니다.',
  color = '#60a5fa',
  gradientId = 'series-gradient',
}: LineSeriesChartProps): JSX.Element {
  const dataset = useMemo<ChartDataset | null>(() => {
    if (!inputPoints || inputPoints.length === 0) {
      return null;
    }
    const values = inputPoints.map((item) => item.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const range = maxValue - minValue || 1;
    const innerWidth = WIDTH - PAD_X * 2;
    const innerHeight = HEIGHT - PAD_Y * 2;

    const points = inputPoints.map((item, idx) => {
      const x = PAD_X + (inputPoints.length > 1 ? (innerWidth * idx) / (inputPoints.length - 1) : innerWidth / 2);
      const y = PAD_Y + innerHeight - ((item.value - minValue) / range) * innerHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });

    const fills = [...points];
    fills.push(`${WIDTH - PAD_X},${HEIGHT - PAD_Y}`);
    fills.push(`${PAD_X},${HEIGHT - PAD_Y}`);

    const tickCount = Math.min(5, inputPoints.length);
    const tickStep = inputPoints.length > 1 ? Math.floor((inputPoints.length - 1) / (tickCount - 1 || 1)) : 1;
    const ticks: ChartTick[] = [];
    for (let i = 0; i < inputPoints.length; i += tickStep) {
      const point = inputPoints[i];
      const x = PAD_X + (inputPoints.length > 1 ? (innerWidth * i) / (inputPoints.length - 1) : innerWidth / 2);
      ticks.push({ x, label: formatHourLabel(point.timestamp) });
      if (ticks.length === tickCount) break;
    }

    const yTicks: ChartYTick[] = [minValue, minValue + range / 2, maxValue].map((value) => ({
      y: PAD_Y + innerHeight - ((value - minValue) / range) * innerHeight,
      label: new Intl.NumberFormat('ko-KR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value),
    }));

    return {
      ticks,
      yTicks,
      points: points.join(' '),
      area: fills.join(' '),
    };
  }, [inputPoints]);

  if (!dataset) {
    return <p className="chart-empty">{emptyLabel}</p>;
  }

  return (
    <div className="chart-wrapper">
      <svg className="chart-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Time series chart">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`${hexToRgba(color, 0.45)}`} />
            <stop offset="100%" stopColor={`${hexToRgba(color, 0)}`} />
          </linearGradient>
        </defs>

        <polyline className="chart-area" points={dataset.area} fill={`url(#${gradientId})`} />
        <polyline className="chart-line" points={dataset.points} fill="none" stroke={color} />

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

function hexToRgba(hex: string, alpha: number): string {
  if (!hex.startsWith('#')) {
    return hex;
  }
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3 ? normalized.repeat(2) : normalized;
  const bigint = Number.parseInt(value.slice(0, 6), 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
