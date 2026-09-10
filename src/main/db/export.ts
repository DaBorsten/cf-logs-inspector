import { createWriteStream, unlinkSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { ExportColumn, ExportFormat, ExportScope } from '@shared/model/export';
import type { EntryDetail } from '@shared/model/query';
import { CancelledError } from '../cf/errors';
import { countEntriesFor, queryEntriesByIds, queryEntriesWithRaw } from './entry-query';

type Db = Database.Database;

const PAGE = 1000;
const P = 'p:';
const MS = 1_000_000n;

export interface ExportJobOptions {
  db: Db;
  path: string;
  format: ExportFormat;
  columns: ExportColumn[];
  scope: ExportScope;
  onProgress?: (written: number, total: number) => void;
  nowMs?: () => number;
}

export interface ExportResult {
  written: number;
  path: string;
}

/** ISO-8601 UTC with milliseconds from a nanosecond timestamp string. */
export function isoOf(tsNs: string): string {
  return new Date(Number(BigInt(tsNs) / MS)).toISOString();
}

/** Value of one export column for an entry; `undefined` when the column is unknown. */
export function columnValue(e: EntryDetail, column: string): unknown {
  switch (column) {
    case 'id':
      return e.id;
    case 'timestamp':
      return isoOf(e.tsNs);
    case 'ts_ns':
      return e.tsNs;
    case 'session':
      return e.sessionId;
    case 'app':
      return e.appName;
    case 'app_guid':
      return e.appGuid;
    case 'source_type':
      return e.sourceType;
    case 'instance':
      return e.instance;
    case 'stream':
      return e.stream;
    case 'level':
      return e.level;
    case 'message':
      return e.message;
    case 'raw':
      return e.raw;
    default:
      return column.startsWith(P) ? e.props?.[column.slice(P.length)] : undefined;
  }
}

/** JSON export object: fixed columns at the top level, `p:` columns under `props`. */
export function toRecord(e: EntryDetail, columns: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let props: Record<string, unknown> | undefined;
  for (const c of columns) {
    const v = columnValue(e, c);
    if (c.startsWith(P)) {
      if (v !== undefined) (props ??= {})[c.slice(P.length)] = v;
    } else if (v !== undefined) {
      out[c] = v;
    }
  }
  if (props) out['props'] = props;
  return out;
}

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvHeader(columns: readonly string[]): string {
  return columns.map((c) => csvEscape(c.startsWith(P) ? c.slice(P.length) : c)).join(',');
}

export function csvLine(e: EntryDetail, columns: readonly string[]): string {
  return columns.map((c) => csvEscape(columnValue(e, c))).join(',');
}

/**
 * Streams a query result to a file. Pages are read with a fixed snapshot so rows arriving during the
 * export do not shift the offsets; `cancel()` aborts between pages and removes the partial file.
 */
export class ExportJob {
  private cancelled = false;
  private readonly opts: ExportJobOptions;

  constructor(opts: ExportJobOptions) {
    this.opts = opts;
  }

  cancel(): void {
    this.cancelled = true;
  }

  async run(): Promise<ExportResult> {
    const { db, path, format, columns, scope } = this.opts;
    const nowMs = this.opts.nowMs?.() ?? Date.now();
    const stream = createWriteStream(path, { encoding: 'utf8' });
    // One persistent error listener: errors surface through the pending write/finish promise (or
    // the next one) instead of crashing the process when nobody is waiting on the stream.
    let streamError: Error | undefined;
    let wake: (() => void) | undefined;
    stream.on('error', (err) => {
      streamError ??= err;
      wake?.();
    });
    const failed = (): Error | undefined => streamError;
    const write = (chunk: string): Promise<void> =>
      new Promise((resolve, reject) => {
        if (failed()) return reject(failed());
        if (stream.write(chunk)) return resolve();
        wake = () => (failed() ? reject(failed()) : resolve());
        stream.once('drain', wake);
      });
    const finish = (): Promise<void> =>
      new Promise((resolve, reject) => {
        if (failed()) return reject(failed());
        wake = () => (failed() ? reject(failed()) : resolve());
        stream.end(wake);
      });
    const discard = (): Promise<void> =>
      new Promise((resolve) => {
        if (stream.closed) return resolve();
        stream.once('close', () => resolve());
        stream.destroy();
      });

    let written = 0;
    try {
      const total = scope.ids
        ? scope.ids.length
        : countEntriesFor(db, scopeCount(scope), nowMs).total;
      if (format === 'csv') await write(`${csvHeader(columns)}\n`);
      if (format === 'json') await write('[\n');

      const pages = scope.ids ? idPages(db, scope.ids, PAGE) : queryPages(db, scope, nowMs, PAGE);
      for (const page of pages) {
        if (this.cancelled) throw new CancelledError('Export cancelled');
        let chunk = '';
        for (const e of page) {
          if (format === 'csv') chunk += `${csvLine(e, columns)}\n`;
          else if (format === 'ndjson') chunk += `${JSON.stringify(toRecord(e, columns))}\n`;
          else chunk += `${written > 0 ? ',\n' : ''}${JSON.stringify(toRecord(e, columns))}`;
          written++;
        }
        if (chunk) await write(chunk);
        this.opts.onProgress?.(written, total);
      }
      if (format === 'json') await write('\n]\n');
      await finish();
      return { written, path };
    } catch (err) {
      await discard();
      try {
        unlinkSync(path);
      } catch {
        /* nothing to remove */
      }
      throw err;
    }
  }
}

function scopeCount(scope: ExportScope) {
  const q: Parameters<typeof countEntriesFor>[1] = {};
  if (scope.sessionIds) q.sessionIds = scope.sessionIds;
  if (scope.dql) q.dql = scope.dql;
  if (scope.time) q.time = scope.time;
  if (scope.snapshotId !== undefined) q.snapshotId = scope.snapshotId;
  return q;
}

/** Pages over the filtered result; the snapshot is pinned at the first page's maxId. */
function* queryPages(
  db: Db,
  scope: ExportScope,
  nowMs: number,
  size: number,
): Generator<EntryDetail[]> {
  const base = scopeCount(scope);
  const snapshotId = scope.snapshotId ?? countEntriesFor(db, base, nowMs).maxId;
  for (let offset = 0; ; offset += size) {
    const rows = queryEntriesWithRaw(
      db,
      {
        ...base,
        snapshotId,
        ...(scope.sort ? { sort: scope.sort } : {}),
        paging: { limit: size, offset },
      },
      nowMs,
    );
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < size) return;
  }
}

function* idPages(db: Db, ids: number[], size: number): Generator<EntryDetail[]> {
  for (let i = 0; i < ids.length; i += size) {
    const rows = queryEntriesByIds(db, ids.slice(i, i + size));
    if (rows.length > 0) yield rows;
  }
}
