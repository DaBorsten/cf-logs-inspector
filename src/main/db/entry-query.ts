import type Database from 'better-sqlite3';
import { parse } from '@shared/dql';
import { DYNAMIC_FIELD_RE, resolveFixedField } from '@shared/model/fields';
import {
  DEFAULT_SORT,
  MAX_PAGE_SIZE,
  type EntryCount,
  type EntryCountQuery,
  type EntryDetail,
  type EntryPage,
  type EntryQuery,
  type EntryRow,
  type PropInfo,
  type SortSpec,
  type ValuesQuery,
} from '@shared/model/query';
import { InvalidInputError, NotFoundError } from '../cf/errors';
import { compileDql, QueryCompileError, sortExpression, TS_ISO_EXPR } from './query-compiler';
import { listProps, prepared } from './repos/entries';
import { resolveTimeFilter } from './time';

type Db = Database.Database;

const ROW_COLUMNS = `id, session_id, CAST(ts_ns AS TEXT) AS ts_ns, app_guid, app_name, source_type, instance,
  stream, level, message, is_json, props`;

interface RawRow {
  id: number;
  session_id: number;
  ts_ns: string;
  app_guid: string;
  app_name: string;
  source_type: string;
  instance: number | null;
  stream: 'OUT' | 'ERR';
  level: string | null;
  message: string;
  is_json: number;
  props: string | null;
  raw?: string;
}

export function rowToEntry(r: RawRow): EntryRow {
  let props: Record<string, unknown> | null = null;
  if (r.props) {
    try {
      props = JSON.parse(r.props) as Record<string, unknown>;
    } catch {
      props = null;
    }
  }
  return {
    id: r.id,
    sessionId: r.session_id,
    tsNs: r.ts_ns,
    appGuid: r.app_guid,
    appName: r.app_name,
    sourceType: r.source_type,
    instance: r.instance,
    stream: r.stream,
    level: r.level,
    message: r.message,
    isJson: r.is_json === 1,
    props,
  };
}

interface Where {
  sql: string;
  params: unknown[];
}

/** Base predicate (index-friendly first) plus the compiled DQL. */
function buildWhere(
  q: { sessionIds?: number[]; dql?: string; time?: EntryCountQuery['time']; snapshotId?: number },
  nowMs: number,
  withSnapshot: boolean,
): Where {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (q.sessionIds) {
    if (q.sessionIds.length === 0) return { sql: '0', params: [] };
    parts.push(`session_id IN (${q.sessionIds.map(() => '?').join(', ')})`);
    params.push(...q.sessionIds);
  }
  const range = resolveTimeFilter(q.time, nowMs);
  if (range.fromNs !== undefined) {
    parts.push('ts_ns >= ?');
    params.push(range.fromNs);
  }
  if (range.toNs !== undefined) {
    parts.push('ts_ns < ?');
    params.push(range.toNs);
  }
  if (withSnapshot && q.snapshotId !== undefined) {
    parts.push('id <= ?');
    params.push(q.snapshotId);
  }
  if (q.dql && q.dql.trim()) {
    const parsed = parse(q.dql);
    if (!parsed.ok) {
      throw new InvalidInputError(`Invalid query: ${parsed.error.message}`, {
        details: parsed.error,
      });
    }
    const compiled = compileDql(parsed.ast);
    if (compiled.sql !== '1') {
      parts.push(compiled.sql);
      params.push(...compiled.params);
    }
  }
  return { sql: parts.length > 0 ? parts.join(' AND ') : '1', params };
}

function buildOrderBy(sort: SortSpec[] | undefined): string {
  const specs = sort && sort.length > 0 ? sort : [...DEFAULT_SORT];
  const clauses: string[] = [];
  let hasId = false;
  for (const s of specs) {
    const expr = sortExpression(s.key);
    if (!expr) throw new InvalidInputError(`Cannot sort by '${s.key}'`);
    if (expr === 'id') hasId = true;
    clauses.push(`${expr} ${s.dir === 'asc' ? 'ASC' : 'DESC'}`);
  }
  if (!hasId) clauses.push(`id ${specs[specs.length - 1]!.dir === 'asc' ? 'ASC' : 'DESC'}`);
  return clauses.join(', ');
}

