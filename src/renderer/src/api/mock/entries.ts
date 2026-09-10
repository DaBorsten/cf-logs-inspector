/** Deterministic sample entries for the mock backend (tests, browser-only dev). */
import type { EntryDetail, PropInfo } from '@shared/model/query';

const MS = 1_000_000n;
const LEVELS = ['INFO', 'INFO', 'DEBUG', 'WARN', 'ERROR', null] as const;
const TENANTS = ['t1', 't2', 't3'];

export interface MockEntryOptions {
  count: number;
  /** First id (ids increase by 1). */
  startId?: number;
  sessionId?: number;
  appName?: string;
  appGuid?: string;
  /** Timestamp of the first entry in ms; each entry is 1 s later. */
  startMs?: number;
}

export function makeMockEntries(opts: MockEntryOptions): EntryDetail[] {
  const startId = opts.startId ?? 1;
  const startMs = opts.startMs ?? Date.parse('2026-09-10T10:00:00Z');
  const out: EntryDetail[] = [];
  for (let i = 0; i < opts.count; i++) {
    const id = startId + i;
    const level = LEVELS[i % LEVELS.length] ?? null;
    const json = i % 3 !== 2;
    const message = json ? `request ${id} handled` : `plain line ${id}`;
    const props = json
      ? { level: level?.toLowerCase() ?? 'info', msg: message, tenant: TENANTS[i % 3], count: i }
      : null;
    out.push({
      id,
      sessionId: opts.sessionId ?? 1,
      tsNs: (BigInt(startMs + i * 1000) * MS).toString(),
      appGuid: opts.appGuid ?? 'app-1',
      appName: opts.appName ?? 'api',
      sourceType: 'APP/PROC/WEB',
      instance: i % 2,
      stream: level === 'ERROR' ? 'ERR' : 'OUT',
      level,
      message,
      isJson: json,
      props,
      raw: json ? JSON.stringify(props) : message,
    });
  }
  return out;
}

export function propsOf(entries: EntryDetail[]): PropInfo[] {
  const map = new Map<string, PropInfo>();
  for (const e of entries) {
    for (const [key, value] of Object.entries(e.props ?? {})) {
      const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      const cur = map.get(key);
      if (cur) {
        cur.count++;
        if (cur.type !== type) cur.type = 'mixed';
      } else
        map.set(key, {
          key,
          type,
          count: 1,
          sample: typeof value === 'string' ? value : JSON.stringify(value),
        });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
