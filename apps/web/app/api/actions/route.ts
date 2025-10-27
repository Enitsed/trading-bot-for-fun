import { NextResponse } from 'next/server';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { resolveRuntimePath } from '../../../lib/runtime-path';
import type { ManualActionPayload, ManualActionType, ManualCommand } from '@scalper/shared';

const RUNTIME_DIR = resolveRuntimePath();
const COMMANDS_PATH = path.join(RUNTIME_DIR, 'commands.json');
const ALLOWED_TYPES: Set<ManualActionType> = new Set(['manual-buy', 'manual-sell', 'flatten']);

async function readCommands(): Promise<ManualCommand[]> {
  try {
    const raw = await readFile(COMMANDS_PATH, 'utf8');
    const data = JSON.parse(raw) as ManualCommand[];
    if (Array.isArray(data)) return data;
    return [];
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') return [];
    console.warn('[actions] read failed', error);
    throw error;
  }
}

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
    const commands = await readCommands();
    const command: ManualCommand = {
      id: randomUUID(),
      type: payload.type,
      amount: payload.amount,
      createdAt: Date.now(),
    };
    commands.push(command);
    await mkdir(RUNTIME_DIR, { recursive: true });
    await writeFile(COMMANDS_PATH, JSON.stringify(commands));
    return NextResponse.json({ ok: true, command });
  } catch (error) {
    console.error('[actions] enqueue failed', error);
    const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