export function queryEntries(db: Db, q: EntryQuery, nowMs = Date.now()): EntryPage {
  const limit = Math.min(Math.max(Math.trunc(q.paging.limit), 1), MAX_PAGE_SIZE);
  const offset = Math.max(Math.trunc(q.paging.offset), 0);
  const where = buildWhere(q, nowMs, true);
  const sql = `SELECT ${ROW_COLUMNS} FROM log_entries WHERE ${where.sql} ORDER BY ${buildOrderBy(q.sort)} LIMIT ? OFFSET ?`;
  const rows = prepared(db, sql).all(...where.params, limit, offset) as RawRow[];
  return { rows: rows.map(rowToEntry), limit, offset };
}

export function countEntriesFor(db: Db, q: EntryCountQuery, nowMs = Date.now()): EntryCount {
  const snap = buildWhere(q, nowMs, true);
  const total = (
    prepared(db, `SELECT COUNT(*) AS n FROM log_entries WHERE ${snap.sql}`).get(...snap.params) as {
      n: number;
    }
  ).n;
  const all = q.snapshotId === undefined ? snap : buildWhere(q, nowMs, false);
  const maxId = (
    prepared(db, `SELECT COALESCE(MAX(id), 0) AS m FROM log_entries WHERE ${all.sql}`).get(
      ...all.params,
    ) as { m: number }
  ).m;
  return { total, maxId };
}

export function getEntry(db: Db, id: number): EntryDetail {
  const row = prepared(db, `SELECT ${ROW_COLUMNS}, raw FROM log_entries WHERE id = ?`).get(id) as
    RawRow | undefined;
  if (!row) throw new NotFoundError(`Unknown entry ${id}`);
  return { ...rowToEntry(row), raw: row.raw ?? '' };
}

/** Distinct values for autocomplete; ordered by frequency. */
export function distinctValues(db: Db, q: ValuesQuery, nowMs = Date.now()): string[] {
  const limit = Math.min(Math.max(Math.trunc(q.limit ?? 50), 1), 500);
  const fixed = resolveFixedField(q.field);
  let expr: string;
  if (fixed) {
    if (fixed.kind === 'text') return [];
    expr = fixed.kind === 'date' ? TS_ISO_EXPR : `CAST(${fixed.column} AS TEXT)`;
  } else {
    if (!DYNAMIC_FIELD_RE.test(q.field))
      throw new QueryCompileError(`Invalid field name '${q.field}'`);
    const path = `$.${q.field
      .split('.')
      .map((s) => `"${s}"`)
      .join('.')}`;
    expr = `CASE json_type(props, '${path}') WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' WHEN 'object' THEN NULL WHEN 'array' THEN NULL ELSE CAST(json_extract(props, '${path}') AS TEXT) END`;
  }
  const scope = buildWhere(
    { ...(q.sessionIds ? { sessionIds: q.sessionIds } : {}), ...(q.time ? { time: q.time } : {}) },
    nowMs,
    false,
  );
  const params: unknown[] = [...scope.params];
  let prefix = '';
  if (q.prefix) {
    prefix = ` AND v LIKE ? ESCAPE '\\'`;
    params.push(`${q.prefix.replace(/[\\%_]/g, '\\$&')}%`);
  }
  const sql = `SELECT v FROM (SELECT ${expr} AS v, COUNT(*) AS n FROM log_entries WHERE ${scope.sql} GROUP BY v)
    WHERE v IS NOT NULL${prefix} ORDER BY n DESC, v LIMIT ?`;
  params.push(limit);
  return (prepared(db, sql).all(...params) as { v: string | number }[]).map((r) => String(r.v));
}

export function listPropInfos(db: Db, sessionIds?: number[]): PropInfo[] {
  return listProps(db, sessionIds);
}
