import { Op } from 'sequelize';
import { ManualCommandModel, RuntimeOverrideModel, SnapshotModel, ensureDbConnection } from './database.js';
import type { TelemetrySnapshot, RuntimeOverrideKey, ManualActionType } from './types.js';
import { isUndefinedTableError, logMissingTable } from './db-utils.js';

const COMMAND_TYPES = new Set<ManualActionType>(['manual-buy', 'manual-sell', 'flatten']);
const loggedTables = new Set<string>();

function logMissingTableOnce(table: string): void {
  if (loggedTables.has(table)) return;
  logMissingTable(table);
  loggedTables.add(table);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(num) ? (num as number) : null;
}

export async function saveTelemetrySnapshot(snapshot: TelemetrySnapshot): Promise<void> {
  await ensureDbConnection();
  await SnapshotModel.create({
    snapshotTs: new Date(snapshot.timestamp),
    payload: snapshot,
  });
}

export async function fetchLatestSnapshot(): Promise<TelemetrySnapshot | null> {
  await ensureDbConnection();
  try {
    const row = await SnapshotModel.findOne({ order: [['snapshot_ts', 'DESC']] });
    if (!row) return null;
    const payload = row.get('payload');
    return (payload as TelemetrySnapshot) ?? null;
  } catch (error) {
    if (isUndefinedTableError(error)) {
      logMissingTableOnce('bot_snapshots');
      return null;
    }
    throw error;
  }
}

export async function getRuntimeOverrides(): Promise<Record<RuntimeOverrideKey, number>> {
  await ensureDbConnection();
  try {
    const rows = (await RuntimeOverrideModel.findAll()) as RuntimeOverrideModel[];
    const overrides: Partial<Record<RuntimeOverrideKey, number>> = {};
    for (const row of rows) {
      const key = row.get('key') as RuntimeOverrideKey;
      const value = toNumber(row.get('value'));
      if (value !== null) {
        overrides[key] = value;
      }
    }
    return overrides as Record<RuntimeOverrideKey, number>;
  } catch (error) {
    if (isUndefinedTableError(error)) {
      logMissingTableOnce('runtime_overrides');
      return {} as Record<RuntimeOverrideKey, number>;
    }
    throw error;
  }
}

export async function updateRuntimeOverrides(
  diff: Partial<Record<RuntimeOverrideKey, number | null>>
): Promise<Record<RuntimeOverrideKey, number>> {
  await ensureDbConnection();
  try {
    const entries = Object.entries(diff) as [RuntimeOverrideKey, number | null][];
    for (const [key, value] of entries) {
      if (value === null) {
        await RuntimeOverrideModel.destroy({ where: { key } });
      } else if (Number.isFinite(value)) {
        await RuntimeOverrideModel.upsert({ key, value });
      }
    }
    return getRuntimeOverrides();
  } catch (error) {
    if (isUndefinedTableError(error)) {
      logMissingTableOnce('runtime_overrides');
      return {} as Record<RuntimeOverrideKey, number>;
    }
    throw error;
  }
}

export async function enqueueManualCommand(type: ManualActionType, amount?: number): Promise<string> {
  if (!COMMAND_TYPES.has(type)) {
    throw new Error(`Unsupported command type: ${type}`);
  }
  await ensureDbConnection();
  try {
    const row = await ManualCommandModel.create({
      type,
      amount: Number.isFinite(amount) && amount !== undefined ? amount : null,
    });
    return row.get('id') as string;
  } catch (error) {
    if (isUndefinedTableError(error)) {
      logMissingTableOnce('manual_commands');
      throw new Error('COMMAND_STORE_UNAVAILABLE');
    }
    throw error;
  }
}

export async function fetchPendingCommands(): Promise<Array<{
  id: string;
  type: ManualActionType;
  amount: number | null;
  createdAt: Date;
}>> {
  await ensureDbConnection();
  try {
    const rows = (await ManualCommandModel.findAll({
      where: { status: 'pending' },
      order: [['created_at', 'ASC']],
    })) as ManualCommandModel[];
    return rows.map((row) => ({
      id: row.get('id') as string,
      type: row.get('type') as ManualActionType,
      amount: toNumber(row.get('amount')),
      createdAt: row.get('created_at') as Date,
    }));
  } catch (error) {
    if (isUndefinedTableError(error)) {
      logMissingTableOnce('manual_commands');
      return [];
    }
    throw error;
  }
}

export async function markCommandsProcessed(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await ensureDbConnection();
  try {
    await ManualCommandModel.update(
      { status: 'processed', processedAt: new Date() },
      { where: { id: { [Op.in]: ids } } }
    );
  } catch (error) {
    if (isUndefinedTableError(error)) {
      logMissingTableOnce('manual_commands');
      return;
    }
    throw error;
  }
}
