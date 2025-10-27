import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(LIB_DIR, '../../..');
const DEFAULT_RUNTIME = path.join(REPO_ROOT, 'runtime');
const ENV_RUNTIME = process.env.RUNTIME_DIR ? path.resolve(process.env.RUNTIME_DIR) : null;

export function resolveRuntimePath(...segments: string[]): string {
  const base = ENV_RUNTIME || DEFAULT_RUNTIME;
  return segments.length > 0 ? path.join(base, ...segments) : base;
}
