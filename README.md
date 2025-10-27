# RSI 리버전 스캐퍼 (TypeScript)

[ccxt](https://github.com/ccxt/ccxt)를 사용해 CSV 캔들로 백테스트하고 Binance/Upbit에서 실시간(또는 모의)으로 운용할 수 있는 RSI 평균회귀 기반 스캘핑 봇입니다.

## 아이디어
- RSI가 과매도 구간으로 내려갔다가 진입 임계값을 다시 상향 돌파하면 **롱 진입**
- RSI가 중간선(또는 목표 수익/손절)에 도달하면 청산
- 쿨다운, 일일 손실 제한, 드라이런 지원 포함

## 시작하기

1. **의존성 설치**
   ```bash
   pnpm install
   # 또는 npm install / yarn install
   ```
2. **환경 설정**
   - `.env.example`을 `.env`로 복사하고 거래소 API 정보를 채워 넣습니다.
   - Binance 사용자는 `EXCHANGE=binanceus`, `USE_SANDBOX=true`로 테스트넷을 사용할 수 있습니다.
   - Upbit 사용자는 `EXCHANGE=upbit`, `USE_SANDBOX=false`, `DRY_RUN=true`(Upbit에는 공식 샌드박스가 없음)로 시작하세요.
   - 시세/체결 히스토리를 남기려면 Postgres를 준비하고 `PG_ENABLE=true`와 `PG_URL` 또는 `PG_HOST`/`PG_USER`/`PG_PASSWORD`/`PG_DATABASE` 값을 채웁니다. 봇이 기동되면 `price_ticks`, `trade_events` 테이블을 자동 생성합니다.
3. **빌드**
   ```bash
   pnpm build
   ```
4. **백테스트 실행**
   `ts,open,high,low,close,volume`(타임스탬프는 ms) 컬럼을 가진 CSV를 준비한 뒤:
   ```bash
   node dist/backtest.js ./data/btcusdt_5m.csv
   ```
5. **실거래/모의거래 실행**
   ```bash
   node dist/live.js
   ```

## 스크립트

- `pnpm dev:backtest` – ts-node로 백테스트 실행
- `pnpm dev:live` – ts-node로 실시간 봇 실행
- `pnpm start:backtest` – 빌드된 백테스트 실행
- `pnpm start:live` – 빌드된 실시간 봇 실행

## Postgres 기록
- 라이브 봇은 `PG_ENABLE=true`일 때 각 루프에서 최신 호가 스냅샷을 `price_ticks` 테이블에 저장하고, 마켓 주문이 체결되면 `trade_events` 테이블에 체결 메타데이터(사이드, 수량, 이벤트, 주문 ID 등)를 기록합니다.
- 연결은 `PG_URL` 또는 `PG_HOST`/`PG_PORT`/`PG_USER`/`PG_PASSWORD`/`PG_DATABASE` 환경변수로 구성할 수 있습니다.
- 로깅 실패는 트레이딩 루프를 중단시키지 않으며, 초기화에 실패하면 로그는 자동으로 비활성화됩니다.

## 튜닝 팁
- 과매도 진입 기준은 `RSI_ENTRY`를 25–35, 평균회귀 청산 기준은 `RSI_EXIT`을 45–55 정도로 조정
- 스캘핑 특성상 0.3–0.8% 손절, 0.8–1.5% 익절과 같이 촘촘한 브래킷 추천
- 손실 직후 즉시 재진입을 피하려면 쿨다운을 5–15분 범위에서 조절
- 거래소 수수료/슬리피지를 백테스트에 반영
- 체결 안정성 확인 전까지 `RISK_PER_TRADE`는 0.5–1% 수준으로 보수적으로 운용

## 안전장치
- 일일 손실 한도(`MAX_DAILY_LOSS_PCT`)
- 주문마다 고유한 `clientOrderId` 부여
- 트레이드 간 쿨다운 적용
- 거래소 최소 수량 및 정밀도 검사
- 드라이런 로그 모드 지원

## 면책조항
이 코드는 교육용 예시입니다. 실제 자금을 투입하기 전 충분히 이해하고 테스트하세요.
