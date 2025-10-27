'use client';

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { HourlyChart } from './components/hourly-chart';
import type {
  HistoryCandle,
  ManualActionPayload,
  ManualActionType,
  RuntimeCfg,
  RuntimeOverrideKey,
  RuntimeOverrides,
  RuntimeOverridesPayload,
  TelemetrySnapshot,
} from '../lib/types';

const POLL_INTERVAL = 5000;
const HISTORY_POLL_INTERVAL = 60000;
const HISTORY_WINDOW_HOURS = 48;

type SnapshotStatus = 'loading' | 'ready' | 'error' | 'empty';
type HistoryStatus = 'loading' | 'ready' | 'error';

type FormatNumberOptions = {
  fractionDigits?: number;
};

type SettingsFormState = Record<RuntimeOverrideKey, string>;

type TelemetryResponse = {
  ok?: boolean;
  data?: TelemetrySnapshot | null;
  error?: string;
};

type HistoryResponse = {
  ok: boolean;
  candles: HistoryCandle[];
  error?: string;
};

type SettingsOverridesResponse = {
  overrides?: RuntimeOverridesPayload;
};

type DashboardCard = {
  label: string;
  value: string;
  note?: string;
};

function formatNumber(value: number | null | undefined, options: FormatNumberOptions = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const { fractionDigits = 2 } = options;
  return new Intl.NumberFormat('ko-KR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function formatTimestamp(ts: number | null | undefined): string {
  if (!ts) return '-';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date(ts));
  } catch (error) {
    return '-';
  }
}

