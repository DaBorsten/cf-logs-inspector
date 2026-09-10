import type Database from 'better-sqlite3';
import type { ParsedEntry } from '@shared/model/log-entry';
import type { StreamBatchEvent } from '@shared/model/session';
import { DEFAULT_RETENTION, type RetentionSettings } from '@shared/model/workspace';
import {
  deleteOldestOfSession,
  deleteOldestOfWorkspace,
  insertEntries,
  jsonTypeOf,
  maxEntryId,
  upsertProps,
  type PropStat,
} from '../db/repos/entries';
import { recordBatch, recountSessions } from '../db/repos/sessions';
import { noopLogger, type Logger } from '../log';

type Db = Database.Database;

export interface WriterOptions {
  db: Db;
  /** Flush at least this often while entries are queued. Default 250 ms. */
  flushIntervalMs?: number;
  /** Flush immediately once this many entries are queued. Default 500. */
  maxBatch?: number;
  retention?: RetentionSettings;
  onBatch?: (event: StreamBatchEvent) => void;
  logger?: Logger;
}

interface Queued {
  sessionId: number;
  entries: ParsedEntry[];
}

const SAMPLE_MAX = 200;

/**
 * Batches parsed entries from all pollers of the open workspace into one transaction every
 * `flushIntervalMs` or `maxBatch` entries, updates per-session counts/props, applies retention and
 * reports counts per session. `enqueue` resolves after the entries were committed, which gives pollers
 * natural backpressure (they await it before reading the next page).
 */
export class Writer {
  private readonly db: Db;
  private readonly flushIntervalMs: number;
  private readonly maxBatch: number;
  private readonly retention: RetentionSettings;
  private readonly onBatch: WriterOptions['onBatch'];
  private readonly logger: Logger;
  private queue: Queued[] = [];
  private queued = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private waiters: { resolve: () => void; reject: (err: unknown) => void }[] = [];
  private closed = false;
  private total = 0;

  constructor(opts: WriterOptions) {
    this.db = opts.db;
    this.flushIntervalMs = opts.flushIntervalMs ?? 250;
    this.maxBatch = opts.maxBatch ?? 500;
    this.retention = opts.retention ?? DEFAULT_RETENTION;
    this.onBatch = opts.onBatch;
    this.logger = opts.logger ?? noopLogger;
  }

  /** Entries committed since construction (for tests and status). */
  get inserted(): number {
    return this.total;
  }

  get pending(): number {
    return this.queued;
  }

  /** Resolves once the given entries are committed (or rejects if that flush failed). */
  enqueue(sessionId: number, entries: ParsedEntry[]): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Writer is closed'));
    if (entries.length === 0) return Promise.resolve();
    this.queue.push({ sessionId, entries });
    this.queued += entries.length;
    const done = new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject }));
    if (this.queued >= this.maxBatch) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
    return done;
  }

  /** Commits everything queued right now (synchronous; better-sqlite3 is blocking). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.queue.length === 0) return;
    const batch = this.queue;
    const waiters = this.waiters;
    this.queue = [];
    this.queued = 0;
    this.waiters = [];
    try {
      const events = this.db.transaction(() => this.commit(batch))();
      for (const w of waiters) w.resolve();
      for (const ev of events) this.onBatch?.(ev);
    } catch (err) {
      this.logger.error(`writer flush failed: ${String(err)}`);
      for (const w of waiters) w.reject(err);
    }
  }

  /** Flushes and refuses further work. */
  close(): void {
    this.flush();
    this.closed = true;
  }

  private commit(batch: Queued[]): StreamBatchEvent[] {
    // Group by session so counts, props and retention run once per session per flush.
    const bySession = new Map<number, ParsedEntry[]>();
    for (const q of batch) {
      const list = bySession.get(q.sessionId);
      if (list) list.push(...q.entries);
      else bySession.set(q.sessionId, [...q.entries]);
    }
    const events: StreamBatchEvent[] = [];
    let workspaceTotal = 0;
    for (const [sessionId, entries] of bySession) {
      const { inserted, maxTsNs } = insertEntries(this.db, sessionId, entries);
      this.total += inserted;
      let totalCount = 0;
      if (inserted > 0) {
        totalCount = recordBatch(this.db, sessionId, inserted, maxTsNs!);
        upsertProps(this.db, sessionId, collectProps(entries));
        const excess = totalCount - this.retention.maxRowsPerSession;
        if (excess > 0) {
          const pruned = deleteOldestOfSession(this.db, sessionId, excess);
          recountSessions(this.db, [sessionId]);
          totalCount -= pruned;
          this.logger.info(`session ${sessionId}: pruned ${pruned} rows (per-session retention)`);
        }
      } else {
        totalCount =
          (
            this.db.prepare(`SELECT entry_count FROM log_sessions WHERE id = ?`).get(sessionId) as
              { entry_count: number } | undefined
          )?.entry_count ?? 0;
      }
      events.push({ sessionId, inserted, totalCount, latestId: 0 });
    }
    workspaceTotal = (
      this.db.prepare(`SELECT COALESCE(SUM(entry_count), 0) AS n FROM log_sessions`).get() as {
        n: number;
      }
    ).n;
    const excess = workspaceTotal - this.retention.maxRowsWorkspace;
    if (excess > 0) {
      const affected = deleteOldestOfWorkspace(this.db, excess);
      recountSessions(this.db, affected);
      this.logger.info(`workspace: pruned ${excess} rows across sessions ${affected.join(',')}`);
      for (const ev of events) {
        if (affected.includes(ev.sessionId)) {
          ev.totalCount = (
            this.db
              .prepare(`SELECT entry_count FROM log_sessions WHERE id = ?`)
              .get(ev.sessionId) as {
              entry_count: number;
            }
          ).entry_count;
        }
      }
    }
    const latestId = maxEntryId(this.db);
    for (const ev of events) ev.latestId = latestId;
    return events;
  }
}

/** Aggregates top-level JSON keys of a batch into `session_props` increments. */
export function collectProps(entries: readonly ParsedEntry[]): PropStat[] {
  const stats = new Map<string, PropStat>();
  for (const e of entries) {
    if (!e.props) continue;
    for (const [key, value] of Object.entries(e.props)) {
      const type = jsonTypeOf(value);
      const cur = stats.get(key);
      if (cur) {
        cur.count++;
        if (cur.type !== type) cur.type = 'mixed';
      } else {
        stats.set(key, { key, type, count: 1, sample: sampleOf(value) });
      }
    }
  }
  return [...stats.values()];
}

function sampleOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > SAMPLE_MAX ? `${s.slice(0, SAMPLE_MAX)}…` : s;
}
