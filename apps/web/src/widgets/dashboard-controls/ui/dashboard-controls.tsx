// widgets/dashboard-controls/ui/dashboard-controls.tsx
// FSD: 설정 및 수동 액션은 feature 조합이므로 독립 위젯으로 분리해 페이지 복잡도를 낮춥니다.

import type { ChangeEvent, FormEvent } from 'react';
import type { RuntimeCfg, RuntimeOverrideKey } from '@scalper/shared';
import type { SettingsFormState } from '../../../features/runtime-settings';
import type { ManualActionType } from '@scalper/shared';

type DashboardControlsProps = {
  runtimeCfg?: RuntimeCfg;
  settingsForm: SettingsFormState;
  settingsDirty: boolean;
  settingsStatus: string | null;
  onSettingsChange: (key: RuntimeOverrideKey) => (event: ChangeEvent<HTMLInputElement>) => void;
  onSettingsSubmit: (event: FormEvent<HTMLFormElement>) => void;
  manualAmount: string;
  manualStatus: string | null;
  onManualAmountChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onManualAction: (type: ManualActionType) => void;
};

export function DashboardControls(props: DashboardControlsProps): JSX.Element {
  const {
    runtimeCfg,
    settingsForm,
    settingsDirty,
    settingsStatus,
    onSettingsChange,
    onSettingsSubmit,
    manualAmount,
    manualStatus,
    onManualAmountChange,
    onManualAction,
  } = props;

  return (
    <>
      <section className="panel">
        <h3>전략 설정</h3>
        <p className="note">값은 다음 루프에서 반영됩니다. 비워두면 기존 값을 유지합니다.</p>
        {runtimeCfg && (
          <p className="note current">
            현재: RSI({runtimeCfg.rsiLen}) · 진입 {runtimeCfg.rsiEntry} / 청산 {runtimeCfg.rsiExit} · 위험{' '}
            {(runtimeCfg.riskPerTrade * 100).toFixed(2)}%
          </p>
        )}
        <form className="settings-form" onSubmit={onSettingsSubmit}>
          <div className="form-grid">
            <label>
              RSI 기간
              <input
                type="number"
                min="2"
                step="1"
                value={settingsForm.rsiLen}
                onChange={onSettingsChange('rsiLen')}
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
                onChange={onSettingsChange('rsiEntry')}
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
                onChange={onSettingsChange('rsiExit')}
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
                onChange={onSettingsChange('stopPct')}
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
                onChange={onSettingsChange('takePct')}
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
                onChange={onSettingsChange('riskPerTrade')}
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
                onChange={onSettingsChange('cooldownMin')}
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
              onChange={onManualAmountChange}
              placeholder="미입력 시 최소 주문"
            />
          </label>
          <div className="actions">
            <button type="button" onClick={() => onManualAction('manual-buy')}>
              수동 매수
            </button>
            <button type="button" onClick={() => onManualAction('manual-sell')}>
              수동 매도
            </button>
            <button type="button" onClick={() => onManualAction('flatten')}>
              전량 청산
            </button>
          </div>
        </div>
        {manualStatus && <p className="note status">{manualStatus}</p>}
      </section>
    </>
  );
}
