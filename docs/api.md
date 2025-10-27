# API 문서

이 문서는 웹 대시보드에서 사용하는 API 엔드포인트들을 설명합니다.

## 엔드포인트 목록

### 1. GET /api/telemetry

실시간 텔레메트리 데이터를 가져옵니다.

**응답 예시:**
```json
{
  "timestamp": 1761554233393,
  "price": 115332.89,
  "signal": "LONG",
  "recentSignals": ["HOLD", "HOLD", "LONG", "EXIT", "EXIT"],
  "position": 0.1087,
  "entryPrice": 115332.89,
  "openBracket": {
    "stop": 114525.55976999999,
    "take": 116716.88468
  },
  "thresholds": {
    "baseMin": 0.00001,
    "baseStep": 0.00001,
    "notionalMin": 5,
    "tradable": 0.00005
  },
  "equity": 125377.3342272,
  "drawdown": 0.011769052832089066,
  "mark": 115332.88,
  "balances": {
    "quoteFree": 112840.6501712,
    "quoteTotal": 112840.6501712,
    "baseFree": 0.1087,
    "baseTotal": 0.1087
  },
  "lastTradeTs": 1761554233016,
  "event": "buy",
  "runtimeCfg": {
    "rsiLen": 1,
    "rsiEntry": 40,
    "rsiExit": 70,
    "riskPerTrade": 0.1,
    "stopPct": 0.006999999999999999,
    "takePct": 0.012,
    "cooldownMin": 1
  }
}
```

**에러 응답:**
- `404`: 텔레메트리 파일을 찾을 수 없음
- `500`: 서버 내부 오류

### 2. GET /api/history

과거 가격 데이터와 잔고 변화를 가져옵니다.

**Query Parameters:**
- `hours` (optional): 조회할 시간 범위 (기본값: 24, 최대: 4320)
- `tf` (optional): 시간 프레임 (`5m`, `15m`, `1h`, `1d`, 기본값: `1h`)

**요청 예시:**
```
GET /api/history?hours=72&tf=15m
```

**응답 예시:**
```json
{
  "ok": true,
  "timeframe": "15m",
  "candles": [
    {
      "timestamp": 1761550800000,
      "open": 115200.0,
      "high": 115400.0,
      "low": 115100.0,
      "close": 115350.0,
      "volume": 1250.5
    }
  ],
  "equity": [
    {
      "timestamp": 1761550800000,
      "value": 125000.0
    }
  ]
}
```

**에러 응답:**
- `503`: PostgreSQL이 비활성화됨 (`PG_DISABLED`)
- `500`: 데이터베이스 쿼리 실패

### 3. GET /api/settings

현재 런타임 설정 오버라이드를 가져옵니다.

**응답 예시:**
```json
{
  "overrides": {
    "rsiEntry": 35,
    "riskPerTrade": 0.15
  }
}
```

### 4. POST /api/settings

런타임 설정을 업데이트합니다.

**요청 본문:**
```json
{
  "rsiLen": 2,
  "rsiEntry": 30,
  "rsiExit": 80,
  "riskPerTrade": 0.5,
  "stopPct": 0.01,
  "takePct": 0.028,
  "cooldownMin": 1
}
```

**응답:**
```json
{
  "ok": true
}
```

**에러 응답:**
- `400`: 잘못된 요청 형식
- `500`: 설정 저장 실패

### 5. POST /api/actions

수동 거래 명령을 실행합니다.

**요청 본문:**
```json
{
  "type": "manual-buy",
  "amount": 0.001
}
```

**액션 타입:**
- `manual-buy`: 수동 매수
- `manual-sell`: 수동 매도
- `flatten`: 포지션 정리

**응답:**
```json
{
  "ok": true,
  "commandId": "uuid-string"
}
```

**에러 응답:**
- `400`: 잘못된 액션 타입 또는 매개변수
- `500`: 명령 저장 실패

## 공통 에러 형식

모든 API는 에러 발생 시 다음 형식으로 응답합니다:

```json
{
  "ok": false,
  "error": "ERROR_CODE_OR_MESSAGE"
}
```

## 인증

현재 모든 API는 인증이 필요하지 않습니다. 로컬 네트워크에서만 사용하도록 설계되었습니다.

## 데이터 갱신 주기

- 텔레메트리: 5초마다 자동 갱신
- 히스토리: 60초마다 자동 갱신
- 설정: 실시간 반영