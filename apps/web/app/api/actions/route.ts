import { NextResponse } from 'next/server';
import { enqueueManualCommand } from '@scalper/shared';
import type { ManualActionPayload, ManualActionType } from '@scalper/shared';
const ALLOWED_TYPES: Set<ManualActionType> = new Set(['manual-buy', 'manual-sell', 'flatten']);

function sanitizeAction(body: unknown): ManualActionPayload {
  if (!body || typeof body !== 'object') {
    throw new Error('INVALID_BODY');
  }
  const { type, amount } = body as { type?: unknown; amount?: unknown };
  if (typeof type !== 'string' || !ALLOWED_TYPES.has(type as ManualActionType)) {
    throw new Error('INVALID_TYPE');
  }
  if ((type === 'manual-buy' || type === 'manual-sell') && amount !== undefined) {
    const num = Number(amount);
    if (!Number.isFinite(num) || num <= 0) {
      throw new Error('INVALID_AMOUNT');
    }
    return { type: type as ManualActionType, amount: num };
  }
  return { type: type as ManualActionType };
}

export async function POST(request: Request) {
  try {
    const payload = sanitizeAction(await request.json());
    const commandId = await enqueueManualCommand(payload.type, payload.amount);
    return NextResponse.json({
      ok: true,
      command: {
        id: commandId,
        type: payload.type,
        amount: payload.amount,
        createdAt: Date.now(),
      },
    });
  } catch (error) {
    console.error('[actions] enqueue failed', error);
    const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    if (message === 'COMMAND_STORE_UNAVAILABLE') {
      return NextResponse.json({ ok: false, error: 'DB_TABLE_MISSING' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
