'use client';

// pages-layer/dashboard/ui/dashboard-page.tsx
// FSD: 페이지는 여러 feature/widget을 조합하는 composition layer로만 남겨둡니다.

import { useMemo, useState } from 'react';
import { DashboardOverview } from '../../../widgets/dashboard-overview';
import { DashboardCharts } from '../../../widgets/dashboard-charts';
import { DashboardControls } from '../../../widgets/dashboard-controls';
import {
  QUICK_RANGE_OPTIONS,
  TELEMETRY_POLL_INTERVAL,
  TIMEFRAME_OPTIONS,
} from '../../../shared/config/dashboard';
import { useTelemetryPolling, buildDashboardCards } from '../../../entities/telemetry';
import { useHistoryState } from '../../../entities/history';
import { useRuntimeSettingsForm } from '../../../features/runtime-settings';
import { useManualCommand } from '../../../features/manual-command';

type TabKey = 'overview' | 'charts' | 'controls';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: '현황 요약' },
  { key: 'charts', label: '차트 분석' },
  { key: 'controls', label: '설정 & 수동' },
];

export function DashboardPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  const { snapshot, status, error } = useTelemetryPolling({ pollInterval: TELEMETRY_POLL_INTERVAL });
  const history = useHistoryState();
  const settings = useRuntimeSettingsForm({ runtimeCfg: snapshot?.runtimeCfg });
  const manual = useManualCommand();

  const cards = useMemo(() => buildDashboardCards(snapshot), [snapshot]);
  const recentSignals = snapshot?.recentSignals ?? [];
  const runtimeCfg = snapshot?.runtimeCfg;

  return (
    <main className="page with-tabs">
      <div className="tab-layout">
        <nav className="tab-sidebar">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={key === activeTab ? 'active' : ''}
              onClick={() => setActiveTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="tab-content">
          {activeTab === 'overview' && (
            <DashboardOverview
              snapshot={snapshot}
              status={status}
              error={error}
              cards={cards}
              recentSignals={recentSignals}
              runtimeCfg={runtimeCfg}
            />
          )}
          {activeTab === 'charts' && (
            <DashboardCharts
              historyStatus={history.historyStatus}
              historyError={history.historyError}
              historyCandles={history.historyCandles}
              priceSeries={history.priceSeries}
              equitySeries={history.equitySeries}
              historyWindow={history.historyWindow}
              historyRangeLabel={history.historyRangeLabel}
              viewingLatest={history.viewingLatest}
              activeTimeframe={history.activeTimeframe}
              timeframeOptions={TIMEFRAME_OPTIONS}
              quickRangeOptions={QUICK_RANGE_OPTIONS}
              customHours={history.customHours}
              onSelectTimeframe={history.handleTimeframeSelect}
              onSelectQuickRange={history.handleQuickRange}
              onPrevRange={history.handlePrevRange}
              onNextRange={history.handleNextRange}
              onResetRange={history.handleResetRange}
              onCustomHoursChange={history.handleCustomHoursChange}
              onCustomHoursSubmit={history.handleCustomHoursSubmit}
            />
          )}
          {activeTab === 'controls' && (
            <DashboardControls
              runtimeCfg={runtimeCfg}
              settingsForm={settings.form}
              settingsDirty={settings.dirty}
              settingsStatus={settings.status}
              onSettingsChange={settings.handleChange}
              onSettingsSubmit={settings.handleSubmit}
              manualAmount={manual.amount}
              manualStatus={manual.status}
              onManualAmountChange={manual.handleAmountChange}
              onManualAction={manual.submit}
            />
          )}
        </div>
      </div>
    </main>
  );
}
