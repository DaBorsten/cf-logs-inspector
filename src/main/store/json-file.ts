import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { z } from 'zod';
import { noopLogger, type Logger } from '../log';

/** Reads and validates a JSON file; missing file -> `fallback`; corrupt file -> moved aside, `fallback`. */
export function readJsonFile<T>(
  path: string,
  schema: z.ZodType<T>,
  fallback: () => T,
  logger: Logger = noopLogger,
): T {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return fallback();
  }
  try {
    return schema.parse(JSON.parse(text));
  } catch (err) {
    const backup = `${path}.corrupt-${Date.now()}`;
    logger.error(`${path} unreadable, moving to ${backup}: ${String(err)}`);
    try {
      renameSync(path, backup);
    } catch {
      /* ignore */
    }
    return fallback();
  }
}

/** Atomic write: temp file in the same directory, then rename over the target. */
export function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameWithRetry(tmp, path);
}

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);

/**
 * `renameSync` with a few short retries: on Windows a just-written file can be transiently locked by
 * the indexer or antivirus, which surfaces as EPERM/EBUSY on the rename.
 */
export function renameWithRetry(from: string, to: string, attempts = 6): void {
  for (let i = 0; ; i++) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (i >= attempts - 1 || !code || !RETRYABLE.has(code)) throw err;
      sleepSync(10 * (i + 1));
    }
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