export default function DashboardPage(): JSX.Element {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null);
  const [status, setStatus] = useState<SnapshotStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [manualAmount, setManualAmount] = useState<string>('');
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] = useState<SettingsFormState>({
    rsiLen: '',
    rsiEntry: '',
    rsiExit: '',
    stopPct: '',
    takePct: '',
    riskPerTrade: '',
    cooldownMin: '',
  });
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);
  const [historyCandles, setHistoryCandles] = useState<HistoryCandle[]>([]);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>('loading');
  const [historyError, setHistoryError] = useState<string | null>(null);

  const fetchSnapshot = async (): Promise<void> => {
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
  };

  useEffect(() => {
    fetchSnapshot();
    const id = setInterval(fetchSnapshot, POLL_INTERVAL);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const fetchHistory = async (): Promise<void> => {
      try {
        setHistoryStatus((prev) => (prev === 'ready' ? prev : 'loading'));
        const res = await fetch(`/api/history?hours=${HISTORY_WINDOW_HOURS}`, { cache: 'no-store' });
        if (!res.ok) {
          throw new Error(`요청 실패: ${res.status}`);
        }
        const body = (await res.json()) as HistoryResponse;
        if (!body?.ok) {
          throw new Error(body?.error || '데이터를 불러오지 못했습니다.');
        }
        setHistoryCandles(body.candles ?? []);
        setHistoryStatus('ready');
        setHistoryError(null);
      } catch (err) {
        console.error(err);
        setHistoryStatus('error');
        setHistoryError(err instanceof Error ? err.message : String(err));
      }
    };

    fetchHistory();
    const id = setInterval(fetchHistory, HISTORY_POLL_INTERVAL);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const bootstrapSettings = async (): Promise<void> => {
      try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as SettingsOverridesResponse;
        if (!body?.overrides) return;
        setSettingsForm((prev) => ({
          ...prev,
          ...mapRuntimeToForm(body.overrides ?? {}, prev),
        }));
      } catch (err) {
        console.warn('Failed to load overrides', err);
      }
    };
    bootstrapSettings();
  }, []);

  useEffect(() => {
    if (!snapshot || settingsDirty) return;
    if (!snapshot.runtimeCfg) return;
    setSettingsForm((prev) => ({
      ...prev,
      ...mapRuntimeToForm(snapshot.runtimeCfg, prev),
    }));
  }, [snapshot, settingsDirty]);

  const handleSettingsChange = (key: RuntimeOverrideKey) => (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    setSettingsForm((prev) => ({ ...prev, [key]: value }));
    setSettingsDirty(true);
  };

  const handleSettingsSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSettingsStatus('저장 중…');
    try {
      const payload = buildSettingsPayload(settingsForm);
      if (!payload) {
        setSettingsStatus('변경 사항이 없습니다.');
        setSettingsDirty(false);
        return;
      }
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || '요청 실패');
      }
      setSettingsStatus('전략 설정이 저장되었습니다. (다음 루프에서 적용)');
      setSettingsDirty(false);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : String(err);
      setSettingsStatus(`저장 실패: ${message}`);
    }
  };

  const handleManualAction = async (type: ManualActionType) => {
    setActionStatus('요청 중…');
    try {
      const body: ManualActionPayload = { type };
      if (type !== 'flatten' && manualAmount.trim() !== '') {
        const amount = Number(manualAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error('수량을 확인하세요.');
        }
        body.amount = amount;
      }
      const res = await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || '요청 실패');
      }
      setActionStatus('명령이 큐에 등록되었습니다. (다음 루프에서 집행)');
      if (type !== 'flatten') {
        setManualAmount('');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionStatus(`실패: ${message}`);
    }
  };

  const cards = useMemo<DashboardCard[]>(() => {
    if (!snapshot) return [];
    const price = formatNumber(snapshot.price, { fractionDigits: 2 });
    const equity = formatNumber(snapshot.equity, { fractionDigits: 2 });
    const drawdown = snapshot.drawdown !== undefined ? snapshot.drawdown.toFixed?.(2) : undefined;
    const position = formatNumber(snapshot.position, { fractionDigits: 6 });
    const quoteFree = formatNumber(snapshot.balances?.quoteFree, { fractionDigits: 2 });
    const baseFree = formatNumber(snapshot.balances?.baseFree, { fractionDigits: 6 });
    return [
      { label: '현재가', value: price, note: snapshot.mark ? '(마크 포함)' : '' },
      { label: '총 평가금액', value: equity },
      { label: '일중 손익률', value: drawdown ? `${drawdown}%` : '-' },
      { label: '보유 수량', value: position },
      { label: '쿼트 잔고', value: `${quoteFree} ${process.env.NEXT_PUBLIC_QUOTE ?? 'USDT'}` },
      { label: '베이스 잔고', value: `${baseFree} ${process.env.NEXT_PUBLIC_BASE ?? 'BTC'}` },
    ];
  }, [snapshot]);

  const recentSignals = snapshot?.recentSignals ?? [];
  const runtimeCfg: RuntimeCfg | undefined = snapshot?.runtimeCfg ?? undefined;

  return (
    <main className="page">
      <header>
        <h1>실시간 트레이딩 현황</h1>
        <p className="meta">
          마지막 스냅샷: {formatTimestamp(snapshot?.timestamp)} · 최근 이벤트: {snapshot?.event || '-'}
        </p>
      </header>

      {status === 'loading' && <p className="notice">데이터를 불러오는 중입니다…</p>}
      {status === 'empty' && <p className="notice">아직 생성된 스냅샷이 없습니다. 봇을 실행해 주세요.</p>}
      {status === 'error' && (
        <p className="notice error">데이터를 불러올 수 없습니다: {error ?? '알 수 없는 오류'}</p>
      )}

      {status === 'ready' && snapshot && (
        <>
          <section className="grid">
            {cards.map(({ label, value, note }) => (
              <article key={label} className="card">
                <h2>{label}</h2>
                <p className="value">{value}</p>
                {note ? <p className="note">{note}</p> : null}
              </article>
            ))}
          </section>

          <section className="details">
            <div>
              <h3>진입 정보</h3>
              <dl>
                <div>
                  <dt>마지막 체결 시각</dt>
                  <dd>{formatTimestamp(snapshot.lastTradeTs)}</dd>
                </div>
                <div>
                  <dt>현재 진입가</dt>
                  <dd>{formatNumber(snapshot.entryPrice, { fractionDigits: 2 })}</dd>
                </div>
                <div>
                  <dt>손절/익절</dt>
                  <dd>
                    {snapshot.openBracket
                      ? `STOP ${formatNumber(snapshot.openBracket.stop, { fractionDigits: 2 })} / TAKE ${formatNumber(snapshot.openBracket.take, { fractionDigits: 2 })}`
                      : '-'}
                  </dd>
                </div>
                <div>
                  <dt>신호</dt>
                  <dd>{snapshot.signal}</dd>
                </div>
              </dl>
            </div>
            <div>
              <h3>임계값</h3>
              <dl>
                <div>
                  <dt>Base Min</dt>
                  <dd>{formatNumber(snapshot.thresholds?.baseMin, { fractionDigits: 6 })}</dd>
                </div>
                <div>
                  <dt>Base Step</dt>
                  <dd>{formatNumber(snapshot.thresholds?.baseStep, { fractionDigits: 6 })}</dd>
                </div>
                <div>
                  <dt>Notional Min</dt>
                  <dd>{formatNumber(snapshot.thresholds?.notionalMin, { fractionDigits: 2 })}</dd>
                </div>
                <div>
                  <dt>거래 가능 최소량</dt>
                  <dd>{formatNumber(snapshot.thresholds?.tradable, { fractionDigits: 6 })}</dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="panel chart-panel">
            <h3>시간별 가격 (최근 {HISTORY_WINDOW_HOURS}시간)</h3>
            {historyStatus === 'loading' && <p className="note">차트를 준비하는 중입니다…</p>}
            {historyStatus === 'error' && (
              <p className="note status">차트를 불러오지 못했습니다: {historyError}</p>
            )}
            {historyStatus === 'ready' && historyCandles.length === 0 && (
              <p className="note status">표시할 데이터가 없습니다.</p>
            )}
            {historyStatus === 'ready' && historyCandles.length > 0 && (
              <HourlyChart candles={historyCandles} />
            )}
          </section>

          <section>
            <h3>최근 신호</h3>
            <ul className="signals">
              {recentSignals.map((item, idx) => (
                <li key={`${item}-${idx}`}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h3>전략 설정</h3>
            <p className="note">
              값은 다음 루프에서 반영됩니다. 비워두면 기존 값을 유지합니다.
            </p>
            {runtimeCfg && (
              <p className="note current">
                현재: RSI({runtimeCfg.rsiLen}) · 진입 {runtimeCfg.rsiEntry} / 청산 {runtimeCfg.rsiExit} · 위험 {(
                  runtimeCfg.riskPerTrade * 100
                ).toFixed(2)}%
              </p>
            )}
            <form className="settings-form" onSubmit={handleSettingsSubmit}>
              <div className="form-grid">
                <label>
                  RSI 기간
                  <input
                    type="number"
                    min="2"
                    step="1"
                    value={settingsForm.rsiLen}
                    onChange={handleSettingsChange('rsiLen')}
                    placeholder="예: 14"
                  />
                </label>
                <label>
                  RSI 진입
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={settingsForm.rsiEntry}
                    onChange={handleSettingsChange('rsiEntry')}
                    placeholder="예: 30"
                  />
                </label>
                <label>
                  RSI 청산
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={settingsForm.rsiExit}
                    onChange={handleSettingsChange('rsiExit')}
                    placeholder="예: 50"
                  />
                </label>
                <label>
                  손절 (%)
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={settingsForm.stopPct}
                    onChange={handleSettingsChange('stopPct')}
                    placeholder="예: 0.7"
                  />
                </label>
                <label>
                  익절 (%)
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={settingsForm.takePct}
                    onChange={handleSettingsChange('takePct')}
                    placeholder="예: 1.2"
                  />
                </label>
                <label>
                  위험 비율 (%)
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={settingsForm.riskPerTrade}
                    onChange={handleSettingsChange('riskPerTrade')}
                    placeholder="예: 1"
                  />
                </label>
                <label>
                  쿨다운 (분)
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={settingsForm.cooldownMin}
                    onChange={handleSettingsChange('cooldownMin')}
                    placeholder="예: 10"
                  />
                </label>
              </div>
              <button type="submit" className="primary" disabled={!settingsDirty}>
                전략 저장
              </button>
              {settingsStatus && <p className="note status">{settingsStatus}</p>}
            </form>
          </section>

          <section className="panel">
            <h3>수동 매매</h3>
            <div className="manual">
              <label>
                주문 수량 (베이스)
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={manualAmount}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setManualAmount(event.target.value)}
                  placeholder="미입력 시 최소 주문"
                />
              </label>
              <div className="actions">
                <button type="button" onClick={() => handleManualAction('manual-buy')}>
                  수동 매수
                </button>
                <button type="button" onClick={() => handleManualAction('manual-sell')}>
                  수동 매도
                </button>
                <button type="button" onClick={() => handleManualAction('flatten')}>
                  전량 청산
                </button>
              </div>
            </div>
            {actionStatus && <p className="note status">{actionStatus}</p>}
          </section>
        </>
      )}
    </main>
  );
}

function mapRuntimeToForm(
  source: Partial<Record<RuntimeOverrideKey, number | null | undefined>>,
  prev: SettingsFormState
): SettingsFormState {
  const next: SettingsFormState = { ...prev };
  if (source.rsiLen !== undefined) next.rsiLen = String(source.rsiLen ?? '');
  if (source.rsiEntry !== undefined) next.rsiEntry = String(source.rsiEntry ?? '');
  if (source.rsiExit !== undefined) next.rsiExit = String(source.rsiExit ?? '');
  if (source.stopPct !== undefined)
    next.stopPct = source.stopPct !== null && source.stopPct !== undefined ? formatPercentInput(source.stopPct) : '';
  if (source.takePct !== undefined)
    next.takePct = source.takePct !== null && source.takePct !== undefined ? formatPercentInput(source.takePct) : '';
  if (source.riskPerTrade !== undefined)
    next.riskPerTrade =
      source.riskPerTrade !== null && source.riskPerTrade !== undefined ? formatPercentInput(source.riskPerTrade) : '';
  if (source.cooldownMin !== undefined) next.cooldownMin = String(source.cooldownMin ?? '');
  return next;
}

function buildSettingsPayload(form: SettingsFormState): RuntimeOverrides | null {
  const converters: Record<RuntimeOverrideKey, (value: string) => number> = {
    rsiLen: (value) => Number(value),
    rsiEntry: (value) => Number(value),
    rsiExit: (value) => Number(value),
    stopPct: (value) => Number(value) / 100,
    takePct: (value) => Number(value) / 100,
    riskPerTrade: (value) => Number(value) / 100,
    cooldownMin: (value) => Number(value),
  };

  const payload: RuntimeOverrides = {};
  let changed = false;

  for (const key of Object.keys(converters) as RuntimeOverrideKey[]) {
    const raw = form[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const num = converters[key](raw);
    if (!Number.isFinite(num)) {
      throw new Error(`${key} 값이 올바르지 않습니다.`);
    }
    payload[key] = num;
    changed = true;
  }

  return changed ? payload : null;
}

function formatPercentInput(value: number): string {
  const scaled = Number(value) * 100;
  if (!Number.isFinite(scaled)) return '';
  return parseFloat(scaled.toFixed(4)).toString();
}
