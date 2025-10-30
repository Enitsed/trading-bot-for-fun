// features/manual-command/model/useManualCommand.ts
// FSD: 수동 매매 역시 기능 단위이므로 feature layer에서 상태와 액션을 캡슐화합니다.

import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import type { ManualActionPayload, ManualActionType } from '@scalper/shared';
import {
  addActionToHistory,
  getRecentActions,
  type ActionHistoryEntry,
} from '../../../shared/lib/action-history';

export function useManualCommand() {
  const [amount, setAmount] = useState<string>('');
  const [status, setStatus] = useState<string | null>(null);
  const [history, setHistory] = useState<ActionHistoryEntry[]>([]);

  // 초기 히스토리 로드 및 업데이트 감지
  useEffect(() => {
    setHistory(getRecentActions(10));

    // storage 이벤트 리스너로 다른 탭의 변경사항 반영
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'scalper-action-history') {
        setHistory(getRecentActions(10));
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const handleAmountChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setAmount(event.target.value);
  }, []);

  const submit = useCallback(
    async (type: ManualActionType) => {
      const parsedAmount = type !== 'flatten' && amount.trim() !== '' ? Number(amount) : undefined;

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
        success: () => {
          // 성공시 히스토리에 추가
          addActionToHistory({
            type,
            amount: parsedAmount,
            status: 'success',
            message: '큐에 등록됨',
          });
          setHistory(getRecentActions(10));
          return `${label} 명령이 큐에 등록되었습니다. (다음 루프에서 집행)`;
        },
        error: (err) => {
          // 실패시에도 히스토리에 추가
          const message = err instanceof Error ? err.message : String(err);
          addActionToHistory({
            type,
            amount: parsedAmount,
            status: 'error',
            message,
          });
          setHistory(getRecentActions(10));
          return `${label} 실패: ${message}`;
        },
      });
    },
    [amount]
  );

  return {
    amount,
    status,
    history,
    handleAmountChange,
    submit,
  };
}
