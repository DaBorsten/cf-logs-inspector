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
  renameSync(tmp, path);
}
