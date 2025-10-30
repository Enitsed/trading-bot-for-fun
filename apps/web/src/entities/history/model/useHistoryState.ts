// entities/history/model/useHistoryState.ts
// FSD: 히스토리 데이터도 독립된 entity로 분리해 상태/요청 로직을 재사용 가능하게 유지합니다.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { HistoryApiResponse, HistoryCandle, HistoryTimeframe, LinePoint } from '@scalper/shared';
import {
  DEFAULT_TIMEFRAME,
  HISTORY_POLL_INTERVAL,
  TIMEFRAME_OPTIONS,
  type TimeframeOption,
} from '../../../shared/config/dashboard';
import type { QuickRangeOption } from '../../../shared/config/dashboard';
import { formatTimestamp } from '../../../shared/lib/format';
import { fetchJsonWithRetry } from '../../../shared/lib/fetch-with-retry';

export type HistoryStatus = 'loading' | 'ready' | 'error';

export type HistoryCursor = {
  start: number | null;
  end: number | null;
};

export type HistoryWindow = {
  start: number;
  end: number;
  hasPrev: boolean;
  hasNext: boolean;
} | null;

type UseHistoryStateParams = {
  timeframeOptions?: TimeframeOption[];
  pollInterval?: number;
};

export function useHistoryState(params: UseHistoryStateParams = {}) {
  const { timeframeOptions = TIMEFRAME_OPTIONS, pollInterval = HISTORY_POLL_INTERVAL } = params;

  const [historyCandles, setHistoryCandles] = useState<HistoryCandle[]>([]);
  const [equitySeries, setEquitySeries] = useState<LinePoint[]>([]);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>('loading');
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyTf, setHistoryTf] = useState<HistoryTimeframe>(DEFAULT_TIMEFRAME);
  const [historyCursor, setHistoryCursor] = useState<HistoryCursor>({ start: null, end: null });
  const [historyWindow, setHistoryWindow] = useState<HistoryWindow>(null);
  const [customHours, setCustomHours] = useState<string>('');

  const fetchHistory = useCallback(async () => {
    try {
      setHistoryStatus((prev) => (prev === 'ready' ? prev : 'loading'));
      const option = timeframeOptions.find((item) => item.key === historyTf);
      const customHoursNum = Number(customHours);
      const hoursParam =
        Number.isFinite(customHoursNum) && customHoursNum > 0 ? customHoursNum : option?.hours ?? timeframeOptions[0].hours;

      const params = new URLSearchParams({ hours: String(hoursParam), tf: historyTf });
      if (historyCursor.start !== null) params.set('start', String(historyCursor.start));
      if (historyCursor.end !== null) params.set('end', String(historyCursor.end));

      const body = await fetchJsonWithRetry<HistoryApiResponse>(`/api/history?${params.toString()}`, {
        cache: 'no-store',
      });

      if (!body?.ok) {
        throw new Error(body?.error || '데이터를 불러오지 못했습니다.');
      }

      if (body.timeframe && body.timeframe !== historyTf) {
        setHistoryTf(body.timeframe);
        setHistoryCursor({ start: null, end: null });
        setHistoryWindow(null);
        return;
      }

      setHistoryCandles(body.candles ?? []);
      setEquitySeries(body.equity ?? []);
      setHistoryWindow({
        start: body.windowStart,
        end: body.windowEnd,
        hasPrev: body.hasPrev,
        hasNext: body.hasNext,
      });
      setHistoryStatus('ready');
      setHistoryError(null);
    } catch (err) {
      console.error(err);
      setHistoryStatus('error');
      setHistoryError(err instanceof Error ? err.message : String(err));
      setHistoryCandles([]);
      setEquitySeries([]);
      setHistoryWindow(null);
    }
  }, [customHours, historyCursor.end, historyCursor.start, historyTf, timeframeOptions]);

  useEffect(() => {
    fetchHistory();
    let intervalId: ReturnType<typeof setInterval> | null = null;
    if (historyCursor.start === null && historyCursor.end === null) {
      intervalId = setInterval(fetchHistory, pollInterval);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [fetchHistory, historyCursor.end, historyCursor.start, pollInterval]);

  const activeTimeframe = useMemo(
    () => timeframeOptions.find((item) => item.key === historyTf) ?? timeframeOptions[0],
    [historyTf, timeframeOptions]
  );

  const priceSeries = useMemo<LinePoint[]>(
    () => historyCandles.map((item) => ({ timestamp: item.timestamp, value: item.close })),
    [historyCandles]
  );

  const historyRangeLabel = useMemo(() => {
    if (!historyWindow) return '-';
    return `${formatTimestamp(historyWindow.start)} ~ ${formatTimestamp(historyWindow.end)}`;
  }, [historyWindow]);

  const viewingLatest = historyCursor.start === null && historyCursor.end === null;

  const handleTimeframeSelect = (tf: HistoryTimeframe) => {
    if (tf === historyTf) return;
    setHistoryTf(tf);
    setHistoryCursor({ start: null, end: null });
    setHistoryWindow(null);
  };

  const handleQuickRange = (option: QuickRangeOption) => {
    setHistoryCursor({ start: null, end: null });
    setHistoryWindow(null);
    setCustomHours(String(option.hours));
  };

  const handleCustomHoursChange = (value: string) => {
    setCustomHours(value);
  };

  const handleCustomHoursSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const hours = Number(customHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      alert('올바른 시간을 입력하세요.');
      return;
    }
    handleQuickRange({ hours, label: `${hours}시간` });
  };

  const deriveRangeMs = () => {
    if (historyWindow) {
      const span = historyWindow.end - historyWindow.start;
      if (span > 0) return span;
    }
    return activeTimeframe.hours * 60 * 60 * 1000;
  };

  const handlePrevRange = () => {
    if (!historyWindow) return;
    const range = deriveRangeMs();
    const nextEnd = historyWindow.start;
    const nextStart = Math.max(nextEnd - range, 0);
    setHistoryCursor({ start: nextStart, end: nextEnd });
  };

  const handleNextRange = () => {
    if (!historyWindow || !historyWindow.hasNext) return;
    const range = deriveRangeMs();
    const nextStart = historyWindow.end;
    const nextEnd = nextStart + range;
    setHistoryCursor({ start: nextStart, end: nextEnd });
  };

  const handleResetRange = () => {
    if (viewingLatest) return;
    setHistoryCursor({ start: null, end: null });
  };

  return {
    historyCandles,
    priceSeries,
    equitySeries,
    historyStatus,
    historyError,
    historyTf,
    historyCursor,
    historyWindow,
    customHours,
    activeTimeframe,
    viewingLatest,
    historyRangeLabel,
    setHistoryCursor,
    setHistoryWindow,
    handleTimeframeSelect,
    handleQuickRange,
    handlePrevRange,
    handleNextRange,
    handleResetRange,
    handleCustomHoursChange,
    handleCustomHoursSubmit,
    fetchHistory,
  };
}
