export function isUndefinedTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || error === null) return false;
  const maybe = error as { parent?: { code?: string }; original?: { code?: string }; code?: string };
  const code = maybe.parent?.code ?? maybe.original?.code ?? maybe.code;
  return code === '42P01';
}

export function logMissingTable(table: string): void {
  if (process.env.NODE_ENV === 'test') return;
  console.warn(`[DB] Table "${table}" missing. Run migrations or enable DB_AUTO_SYNC to create it.`);
}
