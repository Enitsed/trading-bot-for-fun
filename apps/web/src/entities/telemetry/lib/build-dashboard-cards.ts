// entities/telemetry/lib/build-dashboard-cards.ts
// FSD: 엔터티 전환 로직을 한곳에 모아 UI가 단순히 데이터를 소비하도록 만듭니다.

import type { TelemetrySnapshot } from '@scalper/shared';
import { formatNumber } from '../../../shared/lib/format';

export type DashboardCard = {
  label: string;
  value: string;
  note?: string;
};

export function buildDashboardCards(snapshot: TelemetrySnapshot | null): DashboardCard[] {
  if (!snapshot) return [];

  const price = formatNumber(snapshot.price, { fractionDigits: 2 });
  const equity = formatNumber(snapshot.equity, { fractionDigits: 2 });
  const drawdown = snapshot.drawdown !== undefined ? snapshot.drawdown.toFixed?.(2) : undefined;
  const totalPnl = formatNumber(snapshot.totalPnl, { fractionDigits: 2 });
  const totalPnlPct = formatNumber(snapshot.totalPnlPct * 100, { fractionDigits: 2 });
  const position = formatNumber(snapshot.position, { fractionDigits: 6 });
  const quoteFree = formatNumber(snapshot.balances?.quoteFree, { fractionDigits: 2 });
  const baseFree = formatNumber(snapshot.balances?.baseFree, { fractionDigits: 6 });
  const quoteCurrency = process.env.NEXT_PUBLIC_QUOTE ?? 'USDT';
  const baseCurrency = process.env.NEXT_PUBLIC_BASE ?? 'BTC';

  return [
    { label: '현재가', value: price, note: snapshot.mark ? '(마크 포함)' : '' },
    { label: '총 평가금액', value: equity, note: '현금 + 코인 평가액' },
    { label: '누적 손익', value: `${totalPnl} (${totalPnlPct}%)`, note: '시작 대비 누적 손익' },
    { label: '일중 손익률', value: drawdown ? `${drawdown}%` : '-' },
    { label: '보유 수량', value: position, note: `매도 가능한 ${baseCurrency}` },
    {
      label: `현금 잔고 (${quoteCurrency})`,
      value: quoteFree,
      note: `매수에 사용할 수 있는 ${quoteCurrency} 금액`,
    },
    {
      label: `코인 잔고 (${baseCurrency})`,
      value: baseFree,
      note: `보유 중인 ${baseCurrency} 수량 (매도 시 현금 전환)`,
    },
  ];
}
