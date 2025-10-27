import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveRuntimePath } from '../../../lib/runtime-path';
import type { TelemetrySnapshot } from '@scalper/shared';

export const dynamic = 'force-dynamic';

const SNAPSHOT_PATH = path.join(resolveRuntimePath(), 'telemetry.json');

export async function GET() {
  try {
    const raw = await readFile(SNAPSHOT_PATH, 'utf8');
    const data = JSON.parse(raw) as TelemetrySnapshot;
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') {
      return NextResponse.json({ ok: false, data: null });
    }
    console.error('[telemetry] read error', error);
    return NextResponse.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
