import { NextResponse } from 'next/server';
import { getRuntimeOverrides, updateRuntimeOverrides } from '@scalper/shared';
import type { RuntimeOverrideKey, RuntimeOverridesPayload } from '@scalper/shared';
const ALLOWED_KEYS: RuntimeOverrideKey[] = [
  'rsiLen',
  'rsiEntry',
  'rsiExit',
  'riskPerTrade',
  'stopPct',
  'takePct',
  'cooldownMin',
];

/**
 * Validates numeric value is within acceptable bounds
 */
function validateBounds(key: RuntimeOverrideKey, value: number): void {
  switch (key) {
    case 'rsiLen':
      if (value < 2 || value > 200) {
        throw new Error(`rsiLen must be between 2 and 200, got ${value}`);
      }
      break;
    case 'rsiEntry':
      if (value < 0 || value > 100) {
        throw new Error(`rsiEntry must be between 0 and 100, got ${value}`);
      }
      break;
    case 'rsiExit':
      if (value < 0 || value > 100) {
        throw new Error(`rsiExit must be between 0 and 100, got ${value}`);
      }
      break;
    case 'riskPerTrade':
      if (value <= 0 || value >= 1) {
        throw new Error(`riskPerTrade must be between 0 and 1 (exclusive), got ${value}`);
      }
      break;
    case 'stopPct':
      if (value <= 0 || value >= 1) {
        throw new Error(`stopPct must be between 0 and 1 (exclusive), got ${value}`);
      }
      break;
    case 'takePct':
      if (value <= 0 || value >= 1) {
        throw new Error(`takePct must be between 0 and 1 (exclusive), got ${value}`);
      }
      break;
    case 'cooldownMin':
      if (value < 0) {
        throw new Error(`cooldownMin must be >= 0, got ${value}`);
      }
      break;
  }
}

/**
 * Validates cross-field constraints
 */
function validateCrossFields(payload: RuntimeOverridesPayload): void {
  // Validate rsiEntry < rsiExit if both are set
  if (
    payload.rsiEntry !== null &&
    payload.rsiEntry !== undefined &&
    payload.rsiExit !== null &&
    payload.rsiExit !== undefined
  ) {
    if (payload.rsiEntry >= payload.rsiExit) {
      throw new Error(
        `rsiEntry (${payload.rsiEntry}) must be less than rsiExit (${payload.rsiExit})`
      );
    }
  }

  // Validate stopPct < takePct if both are set
  if (
    payload.stopPct !== null &&
    payload.stopPct !== undefined &&
    payload.takePct !== null &&
    payload.takePct !== undefined
  ) {
    if (payload.stopPct >= payload.takePct) {
      throw new Error(
        `stopPct (${payload.stopPct}) must be less than takePct (${payload.takePct})`
      );
    }
  }
}

function sanitizePayload(payload: unknown): RuntimeOverridesPayload {
  const result: RuntimeOverridesPayload = {};
  let touched = false;

  for (const key of ALLOWED_KEYS) {
    if (!payload || typeof payload !== 'object' || !(key in payload)) continue;
    touched = true;

    const value = (payload as Record<RuntimeOverrideKey, unknown>)[key];

    if (value === null) {
      result[key] = null;
      continue;
    }

    const num = Number(value);
    if (!Number.isFinite(num)) {
      throw new Error(`Invalid value for ${key}: ${value}`);
    }

    // Validate bounds
    validateBounds(key, num);

    result[key] = num;
  }

  if (!touched) {
    throw new Error('No valid fields provided');
  }

  // Validate cross-field constraints
  validateCrossFields(result);

  return result;
}

export async function GET() {
  try {
    const overrides = await getRuntimeOverrides();
    return NextResponse.json({ ok: true, overrides: overrides as RuntimeOverridesPayload });
  } catch (error) {
    console.error('[settings] GET failed', error);
    const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'INVALID_BODY' }, { status: 400 });
    }

    const sanitized = sanitizePayload(body);
    const overrides = await updateRuntimeOverrides(sanitized);

    return NextResponse.json({ ok: true, overrides: overrides as RuntimeOverridesPayload });
  } catch (error) {
    console.error('[settings] POST failed', error);
    const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';

    // Return 400 for validation errors, 500 for database errors
    const isValidationError = error instanceof Error && (
      message.includes('must be') ||
      message.includes('Invalid value') ||
      message.includes('No valid fields')
    );

    const status = isValidationError ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
