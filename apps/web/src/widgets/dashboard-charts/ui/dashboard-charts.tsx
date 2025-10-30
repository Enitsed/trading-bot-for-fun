// widgets/dashboard-charts/ui/dashboard-charts.tsx
// FSD: 차트 영역을 위젯으로 분리해 차트 제어 로직과 렌더를 한곳에서 관리합니다.

import type { FormEvent } from 'react';
import { CandlestickChart } from '../../../../app/components/candlestick-chart';
import { LineSeriesChart } from '../../../../app/components/line-series-chart';
import type { HistoryCandle, LinePoint, HistoryTimeframe } from '@scalper/shared';
import type { HistoryStatus, HistoryWindow } from '../../../entities/history';
import type { QuickRangeOption, TimeframeOption } from '../../../shared/config/dashboard';

type DashboardChartsProps = {
  historyStatus: HistoryStatus;
  historyError: string | null;
  historyCandles: HistoryCandle[];
  priceSeries: LinePoint[];
  equitySeries: LinePoint[];
  historyWindow: HistoryWindow;
  historyRangeLabel: string;
  viewingLatest: boolean;
  activeTimeframe: TimeframeOption;
  timeframeOptions: TimeframeOption[];
  quickRangeOptions: QuickRangeOption[];
  customHours: string;
  onSelectTimeframe: (tf: HistoryTimeframe) => void;
  onSelectQuickRange: (option: QuickRangeOption) => void;
  onPrevRange: () => void;
  onNextRange: () => void;
  onResetRange: () => void;
  onCustomHoursChange: (value: string) => void;
  onCustomHoursSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRetryFetch?: () => void;
};

export function DashboardCharts(props: DashboardChartsProps): JSX.Element {
  const {
    historyStatus,
    historyError,
    historyCandles,
    priceSeries,
    equitySeries,
    historyWindow,
    historyRangeLabel,
    viewingLatest,
    activeTimeframe,
    timeframeOptions,
    quickRangeOptions,
    customHours,
    onSelectTimeframe,
    onSelectQuickRange,
    onPrevRange,
    onNextRange,
    onResetRange,
    onCustomHoursChange,
    onCustomHoursSubmit,
    onRetryFetch,
  } = props;

  const historyRangeHours = activeTimeframe.hours;
  const timeframeLabel = activeTimeframe.label;

  return (
    <>
      <div className="chart-controls">
        <div className="timeframe-section">
          <h4>캔들 간격</h4>
          <div className="timeframe-toggle">
            {timeframeOptions.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={key === activeTimeframe.key ? 'active' : ''}
                onClick={() => onSelectTimeframe(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="range-section">
          <h4>시간 범위 빠른 선택</h4>
          <div className="quick-range-buttons">
            {quickRangeOptions.map((option) => (
              <button
                key={option.hours}
                type="button"
                className="range-button"
                onClick={() => onSelectQuickRange(option)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="custom-range-section">
          <h4>커스텀 시간 범위</h4>
          <form className="custom-range-form" onSubmit={onCustomHoursSubmit}>
            <input
              type="number"
              min="1"
              step="1"
              value={customHours}
              onChange={(event) => onCustomHoursChange(event.target.value)}
              placeholder="시간 입력 (예: 48)"
            />
            <button type="submit">적용</button>
          </form>
        </div>
      </div>

      {historyWindow && (
        <div className="range-meta">
          <span className="range-label">{historyRangeLabel}</span>
          <div className="range-actions">
            <button type="button" onClick={onPrevRange} disabled={!historyWindow.hasPrev}>
              ◀ 이전
            </button>
            <button type="button" onClick={onResetRange} disabled={viewingLatest}>
              최신으로
            </button>
            <button type="button" onClick={onNextRange} disabled={!historyWindow.hasNext}>
              다음 ▶
            </button>
          </div>
        </div>
      )}

      {historyStatus === 'loading' && <p className="notice">차트를 준비하는 중입니다…</p>}
      {historyStatus === 'error' && (
        <div className="error-panel">
          <p className="notice error">차트를 불러오지 못했습니다: {historyError ?? '알 수 없는 오류'}</p>
          {onRetryFetch && (
            <button type="button" onClick={onRetryFetch} className="retry-button">
              다시 시도
            </button>
          )}
        </div>
      )}

      {historyStatus === 'ready' && (
        <>
          <section className="panel chart-panel">
            <h3>
              시간별 캔들 ({timeframeLabel} · 최근 {historyRangeHours}시간)
            </h3>
            {historyCandles.length === 0 ? (
              <p className="note status">표시할 데이터가 없습니다.</p>
            ) : (
              <CandlestickChart candles={historyCandles} />
            )}
          </section>

          <section className="panel chart-panel">
            <h3>시간별 종가 추이 ({timeframeLabel})</h3>
            {priceSeries.length === 0 ? (
              <p className="note status">표시할 데이터가 없습니다.</p>
            ) : (
              <LineSeriesChart points={priceSeries} gradientId="price-series" />
            )}
          </section>

          <section className="panel chart-panel">
            <h3>시간별 잔고 변화 ({timeframeLabel})</h3>
            {equitySeries.length === 0 ? (
              <p className="note status">잔고 데이터가 없습니다.</p>
            ) : (
              <LineSeriesChart
                points={equitySeries}
                gradientId="equity-series"
                color="#34d399"
                emptyLabel="잔고 데이터가 없습니다."
              />
            )}
          </section>
        </>
      )}
    </>
  );
}
