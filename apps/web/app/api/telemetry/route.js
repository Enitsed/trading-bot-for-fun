import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

const ROOT_DIR = path.resolve(process.cwd(), '..');
const SNAPSHOT_PATH = path.join(ROOT_DIR, 'runtime', 'telemetry.json');

export async function GET() {
  try {
    const raw = await readFile(SNAPSHOT_PATH, 'utf8');
    const data = JSON.parse(raw);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return NextResponse.json({ ok: false, data: null });
    }
    console.error('[telemetry] read error', error);
    return NextResponse.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
