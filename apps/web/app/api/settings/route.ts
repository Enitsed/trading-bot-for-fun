import { NextResponse } from 'next/server';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveRuntimePath } from '../../../lib/runtime-path';
import type { RuntimeOverrideKey, RuntimeOverridesPayload } from '../../../lib/types';

const RUNTIME_DIR = resolveRuntimePath();
const OVERRIDES_PATH = path.join(RUNTIME_DIR, 'overrides.json');
const ALLOWED_KEYS: RuntimeOverrideKey[] = [
  'rsiLen',
  'rsiEntry',
  'rsiExit',
  'riskPerTrade',
  'stopPct',
  'takePct',
  'cooldownMin',
];

async function readOverrides(): Promise<RuntimeOverridesPayload> {
  try {
    const raw = await readFile(OVERRIDES_PATH, 'utf8');
    const data = JSON.parse(raw) as RuntimeOverridesPayload;
    if (data && typeof data === 'object') {
      return data;
    }
    return {};
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') return {};
    console.warn('[settings] read failed', error);
    throw error;
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
  const overrides = await readOverrides();
  return NextResponse.json({ ok: true, overrides });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'INVALID_BODY' }, { status: 400 });
    }
    const sanitized = sanitizePayload(body);
    const current = await readOverrides();
    const next: RuntimeOverridesPayload = { ...current };
    for (const [key, value] of Object.entries(sanitized) as [RuntimeOverrideKey, number | null][]) {
      if (value === null) {
        delete next[key];
      } else {
        next[key] = value;
      }
    }
    await mkdir(RUNTIME_DIR, { recursive: true });
    await writeFile(OVERRIDES_PATH, JSON.stringify(next));
    return NextResponse.json({ ok: true, overrides: next });
  } catch (error) {
    console.error('[settings] update failed', error);
    const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
