// shared/lib/action-history.ts
// 수동 매매 액션 히스토리를 localStorage에 저장하고 관리하는 유틸리티

import type { ManualActionType } from '@scalper/shared';

export type ActionHistoryEntry = {
  id: string;
  type: ManualActionType;
  amount?: number;
  timestamp: number;
  status: 'success' | 'error';
  message?: string;
};

const STORAGE_KEY = 'scalper-action-history';
const MAX_HISTORY_SIZE = 50; // 최대 50개까지 저장 (최근 10개만 표시)

/**
 * 액션 히스토리를 localStorage에서 불러오기
 */
export function loadActionHistory(): ActionHistoryEntry[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    return parsed;
  } catch (error) {
    console.error('[ActionHistory] Failed to load history', error);
    return [];
  }
}

/**
 * 새로운 액션을 히스토리에 추가
 */
export function addActionToHistory(entry: Omit<ActionHistoryEntry, 'id' | 'timestamp'>): void {
  if (typeof window === 'undefined') return;

  try {
    const history = loadActionHistory();
    const newEntry: ActionHistoryEntry = {
      ...entry,
      id: generateId(),
      timestamp: Date.now(),
    };

    // 최신 항목을 맨 앞에 추가
    const updatedHistory = [newEntry, ...history].slice(0, MAX_HISTORY_SIZE);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedHistory));
  } catch (error) {
    console.error('[ActionHistory] Failed to add entry', error);
  }
}

/**
 * 히스토리 초기화
 */
export function clearActionHistory(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('[ActionHistory] Failed to clear history', error);
  }
}

/**
 * 최근 N개 항목 가져오기
 */
export function getRecentActions(limit = 10): ActionHistoryEntry[] {
  const history = loadActionHistory();
  return history.slice(0, limit);
}

/**
 * 유니크 ID 생성
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 액션 타입을 한글로 변환
 */
export function formatActionType(type: ManualActionType): string {
  const labels: Record<ManualActionType, string> = {
    'manual-buy': '수동 매수',
    'manual-sell': '수동 매도',
    flatten: '전량 청산',
  };
  return labels[type] || type;
}

/**
 * 타임스탬프를 상대 시간으로 변환 (예: "2분 전")
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}일 전`;
  if (hours > 0) return `${hours}시간 전`;
  if (minutes > 0) return `${minutes}분 전`;
  if (seconds > 0) return `${seconds}초 전`;
  return '방금 전';
}
