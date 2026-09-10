import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { LogEnvelope } from '@shared/model/log';
import { parseEnvelope } from '../../ingest/parser';
import { Writer } from '../../ingest/writer';
import { csvEscape, csvLine, ExportJob, toRecord } from '../export';
import { ExportManager } from '../export-manager';
import { insertEntries } from '../repos/entries';
import { createSession, sessionRange } from '../repos/sessions';
import { migrate } from '../schema';
import { readRetention, RETENTION_KV_KEY } from '../settings';

const T0 = 1_767_225_600_000_000_000n;
let db: Database.Database;
let dir: string;
let s1: number;

function env(i: number, payload: string, sessionOffset = 0): LogEnvelope {
  return {
    timestampNs: (T0 + BigInt(i) * 1_000_000_000n).toString(),
    sourceId: sessionOffset ? 'app-2' : 'app-1',
    instanceId: '0',
    appName: sessionOffset ? 'worker' : 'api',
    sourceType: 'APP/PROC/WEB',
    stream: 'OUT',
    payload,
    tags: {},
  };
}

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  dir = mkdtempSync(join(tmpdir(), 'cfli-export-'));
  s1 = createSession(db, { connectionId: 'c', appGuid: 'app-1', appName: 'api' }, 1).id;
  const s2 = createSession(db, { connectionId: 'c', appGuid: 'app-2', appName: 'worker' }, 2).id;
  db.transaction(() => {
    insertEntries(
      db,
      s1,
      [
        env(0, '{"level":"info","msg":"hello, \\"world\\"","tenant":"t1","meta":{"a":1}}'),
        env(1, 'plain line\nwith newline'),
        env(2, '{"level":"error","msg":"boom","tenant":"t2","tags":["x","y"]}'),
      ].map((e) => parseEnvelope(e, { appGuid: 'app-1', appName: 'api' })),
    );
    insertEntries(
      db,
      s2,
      [env(3, 'other app', 1)].map((e) =>
        parseEnvelope(e, { appGuid: 'app-2', appName: 'worker' }),
      ),
    );
  })();
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('csv helpers', () => {
  it.each([
    ['plain', 'plain'],
    ['has,comma', '"has,comma"'],
    ['has "quote"', '"has ""quote"""'],
    ['multi\nline', '"multi\nline"'],
    [null, ''],
    [undefined, ''],
    [3, '3'],
    [{ a: 1 }, '"{""a"":1}"'],
  ])('escapes %j', (input, expected) => {
    expect(csvEscape(input)).toBe(expected);
  });
});

describe('ExportJob', () => {
  it('writes NDJSON with selected columns and props', async () => {
    const path = join(dir, 'out.ndjson');
    const progress: [number, number][] = [];
    const job = new ExportJob({
      db,
      path,
      format: 'ndjson',
      columns: ['id', 'timestamp', 'level', 'message', 'p:tenant', 'p:meta'],
      scope: { sessionIds: [s1], sort: [{ key: 'timestamp', dir: 'asc' }] },
      onProgress: (w, t) => progress.push([w, t]),
    });
    const result = await job.run();
    expect(result.written).toBe(3);
    const lines = readFileSync(path, 'utf8')
      .trimEnd()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({
      id: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'INFO',
      message: 'hello, "world"',
      props: { tenant: 't1', meta: { a: 1 } },
    });
    expect(lines[1]).toEqual({
      id: 2,
      timestamp: '2026-01-01T00:00:01.000Z',
      level: null,
      message: 'plain line\nwith newline',
    });
    expect(progress.at(-1)).toEqual([3, 3]);
  });

  it('writes a valid JSON array honouring the DQL scope', async () => {
    const path = join(dir, 'out.json');
    await new ExportJob({
      db,
      path,
      format: 'json',
      columns: ['id', 'app', 'raw'],
      scope: { dql: 'level:error or app:worker' },
    }).run();
    const arr = JSON.parse(readFileSync(path, 'utf8')) as {
      id: number;
      app: string;
      raw: string;
    }[];
    expect(arr.map((r) => [r.id, r.app])).toEqual([
      [4, 'worker'],
      [3, 'api'],
    ]);
    expect(arr[1]!.raw).toContain('"boom"');
  });

  it('writes CSV with a header, quoting and JSON text for nested values', async () => {
    const path = join(dir, 'out.csv');
    await new ExportJob({
      db,
      path,
      format: 'csv',
      columns: ['id', 'level', 'message', 'p:tenant', 'p:tags'],
      scope: { sessionIds: [s1], sort: [{ key: 'id', dir: 'asc' }] },
    }).run();
    const text = readFileSync(path, 'utf8');
    expect(text.split('\n')[0]).toBe('id,level,message,tenant,tags');
    expect(text).toContain('1,INFO,"hello, ""world""",t1,');
    expect(text).toContain('2,,"plain line\nwith newline",,');
    expect(text).toContain('3,ERROR,boom,t2,"[""x"",""y""]"');
  });

  it('exports explicit ids newest first and ignores unknown ids', async () => {
    const path = join(dir, 'ids.ndjson');
    const result = await new ExportJob({
      db,
      path,
      format: 'ndjson',
      columns: ['id'],
      scope: { ids: [1, 3, 999] },
    }).run();
    expect(result.written).toBe(2);
    expect(readFileSync(path, 'utf8').trim().split('\n')).toEqual(['{"id":3}', '{"id":1}']);
  });

  it('removes the partial file when cancelled', async () => {
    const path = join(dir, 'cancel.ndjson');
    const job = new ExportJob({ db, path, format: 'ndjson', columns: ['id'], scope: {} });
    job.cancel();
    await expect(job.run()).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(existsSync(path)).toBe(false);
  });

  it('exports empty scopes as empty files', async () => {
    const path = join(dir, 'empty.json');
    await new ExportJob({
      db,
      path,
      format: 'json',
      columns: ['id'],
      scope: { dql: 'level:fatal' },
    }).run();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual([]);
  });

  it('toRecord and csvLine treat unknown columns as absent', () => {
    const e = {
      id: 1,
      sessionId: 1,
      tsNs: T0.toString(),
      appGuid: 'g',
      appName: 'api',
      sourceType: 'APP',
      instance: null,
      stream: 'OUT' as const,
      level: null,
      message: 'm',
      isJson: false,
      props: null,
      raw: 'm',
    };
    expect(toRecord(e, ['id', 'nope', 'p:missing', 'instance'])).toEqual({ id: 1, instance: null });
    expect(csvLine(e, ['id', 'nope', 'instance'])).toBe('1,,');
  });
});

