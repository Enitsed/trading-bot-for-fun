import { NextResponse } from 'next/server';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const RUNTIME_DIR = path.join(process.cwd(), 'runtime');
const COMMANDS_PATH = path.join(RUNTIME_DIR, 'commands.json');
const ALLOWED_TYPES = new Set(['manual-buy', 'manual-sell', 'flatten']);

async function readCommands() {
  try {
    const raw = await readFile(COMMANDS_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    return [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    console.warn('[actions] read failed', error);
    throw error;
  }
}

function sanitizeAction(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('INVALID_BODY');
  }
  const { type, amount } = body;
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error('INVALID_TYPE');
  }
  if ((type === 'manual-buy' || type === 'manual-sell') && amount !== undefined) {
    const num = Number(amount);
    if (!Number.isFinite(num) || num <= 0) {
      throw new Error('INVALID_AMOUNT');
    }
    return { type, amount: num };
  }
  return { type };
}

export async function POST(request) {
  try {
    const payload = sanitizeAction(await request.json());
    const commands = await readCommands();
    const command = {
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
    return NextResponse.json({ ok: false, error: error.message || 'INTERNAL_ERROR' }, { status: 400 });
  }
}
