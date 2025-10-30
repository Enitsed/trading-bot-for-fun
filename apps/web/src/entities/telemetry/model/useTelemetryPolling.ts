// entities/telemetry/model/useTelemetryPolling.ts
// FSD: Telemetry는 도메인 데이터 소스이므로 entity layer에서 상태/요청 로직을 캡슐화합니다.

import { useCallback, useEffect, useState } from 'react';
import type { TelemetrySnapshot } from '@scalper/shared';

export type SnapshotStatus = 'loading' | 'ready' | 'error' | 'empty';

type TelemetryResponse = {
  ok?: boolean;
  data?: TelemetrySnapshot | null;
  error?: string;
};

type UseTelemetryPollingParams = {
  pollInterval?: number;
};

export function useTelemetryPolling(params: UseTelemetryPollingParams = {}) {
  const { pollInterval = 5000 } = params;
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null);
  const [status, setStatus] = useState<SnapshotStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch('/api/telemetry', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`요청 실패: ${res.status}`);
      }
      const body = (await res.json()) as TelemetryResponse;
      if (!body?.data) {
        setSnapshot(null);
        setStatus('empty');
        return;
      }
      setSnapshot(body.data);
      setStatus('ready');
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    fetchSnapshot();
    const id = setInterval(fetchSnapshot, pollInterval);
    return () => clearInterval(id);
  }, [fetchSnapshot, pollInterval]);

  return {
    snapshot,
    status,
    error,
    refresh: fetchSnapshot,
  };
}