describe('ExportManager', () => {
  it('reports progress and completion, and cancels running jobs', async () => {
    const events: string[] = [];
    const mgr = new ExportManager({
      onProgress: (ev) => events.push(`progress:${ev.written}/${ev.total}`),
      onDone: (ev) => events.push(`done:${ev.written}`),
      onFailed: (ev) => events.push(`failed:${ev.cancelled}`),
    });
    const path = join(dir, 'mgr.ndjson');
    const jobId = mgr.start(db, { format: 'ndjson', columns: ['id'], scope: {} }, path);
    expect(mgr.running).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(events).toEqual(['progress:4/4', 'done:4']);
    expect(mgr.cancel(jobId)).toBe(false); // already finished
    expect(existsSync(path)).toBe(true);
  });
});

describe('sessionRange and retention settings', () => {
  it('returns the stored span of a session', () => {
    expect(sessionRange(db, s1)).toEqual({
      minTsNs: T0.toString(),
      maxTsNs: (T0 + 2_000_000_000n).toString(),
      count: 3,
    });
    const empty = createSession(db, { connectionId: 'c', appGuid: 'x', appName: 'x' }, 3).id;
    expect(sessionRange(db, empty)).toBeNull();
    expect(() => sessionRange(db, 999)).toThrow(/Unknown session/);
  });

  it('reads retention from kv with defaults and validation', () => {
    expect(readRetention(db)).toEqual({ maxRowsPerSession: 500_000, maxRowsWorkspace: 2_000_000 });
    db.prepare(`INSERT INTO kv(key, value) VALUES (?, ?)`).run(
      RETENTION_KV_KEY,
      JSON.stringify({ maxRowsPerSession: 5000 }),
    );
    expect(readRetention(db)).toEqual({ maxRowsPerSession: 5000, maxRowsWorkspace: 2_000_000 });
    db.prepare(`UPDATE kv SET value = ? WHERE key = ?`).run(
      '{"maxRowsPerSession": 1}',
      RETENTION_KV_KEY,
    );
    expect(readRetention(db)).toEqual({ maxRowsPerSession: 500_000, maxRowsWorkspace: 2_000_000 });
    db.prepare(`UPDATE kv SET value = ? WHERE key = ?`).run('not json', RETENTION_KV_KEY);
    expect(readRetention(db)).toEqual({ maxRowsPerSession: 500_000, maxRowsWorkspace: 2_000_000 });
  });

  it('the writer re-reads a retention getter on every flush', async () => {
    let limit = 1000;
    const writer = new Writer({
      db,
      retention: () => ({ maxRowsPerSession: limit, maxRowsWorkspace: 1000 }),
      flushIntervalMs: 5,
    });
    const s = createSession(db, { connectionId: 'c', appGuid: 'r', appName: 'r' }, 4).id;
    const mk = (i: number) =>
      parseEnvelope(env(100 + i, `row ${i}`), { appGuid: 'r', appName: 'r' });
    await writer.enqueue(s, [mk(1), mk(2), mk(3)]);
    expect(sessionRange(db, s)?.count).toBe(3);
    limit = 2;
    await writer.enqueue(s, [mk(4)]);
    expect(sessionRange(db, s)?.count).toBe(2);
    writer.close();
  });
});
