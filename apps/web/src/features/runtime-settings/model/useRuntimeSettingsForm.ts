// features/runtime-settings/model/useRuntimeSettingsForm.ts
// FSD: 전략 설정 변경은 사용자 상호작용이므로 feature layer로 분리해 페이지에서 조합만 담당하게 합니다.

import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { toast } from 'sonner';
import type {
  RuntimeCfg,
  RuntimeOverrideKey,
  RuntimeOverrides,
  RuntimeOverridesPayload,
} from '@scalper/shared';
import { formatPercentInput } from '../../../shared/lib/format';

export type SettingsFormState = Record<RuntimeOverrideKey, string>;

type SettingsOverridesResponse = {
  overrides?: RuntimeOverridesPayload;
};

type UseRuntimeSettingsFormParams = {
  runtimeCfg?: RuntimeCfg | null;
};

export function useRuntimeSettingsForm(params: UseRuntimeSettingsFormParams = {}) {
  const { runtimeCfg } = params;

  const [form, setForm] = useState<SettingsFormState>({
    rsiLen: '',
    rsiEntry: '',
    rsiExit: '',
    stopPct: '',
    takePct: '',
    riskPerTrade: '',
    cooldownMin: '',
  });
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const bootstrapSettings = async (): Promise<void> => {
      try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as SettingsOverridesResponse;
        if (!body?.overrides) return;
        setForm((prev) => ({
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
    if (!runtimeCfg || dirty) return;
    setForm((prev) => ({
      ...prev,
      ...mapRuntimeToForm(runtimeCfg, prev),
    }));
  }, [runtimeCfg, dirty]);

  const handleChange = useCallback(
    (key: RuntimeOverrideKey) => (event: ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;
      setForm((prev) => ({ ...prev, [key]: value }));
      setDirty(true);
    },
    []
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const saveSettings = async () => {
        const payload = buildSettingsPayload(form);
        if (!payload) {
          toast.info('변경 사항이 없습니다.');
          setDirty(false);
          return;
        }

        // 위험한 변경 사항 감지
        const warnings = detectRiskyChanges(payload, runtimeCfg);
        if (warnings.length > 0) {
          const warningMessage = warnings.join('\n\n');
          const confirmed = window.confirm(
            `⚠️ 위험한 설정 변경이 감지되었습니다:\n\n${warningMessage}\n\n정말 변경하시겠습니까?`
          );
          if (!confirmed) {
            throw new Error('사용자가 취소했습니다.');
          }
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
        setDirty(false);
      };

      toast.promise(saveSettings(), {
        loading: '전략 설정 저장 중...',
        success: '전략 설정이 저장되었습니다. (다음 루프에서 적용)',
        error: (err) => {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes('취소')) {
            return '설정 변경이 취소되었습니다.';
          }
          return `저장 실패: ${message}`;
        },
      });
    },
    [form, runtimeCfg]
  );

  return {
    form,
    dirty,
    status,
    handleChange,
    handleSubmit,
    setDirty,
    setForm,
  };
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
    next.stopPct =
      source.stopPct !== null && source.stopPct !== undefined
        ? formatPercentInput(source.stopPct)
        : '';
  if (source.takePct !== undefined)
    next.takePct =
      source.takePct !== null && source.takePct !== undefined
        ? formatPercentInput(source.takePct)
        : '';
  if (source.riskPerTrade !== undefined)
    next.riskPerTrade =
      source.riskPerTrade !== null && source.riskPerTrade !== undefined
        ? formatPercentInput(source.riskPerTrade)
        : '';
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

/**
 * 위험한 설정 변경 사항을 감지하고 경고 메시지 배열을 반환
 */
function detectRiskyChanges(payload: RuntimeOverrides, currentCfg: RuntimeCfg | null | undefined): string[] {
  const warnings: string[] = [];

  if (!currentCfg) return warnings;

  // 1. 위험 비율이 5% 이상으로 증가
  if (payload.riskPerTrade !== undefined && payload.riskPerTrade > 0.05) {
    warnings.push(
      `🔥 위험 비율: ${(payload.riskPerTrade * 100).toFixed(2)}%\n` +
        `   (권장: 5% 이하, 현재: ${(currentCfg.riskPerTrade * 100).toFixed(2)}%)`
    );
  }

  // 2. 손절 비율이 2배 이상 증가 (손절이 느슨해짐)
  if (payload.stopPct !== undefined && payload.stopPct > currentCfg.stopPct * 2) {
    warnings.push(
      `⚠️ 손절 비율이 크게 증가: ${(payload.stopPct * 100).toFixed(2)}%\n` +
        `   (현재: ${(currentCfg.stopPct * 100).toFixed(2)}%) - 손실이 커질 수 있습니다.`
    );
  }

  // 3. 익절 비율이 2배 이상 증가 (익절이 너무 멀어짐)
  if (payload.takePct !== undefined && payload.takePct > currentCfg.takePct * 2) {
    warnings.push(
      `⚠️ 익절 비율이 크게 증가: ${(payload.takePct * 100).toFixed(2)}%\n` +
        `   (현재: ${(currentCfg.takePct * 100).toFixed(2)}%) - 익절이 어려워질 수 있습니다.`
    );
  }

  // 4. 손절 > 익절 (비합리적)
  const stopPct = payload.stopPct ?? currentCfg.stopPct;
  const takePct = payload.takePct ?? currentCfg.takePct;
  if (stopPct > takePct) {
    warnings.push(
      `❌ 손절(${(stopPct * 100).toFixed(2)}%)이 익절(${(takePct * 100).toFixed(2)}%)보다 큽니다.\n` +
        `   이는 위험/보상 비율이 불리합니다.`
    );
  }

  // 5. 쿨다운이 0 또는 매우 짧음 (1분 이하)
  if (payload.cooldownMin !== undefined && payload.cooldownMin < 1) {
    warnings.push(
      `⚡ 쿨다운이 매우 짧습니다: ${payload.cooldownMin}분\n` +
        `   (권장: 5분 이상) - 과도한 거래가 발생할 수 있습니다.`
    );
  }

  // 6. RSI 진입/청산 값이 비정상적
  const rsiEntry = payload.rsiEntry ?? currentCfg.rsiEntry;
  const rsiExit = payload.rsiExit ?? currentCfg.rsiExit;
  if (rsiEntry >= rsiExit) {
    warnings.push(
      `❌ RSI 진입(${rsiEntry})이 청산(${rsiExit})보다 크거나 같습니다.\n` +
        `   RSI 진입은 청산보다 작아야 합니다.`
    );
  }

  // 7. RSI 값이 극단적 (진입 > 40 또는 청산 < 40)
  if (payload.rsiEntry !== undefined && payload.rsiEntry > 40) {
    warnings.push(`⚠️ RSI 진입값이 높습니다: ${payload.rsiEntry}\n   (권장: 30 이하) - 진입 기회가 줄어들 수 있습니다.`);
  }
  if (payload.rsiExit !== undefined && payload.rsiExit < 40) {
    warnings.push(
      `⚠️ RSI 청산값이 낮습니다: ${payload.rsiExit}\n   (권장: 50 이상) - 조기 청산이 발생할 수 있습니다.`
    );
  }

  return warnings;
}
