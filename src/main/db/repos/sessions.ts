import type Database from 'better-sqlite3';
import {
  DEFAULT_POLL_INTERVAL_MS,
  type LogSession,
  type SessionCreateInput,
  type SessionStatus,
} from '@shared/model/session';
import { InvalidInputError, NotFoundError } from '../../cf/errors';

type Db = Database.Database;

interface SessionRow {
  id: number;
  name: string;
  connection_id: string;
  org_guid: string | null;
  org_name: string | null;
  space_guid: string | null;
  space_name: string | null;
  app_guid: string;
  app_name: string;
  created_at: number;
  last_ts_ns: string | null;
  status: string;
  entry_count: number;
  poll_interval_ms: number;
}

const COLUMNS = `id, name, connection_id, org_guid, org_name, space_guid, space_name, app_guid, app_name,
  created_at, last_ts_ns, status, entry_count, poll_interval_ms`;

function toSession(r: SessionRow): LogSession {
  const s: LogSession = {
    id: r.id,
    name: r.name,
    connectionId: r.connection_id,
    appGuid: r.app_guid,
    appName: r.app_name,
    createdAt: r.created_at,
    status: (r.status as SessionStatus) ?? 'stopped',
    entryCount: r.entry_count,
    pollIntervalMs: r.poll_interval_ms,
  };
  if (r.org_guid) s.orgGuid = r.org_guid;
  if (r.org_name) s.orgName = r.org_name;
  if (r.space_guid) s.spaceGuid = r.space_guid;
  if (r.space_name) s.spaceName = r.space_name;
  if (r.last_ts_ns) s.lastTsNs = r.last_ts_ns;
  return s;
}

export function listSessions(db: Db): LogSession[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM log_sessions ORDER BY created_at, id`)
    .all() as SessionRow[];
  return rows.map(toSession);
}

export function findSession(db: Db, id: number): LogSession | undefined {
  const row = db.prepare(`SELECT ${COLUMNS} FROM log_sessions WHERE id = ?`).get(id) as
    SessionRow | undefined;
  return row ? toSession(row) : undefined;
}

export function getSession(db: Db, id: number): LogSession {
  const s = findSession(db, id);
  if (!s) throw new NotFoundError(`Unknown session ${id}`);
  return s;
}

export function createSession(db: Db, input: SessionCreateInput, now: number): LogSession {
  if (!input.appGuid || !input.appName)
    throw new InvalidInputError('appGuid and appName are required');
  const name = (input.name ?? input.appName).trim() || input.appName;
  const result = db
    .prepare(
      `INSERT INTO log_sessions (name, connection_id, org_guid, org_name, space_guid, space_name, app_guid, app_name,
         created_at, poll_interval_ms)
       VALUES (@name, @connectionId, @orgGuid, @orgName, @spaceGuid, @spaceName, @appGuid, @appName, @createdAt, @pollIntervalMs)`,
    )
    .run({
      name,
      connectionId: input.connectionId,
      orgGuid: input.orgGuid ?? null,
      orgName: input.orgName ?? null,
      spaceGuid: input.spaceGuid ?? null,
      spaceName: input.spaceName ?? null,
      appGuid: input.appGuid,
      appName: input.appName,
      createdAt: now,
      pollIntervalMs: input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    });
  return getSession(db, Number(result.lastInsertRowid));
}

export function deleteSession(db: Db, id: number): void {
  const info = db.prepare(`DELETE FROM log_sessions WHERE id = ?`).run(id);
  if (info.changes === 0) throw new NotFoundError(`Unknown session ${id}`);
}

export function setSessionStatus(db: Db, id: number, status: SessionStatus): void {
  db.prepare(`UPDATE log_sessions SET status = ? WHERE id = ?`).run(status, id);
}

export function setPollInterval(db: Db, id: number, pollIntervalMs: number): void {
  const info = db
    .prepare(`UPDATE log_sessions SET poll_interval_ms = ? WHERE id = ?`)
    .run(pollIntervalMs, id);
  if (info.changes === 0) throw new NotFoundError(`Unknown session ${id}`);
}

/** Adds `inserted` to the count and moves `last_ts_ns` forward (never backwards). */
export function recordBatch(db: Db, id: number, inserted: number, lastTsNs: string): number {
  db.prepare(
    `UPDATE log_sessions
        SET entry_count = entry_count + @inserted,
            last_ts_ns = CASE WHEN last_ts_ns IS NULL OR CAST(last_ts_ns AS INTEGER) < CAST(@ts AS INTEGER) THEN @ts ELSE last_ts_ns END
      WHERE id = @id`,
  ).run({ inserted, ts: lastTsNs, id });
  const row = db.prepare(`SELECT entry_count FROM log_sessions WHERE id = ?`).get(id) as
    { entry_count: number } | undefined;
  return row?.entry_count ?? 0;
}

/** Recomputes `entry_count` from the entries table (after pruning). */
export function recountSessions(db: Db, ids?: number[]): void {
  const sql = `UPDATE log_sessions SET entry_count = (SELECT COUNT(*) FROM log_entries e WHERE e.session_id = log_sessions.id)`;
  if (!ids) db.prepare(sql).run();
  else if (ids.length > 0)
    db.prepare(`${sql} WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
}

/** Removes all entries and discovered props of a session but keeps the session (and its cursor is reset). */
export function clearSessionData(db: Db, id: number): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM log_entries WHERE session_id = ?`).run(id);
    db.prepare(`DELETE FROM session_props WHERE session_id = ?`).run(id);
    const info = db
      .prepare(`UPDATE log_sessions SET entry_count = 0, last_ts_ns = NULL WHERE id = ?`)
      .run(id);
    if (info.changes === 0) throw new NotFoundError(`Unknown session ${id}`);
  })();
}
