import { NextResponse } from 'next/server';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RUNTIME_DIR = path.join(process.cwd(), 'runtime');
const OVERRIDES_PATH = path.join(RUNTIME_DIR, 'overrides.json');
const ALLOWED_KEYS = [
  'rsiLen',
  'rsiEntry',
  'rsiExit',
  'riskPerTrade',
  'stopPct',
  'takePct',
  'cooldownMin',
];

async function readOverrides() {
  try {
    const raw = await readFile(OVERRIDES_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      return data;
    }
    return {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    console.warn('[settings] read failed', error);
    throw error;
  }
}

function sanitizePayload(payload) {
  const result = {};
  let touched = false;
  for (const key of ALLOWED_KEYS) {
    if (!(key in payload)) continue;
    touched = true;
    const value = payload[key];
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

export async function GET() {
  const overrides = await readOverrides();
  return NextResponse.json({ ok: true, overrides });
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'INVALID_BODY' }, { status: 400 });
    }
    const sanitized = sanitizePayload(body);
    const current = await readOverrides();
    const next = { ...current };
    for (const [key, value] of Object.entries(sanitized)) {
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
    return NextResponse.json({ ok: false, error: error.message || 'INTERNAL_ERROR' }, { status: 400 });
  }
}
