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
      throw new Error(`Invalid value for ${key}`);
    }
    result[key] = num;
  }
  if (!touched) {
    throw new Error('No valid fields provided');
  }
  return result;
}

export async function GET(): Promise<NextResponse<{ ok: true; overrides: RuntimeOverridesPayload }>> {
  const overrides = await getRuntimeOverrides();
  return NextResponse.json({ ok: true, overrides: overrides as RuntimeOverridesPayload });
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
    console.error('[settings] update failed', error);
    const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
