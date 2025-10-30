// shared/lib/format.ts
// FSD: 공통 포맷터는 모든 슬라이스에서 재사용되므로 shared layer에 배치합니다.

export type FormatNumberOptions = {
  fractionDigits?: number;
};

export function formatNumber(value: number | null | undefined, options: FormatNumberOptions = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const { fractionDigits = 2 } = options;
  return new Intl.NumberFormat('ko-KR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatTimestamp(ts: number | null | undefined): string {
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

export function formatPercentInput(value: number): string {
  const scaled = Number(value) * 100;
  if (!Number.isFinite(scaled)) return '';
  return parseFloat(scaled.toFixed(4)).toString();
}
