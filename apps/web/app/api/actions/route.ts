import { NextResponse } from 'next/server';
import { enqueueManualCommand } from '@scalper/shared';
import type { ManualActionPayload, ManualActionType } from '@scalper/shared';
const ALLOWED_TYPES: Set<ManualActionType> = new Set(['manual-buy', 'manual-sell', 'flatten']);

/**
 * Validates and sanitizes manual action payload
 * @throws Error with specific error code if validation fails
 */
function sanitizeAction(body: unknown): ManualActionPayload {
  if (!body || typeof body !== 'object') {
    throw new Error('INVALID_BODY');
  }

  const { type, amount } = body as { type?: unknown; amount?: unknown };

  // Validate type
  if (typeof type !== 'string' || !ALLOWED_TYPES.has(type as ManualActionType)) {
    throw new Error('INVALID_TYPE');
  }

  // Validate amount for buy/sell actions
  if (type === 'manual-buy' || type === 'manual-sell') {
    if (amount === undefined || amount === null) {
      throw new Error('AMOUNT_REQUIRED');
    }

    const num = Number(amount);

    if (!Number.isFinite(num)) {
      throw new Error('INVALID_AMOUNT');
    }

    if (num <= 0) {
      throw new Error('AMOUNT_MUST_BE_POSITIVE');
    }

    // Prevent unreasonably large amounts (potential fat-finger errors)
    const MAX_AMOUNT = 1_000_000;
    if (num > MAX_AMOUNT) {
      throw new Error(`AMOUNT_TOO_LARGE (max: ${MAX_AMOUNT})`);
    }

    return { type: type as ManualActionType, amount: num };
  }

  // Flatten doesn't need amount
  return { type: type as ManualActionType };
}

export async function POST(request: Request) {
  try {
    // Parse JSON with error handling
    let body: unknown;
    try {
      body = await request.json();
    } catch (parseError) {
      return NextResponse.json(
        { ok: false, error: 'INVALID_JSON' },
        { status: 400 }
      );
    }

    // Validate and sanitize payload
    const payload = sanitizeAction(body);

    // Enqueue command
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

    // Determine appropriate status code
    if (message === 'COMMAND_STORE_UNAVAILABLE') {
      return NextResponse.json({ ok: false, error: 'DB_TABLE_MISSING' }, { status: 503 });
    }

    // Validation errors get 400, database errors get 500
    const isValidationError =
      message.startsWith('INVALID_') ||
      message.startsWith('AMOUNT_') ||
      message === 'INVALID_TYPE' ||
      message === 'INVALID_BODY';

    const status = isValidationError ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
