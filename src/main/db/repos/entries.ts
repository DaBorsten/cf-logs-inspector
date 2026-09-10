import type Database from 'better-sqlite3';
import type { ParsedEntry } from '@shared/model/log-entry';

type Db = Database.Database;
type Statement = Database.Statement;

const cache = new WeakMap<Db, Map<string, Statement>>();

/** Per-connection prepared statement cache (statements are tied to their Database instance). */
export function prepared(db: Db, sql: string): Statement {
  let map = cache.get(db);
  if (!map) {
    map = new Map();
    cache.set(db, map);
  }
  let stmt = map.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    map.set(sql, stmt);
  }
  return stmt;
}

const INSERT_SQL = `INSERT OR IGNORE INTO log_entries
  (session_id, ts_ns, app_guid, app_name, source_type, instance, stream, level, message, is_json, raw, props, dedupe_key)
  VALUES (@sessionId, @tsNs, @appGuid, @appName, @sourceType, @instance, @stream, @level, @message, @isJson, @raw, @props, @dedupeKey)`;

/**
 * Inserts entries (duplicates by `(session_id, dedupe_key)` are ignored). Must be called inside a
 * transaction for throughput. Returns the number of new rows and the newest timestamp among them.
 */
export function insertEntries(
  db: Db,
  sessionId: number,
  entries: readonly ParsedEntry[],
): { inserted: number; maxTsNs: string | undefined } {
  const stmt = prepared(db, INSERT_SQL);
  let inserted = 0;
  let maxTs: bigint | undefined;
  for (const e of entries) {
    const info = stmt.run({
      sessionId,
      tsNs: BigInt(e.tsNs),
      appGuid: e.appGuid,
      appName: e.appName,
      sourceType: e.sourceType,
      instance: e.instance,
      stream: e.stream,
      level: e.level,
      message: e.message,
      isJson: e.isJson ? 1 : 0,
      raw: e.raw,
      props: e.props ? JSON.stringify(e.props) : null,
      dedupeKey: e.dedupeKey,
    });
    if (info.changes > 0) {
      inserted++;
      const ts = BigInt(e.tsNs);
      if (maxTs === undefined || ts > maxTs) maxTs = ts;
    }
  }
  return { inserted, maxTsNs: maxTs?.toString() };
}

export function countEntries(db: Db, sessionId?: number): number {
  const row = (
    sessionId === undefined
      ? prepared(db, `SELECT COUNT(*) AS n FROM log_entries`).get()
      : prepared(db, `SELECT COUNT(*) AS n FROM log_entries WHERE session_id = ?`).get(sessionId)
  ) as { n: number };
  return row.n;
}

export function maxEntryId(db: Db): number {
  const row = prepared(db, `SELECT COALESCE(MAX(id), 0) AS id FROM log_entries`).get() as {
    id: number;
  };
  return row.id;
}

/** Deletes the `count` oldest rows of a session. */
export function deleteOldestOfSession(db: Db, sessionId: number, count: number): number {
  if (count <= 0) return 0;
  return prepared(
    db,
    `DELETE FROM log_entries WHERE id IN
       (SELECT id FROM log_entries WHERE session_id = ? ORDER BY ts_ns, id LIMIT ?)`,
  ).run(sessionId, count).changes;
}

/** Deletes the `count` oldest rows across the workspace; returns the affected session ids. */
export function deleteOldestOfWorkspace(db: Db, count: number): number[] {
  if (count <= 0) return [];
  const rows = prepared(
    db,
    `DELETE FROM log_entries WHERE id IN
       (SELECT id FROM log_entries ORDER BY ts_ns, id LIMIT ?)
     RETURNING session_id`,
  ).all(count) as { session_id: number }[];
  return [...new Set(rows.map((r) => r.session_id))];
}

export interface PropStat {
  key: string;
  type: string;
  count: number;
  sample: string | null;
}

const UPSERT_PROP_SQL = `INSERT INTO session_props (session_id, key, type, count, sample)
  VALUES (@sessionId, @key, @type, @count, @sample)
  ON CONFLICT(session_id, key) DO UPDATE SET
    count = count + excluded.count,
    type = CASE WHEN type = excluded.type THEN type ELSE 'mixed' END,
    sample = COALESCE(sample, excluded.sample)`;

export function upsertProps(db: Db, sessionId: number, stats: Iterable<PropStat>): void {
  const stmt = prepared(db, UPSERT_PROP_SQL);
  for (const s of stats)
    stmt.run({ sessionId, key: s.key, type: s.type, count: s.count, sample: s.sample });
}

export function listProps(db: Db, sessionIds?: number[]): PropStat[] {
  if (sessionIds && sessionIds.length === 0) return [];
  const where = sessionIds ? `WHERE session_id IN (${sessionIds.map(() => '?').join(',')})` : '';
  return db
    .prepare(
      `SELECT key, CASE WHEN COUNT(DISTINCT type) = 1 THEN MIN(type) ELSE 'mixed' END AS type,
              SUM(count) AS count, MIN(sample) AS sample
         FROM session_props ${where} GROUP BY key ORDER BY count DESC, key`,
    )
    .all(...(sessionIds ?? [])) as PropStat[];
}

/** JSON type name used in `session_props.type`. */
export function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // string | number | boolean | object
}
