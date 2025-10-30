// features/runtime-settings/model/useRuntimeSettingsForm.ts
// FSD: 전략 설정 변경은 사용자 상호작용이므로 feature layer로 분리해 페이지에서 조합만 담당하게 합니다.

import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
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
      setStatus('저장 중…');
      try {
        const payload = buildSettingsPayload(form);
        if (!payload) {
          setStatus('변경 사항이 없습니다.');
          setDirty(false);
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
        setStatus('전략 설정이 저장되었습니다. (다음 루프에서 적용)');
        setDirty(false);
      } catch (err) {
        console.error(err);
        const message = err instanceof Error ? err.message : String(err);
        setStatus(`저장 실패: ${message}`);
      }
    },
    [form]
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
