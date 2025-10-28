# CLAUDE.md

이 파일은 이 저장소에서 작업할 때 Claude Code (claude.ai/code)에게 가이드를 제공합니다.

## 프로젝트 개요

ccxt를 사용하여 CSV 데이터로 백테스트하고 Binance/Upbit에서 실시간/모의 거래를 실행할 수 있는 TypeScript로 구축된 RSI 리버전 스캘핑 봇입니다. 프로젝트는 두 개의 주요 애플리케이션으로 구성됩니다:

- **트레이딩 봇** (`apps/bot/`) - 실시간 및 백테스트 기능을 갖춘 TypeScript 트레이딩 봇
- **웹 대시보드** (`apps/web/`) - 모니터링 및 제어를 위한 Next.js 대시보드

## 개발 명령어

### 트레이딩 봇
- `pnpm build` - TypeScript를 `apps/bot/dist/`로 컴파일
- `pnpm dev:backtest` - tsx로 백테스트 실행 (CSV 파일 경로 인수 필요)
- `pnpm dev:live` - 개발 모드에서 tsx로 라이브 봇 실행
- `pnpm start:backtest` - dist에서 컴파일된 백테스트 실행
- `pnpm start:live` - dist에서 컴파일된 라이브 봇 실행

### 웹 대시보드
- `pnpm dev:web` - Next.js 개발 서버 시작
- `pnpm build:web` - 프로덕션용 Next.js 빌드
- `pnpm start:web` - 프로덕션 Next.js 서버 시작

## 아키텍처

### 봇 구조 (`apps/bot/src/`)
- `live.ts` - 실시간 거래 실행 진입점
- `backtest.ts` - CSV 백테스트 진입점
- `strategy.ts` - RSI 신호 생성 로직
- `risk.ts` - 거래 규모 및 리스크 관리
- `config.ts` - 환경 변수 매핑 및 설정
- `exchange.ts` - 거래소 API 추상화 레이어

### 웹 대시보드 (`apps/web/`)
- App Router를 사용하는 Next.js 14 애플리케이션
- 텔레메트리, 설정, 히스토리, 액션을 위한 `app/api/` API 라우트
- 차트 및 UI 요소를 위한 `app/components/` 컴포넌트
- `runtime/` 디렉토리의 공유 런타임 파일

## 설정

### 환경 설정
1. 봇 설정을 위해 `apps/bot/.env.example`을 `apps/bot/.env`로 복사
2. 대시보드 설정을 위해 `apps/web/.env.example`을 `apps/web/.env`로 복사
3. 거래소 자격 증명 및 거래 매개변수 설정

### 주요 환경 변수
- `EXCHANGE` - 거래소 이름 (binanceus, upbit)
- `USE_SANDBOX` - 테스트넷/샌드박스 모드 활성화
- `DRY_RUN` - 모의 거래 모드
- `PG_ENABLE` - PostgreSQL 로깅 활성화
- `RSI_ENTRY`/`RSI_EXIT` - RSI 전략 임계값

## 데이터베이스 통합

`PG_ENABLE=true`일 때, 봇은 자동으로 생성하고 채웁니다:
- `price_ticks` - 각 거래 루프의 가격 데이터 스냅샷
- `trade_events` - 거래 실행 메타데이터 및 이벤트

## 코딩 규칙

- 명명된 내보내기와 함께 ES 모듈 사용
- 변수/함수에는 camelCase, 상수에는 UPPER_SNAKE_CASE 적용
- 2칸 들여쓰기 및 소문자 파일 이름 사용
- `import type` 구문으로 타입 가져오기
- `[GUARD]`, `[SKIP]`, `[COOLDOWN]`과 같은 접두사로 로그 태그 지정

## 테스트 전략

- 공식 테스트 프레임워크 없음 - 회귀 테스트로 `pnpm dev:backtest` 사용
- 대표적인 CSV 백테스트를 통해 변경사항 검증
- 배포 전 개발 및 빌드된 진입점 모두 테스트
- 개발 시 항상 `USE_SANDBOX=true`로 실행

## 안전 기능

- 일일 손실 한도 (`MAX_DAILY_LOSS_PCT`)
- 거래 쿨다운 기간
- 각 주문에 고유한 `clientOrderId`
- 거래소 정밀도 및 최소 수량 검증
- 포괄적인 드라이런 로깅

## 중요한 파일

- `runtime/` - (레거시) 파일 기반 텔레메트리/명령 저장소, 현재는 Postgres 기반 공유
- `AGENTS.md` - 상세한 코딩 가이드라인 및 규칙 포함
- 두 애플리케이션 모두 별도의 TypeScript 설정 (`tsconfig.json`, `tsconfig.next.json`)
