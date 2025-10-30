// validators/ohlc-validator.ts
// OHLCV 데이터 검증 유틸리티 - 코드 중복 제거를 위해 추출

export type OHLCData = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string; details?: Record<string, unknown> };

/**
 * OHLC 가격이 모두 유한하고 양수인지 검증
 */
export function validatePriceValues(ohlc: OHLCData): ValidationResult {
  const priceFields = { open: ohlc.open, high: ohlc.high, low: ohlc.low, close: ohlc.close } as const;

  for (const [key, value] of Object.entries(priceFields)) {
    if (!Number.isFinite(value) || value <= 0) {
      return {
        valid: false,
        reason: `Invalid price: ${key}=${value} (must be finite and positive)`,
        details: { [key]: value, ohlc: priceFields },
      };
    }
  }

  return { valid: true };
}

/**
 * OHLC 관계가 올바른지 검증
 * - high >= low
 * - open in [low, high]
 * - close in [low, high]
 */
export function validatePriceRelationships(ohlc: OHLCData): ValidationResult {
  const { open, high, low, close } = ohlc;

  // high >= low
  if (high < low) {
    return {
      valid: false,
      reason: 'High price is less than low price (corrupted candle)',
      details: { high, low },
    };
  }

  // open in [low, high]
  if (open > high || open < low) {
    return {
      valid: false,
      reason: 'Open price is outside [low, high] range',
      details: { open, high, low },
    };
  }

  // close in [low, high]
  if (close > high || close < low) {
    return {
      valid: false,
      reason: 'Close price is outside [low, high] range',
      details: { close, high, low },
    };
  }

  return { valid: true };
}

/**
 * 거래량 검증 (유한하고 비음수)
 */
export function validateVolume(volume: number): ValidationResult {
  if (!Number.isFinite(volume) || volume < 0) {
    return {
      valid: false,
      reason: `Invalid volume: ${volume} (must be finite and non-negative)`,
      details: { volume },
    };
  }

  return { valid: true };
}

/**
 * OHLCV 데이터 전체 검증
 * @param ohlc - 검증할 OHLC 데이터
 * @param validateVolumeFlag - 거래량 검증 여부 (기본값: true)
 */
export function validateOHLC(ohlc: OHLCData, validateVolumeFlag = true): ValidationResult {
  // 1. 가격 값 검증
  const priceValidation = validatePriceValues(ohlc);
  if (!priceValidation.valid) {
    return priceValidation;
  }

  // 2. 가격 관계 검증
  const relationshipValidation = validatePriceRelationships(ohlc);
  if (!relationshipValidation.valid) {
    return relationshipValidation;
  }

  // 3. 거래량 검증 (선택적)
  if (validateVolumeFlag && ohlc.volume !== undefined) {
    const volumeValidation = validateVolume(ohlc.volume);
    if (!volumeValidation.valid) {
      return volumeValidation;
    }
  }

  return { valid: true };
}

/**
 * OHLCV 배열에서 유효하지 않은 데이터를 필터링
 */
export function filterValidCandles<T extends OHLCData>(
  candles: T[],
  options: {
    validateVolume?: boolean;
    onInvalid?: (candle: T, reason: string) => void;
  } = {}
): T[] {
  const { validateVolume: checkVolume = true, onInvalid } = options;

  return candles.filter((candle) => {
    const result = validateOHLC(candle, checkVolume);
    if (!result.valid) {
      onInvalid?.(candle, result.reason);
      return false;
    }
    return true;
  });
}
