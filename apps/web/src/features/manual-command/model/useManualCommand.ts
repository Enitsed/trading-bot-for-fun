// features/manual-command/model/useManualCommand.ts
// FSD: 수동 매매 역시 기능 단위이므로 feature layer에서 상태와 액션을 캡슐화합니다.

import { useCallback, useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import type { ManualActionPayload, ManualActionType } from '@scalper/shared';

export function useManualCommand() {
  const [amount, setAmount] = useState<string>('');
  const [status, setStatus] = useState<string | null>(null);

  const handleAmountChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setAmount(event.target.value);
  }, []);

  const submit = useCallback(
    async (type: ManualActionType) => {
      const executeCommand = async () => {
        const body: ManualActionPayload = { type };
        if (type !== 'flatten' && amount.trim() !== '') {
          const parsed = Number(amount);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            throw new Error('수량을 확인하세요.');
          }
          body.amount = parsed;
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
        if (type !== 'flatten') {
          setAmount('');
        }
        return type;
      };

      const actionLabels = {
        'manual-buy': '매수',
        'manual-sell': '매도',
        flatten: '전량 청산',
      };
      const label = actionLabels[type] || '명령';

      toast.promise(executeCommand(), {
        loading: `${label} 요청 중...`,
        success: `${label} 명령이 큐에 등록되었습니다. (다음 루프에서 집행)`,
        error: (err) => {
          const message = err instanceof Error ? err.message : String(err);
          return `${label} 실패: ${message}`;
        },
      });
    },
    [amount]
  );

  return {
    amount,
    status,
    handleAmountChange,
    submit,
  };
}
