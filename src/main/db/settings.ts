import type Database from 'better-sqlite3';
import { z } from 'zod';
import { DEFAULT_RETENTION, type RetentionSettings } from '@shared/model/workspace';

export const RETENTION_KV_KEY = 'retention';

const retentionSchema = z.object({
  maxRowsPerSession: z.number().int().min(1000).max(50_000_000).optional(),
  maxRowsWorkspace: z.number().int().min(1000).max(200_000_000).optional(),
});

/** Retention limits of the open workspace (kv `retention`, merged over the defaults). */
export function readRetention(db: Database.Database): RetentionSettings {
  const row = db.prepare(`SELECT value FROM kv WHERE key = ?`).get(RETENTION_KV_KEY) as
    { value: string | null } | undefined;
  if (!row?.value) return DEFAULT_RETENTION;
  try {
    const parsed = retentionSchema.safeParse(JSON.parse(row.value));
    if (!parsed.success) return DEFAULT_RETENTION;
    return {
      maxRowsPerSession: parsed.data.maxRowsPerSession ?? DEFAULT_RETENTION.maxRowsPerSession,
      maxRowsWorkspace: parsed.data.maxRowsWorkspace ?? DEFAULT_RETENTION.maxRowsWorkspace,
    };
  } catch {
    return DEFAULT_RETENTION;
  }
}
