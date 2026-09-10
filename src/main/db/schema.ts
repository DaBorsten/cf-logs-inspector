import type { Database } from 'better-sqlite3';

/**
 * Workspace schema. Each array element is one migration step; `PRAGMA user_version` records how many
 * have been applied. Append new steps, never edit applied ones.
 */
export const MIGRATIONS: readonly string[] = [
  // v1 — initial schema (docs/DEVELOPMENT_PLAN.md "SQLite schema")
  `
  CREATE TABLE log_sessions (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    org_guid TEXT, org_name TEXT, space_guid TEXT, space_name TEXT,
    app_guid TEXT NOT NULL, app_name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_ts_ns TEXT,
    status TEXT NOT NULL DEFAULT 'stopped',
    entry_count INTEGER NOT NULL DEFAULT 0,
    poll_interval_ms INTEGER NOT NULL DEFAULT 1000
  );
  CREATE TABLE log_entries (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES log_sessions(id) ON DELETE CASCADE,
    ts_ns INTEGER NOT NULL,
    app_guid TEXT NOT NULL, app_name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    instance INTEGER,
    stream TEXT NOT NULL,
    level TEXT,
    message TEXT NOT NULL,
    is_json INTEGER NOT NULL DEFAULT 0,
    raw TEXT NOT NULL,
    props TEXT,
    dedupe_key TEXT NOT NULL
  );
  CREATE UNIQUE INDEX ux_entries_dedupe ON log_entries(session_id, dedupe_key);
  CREATE INDEX ix_entries_session_ts ON log_entries(session_id, ts_ns, id);
  CREATE INDEX ix_entries_ts ON log_entries(ts_ns, id);
  CREATE INDEX ix_entries_session_level ON log_entries(session_id, level);
  CREATE TABLE session_props (
    session_id INTEGER NOT NULL REFERENCES log_sessions(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    type TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    sample TEXT,
    PRIMARY KEY (session_id, key)
  );
  CREATE TABLE saved_filters (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, dql TEXT NOT NULL, time_filter TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE column_layouts (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, columns TEXT NOT NULL, sort TEXT,
    is_default INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
  );
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Connection-level pragmas; applied on every open. */
export function applyPragmas(db: Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('temp_store = MEMORY');
}

/** Applies pending migrations inside one transaction per step. Returns the resulting version. */
export function migrate(db: Database): number {
  let version = Number(db.pragma('user_version', { simple: true }));
  if (version > MIGRATIONS.length) {
    throw new Error(
      `Workspace schema version ${version} is newer than this app supports (${MIGRATIONS.length})`,
    );
  }
  while (version < MIGRATIONS.length) {
    const step = MIGRATIONS[version]!;
    const next = version + 1;
    db.transaction(() => {
      db.exec(step);
      db.pragma(`user_version = ${next}`);
    })();
    version = next;
  }
  return version;
}
