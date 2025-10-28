import { NextResponse } from 'next/server';
import { fetchLatestSnapshot } from '@scalper/shared';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const snapshot = await fetchLatestSnapshot();
    if (!snapshot) {
      return NextResponse.json({ ok: false, data: null });
    }
    return NextResponse.json({ ok: true, data: snapshot });
  } catch (error) {
    console.error('[telemetry] fetch error', error);
    return NextResponse.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
