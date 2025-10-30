// shared/config/dashboard.ts
// FSD: 페이지 전역에서 참조하는 상수는 shared config로 노출해 단일 출처를 유지합니다.

import type { HistoryTimeframe } from '@scalper/shared';

export const TELEMETRY_POLL_INTERVAL = 5000;
export const HISTORY_POLL_INTERVAL = 60000;

export type TimeframeOption = {
  key: HistoryTimeframe;
  label: string;
  hours: number;
};

export const TIMEFRAME_OPTIONS: TimeframeOption[] = [
  { key: '5m', label: '5분', hours: 24 },
  { key: '15m', label: '15분', hours: 72 },
  { key: '1h', label: '1시간', hours: 24 * 7 },
  { key: '1d', label: '1일', hours: 24 * 30 },
];

export const DEFAULT_TIMEFRAME: HistoryTimeframe = '1h';

export type QuickRangeOption = {
  label: string;
  hours: number;
};

export const QUICK_RANGE_OPTIONS: QuickRangeOption[] = [
  { label: '1시간', hours: 1 },
  { label: '6시간', hours: 6 },
  { label: '12시간', hours: 12 },
  { label: '24시간', hours: 24 },
  { label: '3일', hours: 72 },
  { label: '1주일', hours: 168 },
  { label: '1개월', hours: 720 },
];
