/**
 * A Log Cache envelope after parsing, as stored in `log_entries` (see `src/main/db/schema.ts`).
 * `props` holds the parsed JSON payload (top-level keys become dynamic columns; nested values stay
 * queryable via dotted paths). `tsNs` is a nanosecond decimal string.
 */
export interface ParsedEntry {
  tsNs: string;
  appGuid: string;
  appName: string;
  /** `APP/PROC/WEB`, `RTR`, `CELL`, `STG`, ... (`UNKNOWN` when the envelope had no tag). */
  sourceType: string;
  instance: number | null;
  stream: 'OUT' | 'ERR';
  /** Display message: JSON `msg|message|text|log` or the raw line. */
  message: string;
  /** Normalised level (`TRACE|DEBUG|INFO|WARN|ERROR|FATAL`) or null. */
  level: string | null;
  isJson: boolean;
  /** Payload with trailing newlines removed. */
  raw: string;
  props: Record<string, unknown> | null;
  /** `ts:app:instance:stream:hash(raw)` — unique per session (`INSERT OR IGNORE`). */
  dedupeKey: string;
}

export const LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;
export type Level = (typeof LEVELS)[number];
