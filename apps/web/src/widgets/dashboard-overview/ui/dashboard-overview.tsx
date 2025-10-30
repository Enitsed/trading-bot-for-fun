// widgets/dashboard-overview/ui/dashboard-overview.tsx
// FSD: 위젯은 여러 엔터티/피처를 조합해 특정 화면 조각을 제공하며 페이지 구성에서 재사용됩니다.

import type { TelemetrySnapshot, RuntimeCfg } from '@scalper/shared';
import { formatNumber, formatTimestamp } from '../../../shared/lib/format';
import type { SnapshotStatus, DashboardCard } from '../../../entities/telemetry';

type DashboardOverviewProps = {
  snapshot: TelemetrySnapshot | null;
  status: SnapshotStatus;
  error: string | null;
  cards: DashboardCard[];
  recentSignals: string[];
  runtimeCfg?: RuntimeCfg;
};

export function DashboardOverview(props: DashboardOverviewProps): JSX.Element {
  const { snapshot, status, error, cards, recentSignals } = props;

  return (
    <>
      <header>
        <h1>실시간 트레이딩 현황</h1>
        <p className="meta">
          마지막 스냅샷: {formatTimestamp(snapshot?.timestamp)} · 최근 이벤트: {snapshot?.event || '-'}
        </p>
      </header>

      {status === 'loading' && <p className="notice">데이터를 불러오는 중입니다…</p>}
      {status === 'empty' && <p className="notice">아직 생성된 스냅샷이 없습니다. 봇을 실행해 주세요.</p>}
      {status === 'error' && (
        <p className="notice error">데이터를 불러올 수 없습니다: {error ?? '알 수 없는 오류'}</p>
      )}

      {status === 'ready' && snapshot && (
        <>
          <section className="grid">
            {cards.map(({ label, value, note }) => (
              <article key={label} className="card">
                <h2>{label}</h2>
                <p className="value">{value}</p>
                {note ? <p className="note">{note}</p> : null}
              </article>
            ))}
          </section>

          <section className="balance-explanation">
            <h3>💡 잔고 설명</h3>
            <div className="explanation-grid">
              <div className="explanation-item">
                <h4>현금 잔고 ({process.env.NEXT_PUBLIC_QUOTE ?? 'USDT'})</h4>
                <p>새로운 코인 매수에 사용되는 금액입니다. 매수 주문 시 이 잔고에서 차감됩니다.</p>
              </div>
              <div className="explanation-item">
                <h4>코인 잔고 ({process.env.NEXT_PUBLIC_BASE ?? 'BTC'})</h4>
                <p>현재 보유 중인 코인 수량입니다. 매도 주문 시 현금으로 전환됩니다.</p>
              </div>
              <div className="explanation-item">
                <h4>총 평가금액</h4>
                <p>현금 잔고 + (코인 잔고 × 현재가)로 계산된 총 자산 가치입니다.</p>
              </div>
            </div>
          </section>

          <section className="details">
            <div>
              <h3>진입 정보</h3>
              <dl>
                <div>
                  <dt>마지막 체결 시각</dt>
                  <dd>{formatTimestamp(snapshot.lastTradeTs)}</dd>
                </div>
                <div>
                  <dt>현재 진입가</dt>
                  <dd>{formatNumber(snapshot.entryPrice, { fractionDigits: 2 })}</dd>
                </div>
                <div>
                  <dt>손절/익절</dt>
                  <dd>
                    {snapshot.openBracket
                      ? `STOP ${formatNumber(snapshot.openBracket.stop, { fractionDigits: 2 })} / TAKE ${formatNumber(
                          snapshot.openBracket.take,
                          { fractionDigits: 2 }
                        )}`
                      : '-'}
                  </dd>
                </div>
                <div>
                  <dt>신호</dt>
                  <dd>{snapshot.signal}</dd>
                </div>
              </dl>
            </div>
            <div>
              <h3>임계값</h3>
              <dl>
                <div>
                  <dt>Base Min</dt>
                  <dd>{formatNumber(snapshot.thresholds?.baseMin, { fractionDigits: 6 })}</dd>
                </div>
                <div>
                  <dt>Base Step</dt>
                  <dd>{formatNumber(snapshot.thresholds?.baseStep, { fractionDigits: 6 })}</dd>
                </div>
                <div>
                  <dt>Notional Min</dt>
                  <dd>{formatNumber(snapshot.thresholds?.notionalMin, { fractionDigits: 2 })}</dd>
                </div>
                <div>
                  <dt>거래 가능 최소량</dt>
                  <dd>{formatNumber(snapshot.thresholds?.tradable, { fractionDigits: 6 })}</dd>
                </div>
              </dl>
            </div>
          </section>

          <section>
            <h3>최근 신호</h3>
            <ul className="signals">
              {recentSignals.map((item, idx) => (
                <li key={`${item}-${idx}`}>{item}</li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
