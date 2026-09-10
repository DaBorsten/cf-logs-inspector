/**
 * Equivalence suite: for a fixture of realistic entries, every query must select the same rows through
 * SQL (compiler) and through the in-memory evaluator (shared/dql). Plus paging/sort/time/snapshot tests.
 */
import Database from 'better-sqlite3';
import { compileMatcher, parseOrThrow } from '@shared/dql';
import { entryFieldKind, TEXT_FIELDS } from '@shared/model/fields';
import type { LogEnvelope } from '@shared/model/log';
import type { EntryDetail } from '@shared/model/query';
import { parseEnvelope } from '../../ingest/parser';
import {
  countEntriesFor,
  distinctValues,
  getEntry,
  listPropInfos,
  queryEntries,
} from '../entry-query';
import { insertEntries, upsertProps } from '../repos/entries';
import { createSession } from '../repos/sessions';
import { migrate } from '../schema';
import { collectProps } from '../../ingest/writer';

const MS = 1_000_000n;
const T0 = 1_767_225_600_000n * MS; // 2026-01-01T00:00:00Z
const NOW_MS = 1_767_312_000_000; // 2026-01-02T00:00:00Z

let db: Database.Database;
let all: EntryDetail[];

function env(i: number, payload: string, over: Partial<LogEnvelope> = {}): LogEnvelope {
  return {
    timestampNs: (T0 + BigInt(i) * 60n * 1000n * MS).toString(), // one per minute
    sourceId: over.sourceId ?? 'app-1',
    instanceId: String(i % 3),
    appName: 'api',
    sourceType: 'APP/PROC/WEB',
    stream: i % 7 === 0 ? 'ERR' : 'OUT',
    payload,
    tags: {},
    ...over,
  };
}

const levels = ['debug', 'info', 'warn', 'error', 'INFO', 30, 50];
const tenants = ['t1', 't2', 't3', 'T1'];
const regions = ['eu', 'us', 'eu-central'];
const tagSets = [['red'], ['red', 'blue'], ['Green'], [], ['x', 1, null]];

function fixture(): LogEnvelope[] {
  const out: LogEnvelope[] = [];
  for (let i = 0; i < 120; i++) {
    const kind = i % 6;
    if (kind === 0) {
      out.push(
        env(
          i,
          `2026-01-01 10:${String(i % 60).padStart(2, '0')} [${i % 2 ? 'ERROR' : 'INFO'}] plain line ${i} 100% done_${i}`,
        ),
      );
    } else if (kind === 1) {
      out.push(
        env(
          i,
          `api.example.com - [2026-01-01T10:00:00Z] "GET /health HTTP/1.1" ${i % 4 ? 200 : 500} 0 ${i}`,
          {
            sourceType: 'RTR',
            instanceId: 'router',
          },
        ),
      );
    } else {
      const obj: Record<string, unknown> = {
        level: levels[i % levels.length],
        msg:
          i % 4 === 0
            ? `cache miss for key ${i}`
            : i % 4 === 1
              ? 'Cache HIT'
              : `request handled in ${i}ms`,
        tenant: tenants[i % tenants.length],
        count: [0, 3, 3.5, 42, 100, -1, '7', '12abc'][i % 8],
        active: i % 2 === 0,
        tags: tagSets[i % tagSets.length],
        meta: {
          region: regions[i % regions.length],
          retries: i % 5,
          nested: { deep: i % 2 ? 'yes' : 'no' },
        },
        at: `2026-01-0${(i % 9) + 1}T00:00:00Z`,
        req_id: `r-${i}`,
      };
      if (i % 5 === 0) obj['user'] = null;
      if (i % 10 === 0) obj['a.b'] = 'flat';
      if (i % 10 === 5) obj['a'] = { b: 'nested' };
      if (i % 11 === 0) delete obj['tenant'];
      out.push(
        env(i, JSON.stringify(obj), i % 3 === 0 ? { sourceId: 'app-2', appName: 'worker' } : {}),
      );
    }
  }
  return out;
}

/** The evaluator's view of a stored entry: fixed fields (all aliases) override payload keys. */
function toRecord(e: EntryDetail): Record<string, unknown> {
  const iso = new Date(Number(BigInt(e.tsNs) / MS)).toISOString();
  return {
    ...(e.props ?? {}),
    id: e.id,
    session: e.sessionId,
    session_id: e.sessionId,
    timestamp: iso,
    ts: iso,
    '@timestamp': iso,
    time: iso,
    app: e.appName,
    app_name: e.appName,
    appName: e.appName,
    app_guid: e.appGuid,
    appGuid: e.appGuid,
    source_type: e.sourceType,
    sourceType: e.sourceType,
    source: e.sourceType,
    instance: e.instance,
    stream: e.stream,
    level: e.level,
    severity: e.level,
    message: e.message,
    msg: e.message,
    raw: e.raw,
  };
}

beforeAll(() => {
  db = new Database(':memory:');
  migrate(db);
  const s1 = createSession(db, { connectionId: 'c', appGuid: 'app-1', appName: 'api' }, 1).id;
  const s2 = createSession(db, { connectionId: 'c', appGuid: 'app-2', appName: 'worker' }, 2).id;
  db.transaction(() => {
    for (const e of fixture()) {
      const sid = e.sourceId === 'app-2' ? s2 : s1;
      const parsed = parseEnvelope(e, { appGuid: e.sourceId, appName: e.appName ?? 'x' });
      insertEntries(db, sid, [parsed]);
      upsertProps(db, sid, collectProps([parsed]));
    }
  })();
  const ids = (db.prepare('SELECT id FROM log_entries ORDER BY id').all() as { id: number }[]).map(
    (r) => r.id,
  );
  all = ids.map((id) => getEntry(db, id));
  expect(all).toHaveLength(120);
});
afterAll(() => db.close());

function sqlIds(dql: string): number[] {
  return queryEntries(db, {
    dql,
    paging: { limit: 1000, offset: 0 },
    sort: [{ key: 'id', dir: 'asc' }],
  }).rows.map((r) => r.id);
}
function evalIds(dql: string): number[] {
  const matcher = compileMatcher(parseOrThrow(dql), {
    textFields: [...TEXT_FIELDS],
    fieldKind: entryFieldKind,
  });
  return all.filter((e) => matcher(toRecord(e))).map((e) => e.id);
}

describe('SQL compiler agrees with the evaluator', () => {
  const queries: [string, 'some' | 'none' | 'any'][] = [
    // free text
    ['cache', 'some'],
    ['CACHE', 'some'],
    ['"cache miss"', 'some'],
    ['"GET /health"', 'some'],
    ['100%', 'some'],
    ['*done_1*', 'some'],
    ['done_1*', 'none'], // wildcard terms match the whole value; no message starts with done_1
    ['cache*', 'some'], // "Cache HIT" / "cache miss ..." start with cache
    ['*cache*', 'some'],
    ['nothing-like-this', 'none'],
    // fixed keyword / text fields
    ['level:error', 'some'],
    ['level:ERROR', 'some'],
    ['level:err*', 'some'],
    ['level:*', 'some'],
    ['not level:*', 'some'],
    ['severity:info', 'some'],
    ['stream:ERR', 'some'],
    ['stream:err', 'some'],
    ['app:api', 'some'],
    ['app:AP*', 'some'],
    ['app_name:worker', 'some'],
    ['source_type:RTR', 'some'],
    ['source:app*', 'some'],
    ['instance:1', 'some'],
    ['instance:01', 'none'],
    ['instance>0', 'some'],
    ['instance>=2', 'some'],
    ['instance<1', 'some'],
    ['instance:*', 'some'],
    ['message:"cache miss"', 'some'],
    ['msg:hit', 'some'],
    ['raw:tenant', 'some'],
    ['raw:"\\"tenant\\":\\"t1\\""', 'some'],
    ['session:1', 'some'],
    ['session:2', 'some'],
    ['id<10', 'some'],
    ['id>=100', 'some'],
    // timestamps
    ['ts>=2026-01-01T01:00:00Z', 'some'],
    ['timestamp<2026-01-01T00:10:00Z', 'some'],
    ['ts>=2026-01-01T01:00:00Z and ts<2026-01-01T01:05:00Z', 'some'],
    ['timestamp:2026-01-01T00:03:00.000Z', 'some'],
    ['ts:2026-01-01T00:0*', 'some'],
    // dynamic properties
    ['tenant:t1', 'some'],
    ['tenant:T1', 'some'],
    ['tenant:t*', 'some'],
    ['tenant:*', 'some'],
    ['not tenant:*', 'some'],
    ['count:3', 'some'],
    ['count:3.5', 'some'],
    ['count:7', 'some'],
    ['count>3', 'some'],
    ['count>=3.5', 'some'],
    ['count<1', 'some'],
    ['count<=0', 'some'],
    ['count>=12', 'some'], // "12abc" is text in both (JS Number() -> NaN)
    ['count<b', 'some'], // non-numeric literal: text comparison ("3" < "b", "12abc" < "b")
    ['count>b', 'none'],
    ['active:true', 'some'],
    ['active:false', 'some'],
    ['active:*', 'some'],
    ['tags:red', 'some'],
    ['tags:RED', 'some'],
    ['tags:re*', 'some'],
    ['tags:1', 'some'],
    ['tags:*', 'some'],
    ['user:*', 'none'],
    ['not user:*', 'some'],
    ['meta:*', 'some'],
    ['meta:eu', 'none'],
    ['meta.region:eu', 'some'],
    ['meta.region:eu*', 'some'],
    ['meta.retries>2', 'some'],
    ['meta.retries:0', 'some'],
    ['meta.nested.deep:yes', 'some'],
    ['a.b:flat', 'some'],
    ['a.b:nested', 'some'],
    ['a.b:*', 'some'],
    ['at>2026-01-05', 'some'],
    ['at>=2026-01-05T00:00:00Z', 'some'],
    ['at<2026-01-02', 'some'],
    ['req_id:r-1*', 'some'],
    ['missing.field:x', 'none'],
    ['missing.field:*', 'none'],
    // wildcard field names
    ['meta.*:eu', 'some'],
    ['meta.*:*', 'some'],
    ['*_id:r-5', 'some'],
    ['*.deep:no', 'some'],
    ['meta.*>3', 'some'],
    // boolean combinations
    ['level:error and tenant:t1', 'some'],
    ['level:error or count>50', 'some'],
    ['(level:error or level:warn) and not app:worker', 'some'],
    ['level:(error or warn)', 'some'],
    ['count:(>3 and <50)', 'some'],
    ['tenant:(t1 or t2) and not tags:red', 'some'],
    ['not (level:info or level:debug or level:warn)', 'some'],
    ['cache and tenant:t2', 'some'],
    ['cache or plain', 'some'],
  ];

  it.each(queries)('%s', (dql, expectation) => {
    const sql = sqlIds(dql);
    const evaluated = evalIds(dql);
    expect(sql).toEqual(evaluated);
    if (expectation === 'some') expect(sql.length).toBeGreaterThan(0);
    if (expectation === 'none') expect(sql).toEqual([]);
  });
});

describe('queryEntries', () => {
  it('pages in timestamp-desc order by default with id tiebreaker', () => {
    const page1 = queryEntries(db, { paging: { limit: 10, offset: 0 } });
    expect(page1.rows).toHaveLength(10);
    expect(page1.rows[0]!.id).toBe(120);
    const page2 = queryEntries(db, { paging: { limit: 10, offset: 10 } });
    expect(page2.rows[0]!.id).toBe(110);
    expect(page1.rows[0]!.tsNs > page1.rows[9]!.tsNs).toBe(true);
  });

  it('sorts by fixed and dynamic keys', () => {
    const byLevel = queryEntries(db, {
      dql: 'level:*',
      sort: [{ key: 'level', dir: 'asc' }],
      paging: { limit: 200, offset: 0 },
    });
    const lv = byLevel.rows.map((r) => r.level!);
    expect([...lv].sort()).toEqual(lv);
    const byCount = queryEntries(db, {
      dql: 'count:*',
      sort: [{ key: 'count', dir: 'desc' }],
      paging: { limit: 200, offset: 0 },
    });
    const values = byCount.rows.map((r) => r.props?.['count']);
    // SQLite orders text after numbers: '7' > '12abc' > 100 > 42 > ... > -1
    expect(values[0]).toBe('7');
    expect(values.lastIndexOf('7')).toBeLessThan(values.indexOf('12abc'));
    expect(values.lastIndexOf('12abc')).toBeLessThan(values.indexOf(100));
    expect(values.at(-1)).toBe(-1);
    expect(() =>
      queryEntries(db, {
        sort: [{ key: 'drop table', dir: 'asc' }],
        paging: { limit: 1, offset: 0 },
      }),
    ).toThrow(/Cannot sort/);
  });

  it('scopes by sessions and time', () => {
    const s2 = queryEntries(db, { sessionIds: [2], paging: { limit: 500, offset: 0 } });
    expect(s2.rows.every((r) => r.sessionId === 2 && r.appName === 'worker')).toBe(true);
    expect(queryEntries(db, { sessionIds: [], paging: { limit: 5, offset: 0 } }).rows).toEqual([]);
    const abs = queryEntries(db, {
      time: {
        kind: 'absolute',
        fromMs: Number(T0 / MS) + 10 * 60_000,
        toMs: Number(T0 / MS) + 12 * 60_000,
      },
      paging: { limit: 50, offset: 0 },
      sort: [{ key: 'id', dir: 'asc' }],
    });
    expect(abs.rows.map((r) => r.id)).toEqual([11, 12]);
    const rel = queryEntries(
      db,
      { time: { kind: 'relative', amount: 1, unit: 'h' }, paging: { limit: 500, offset: 0 } },
      NOW_MS,
    );
    expect(rel.rows).toHaveLength(0); // all entries are 22+ hours before "now"
    const relWide = queryEntries(
      db,
      { time: { kind: 'relative', amount: 1, unit: 'd' }, paging: { limit: 500, offset: 0 } },
      NOW_MS,
    );
    expect(relWide.rows).toHaveLength(120);
  });

  it('respects the snapshot id and reports new entries via count', () => {
    const snap = queryEntries(db, { snapshotId: 100, paging: { limit: 5, offset: 0 } });
    expect(snap.rows[0]!.id).toBe(100);
    expect(countEntriesFor(db, { snapshotId: 100 })).toEqual({ total: 100, maxId: 120 });
    expect(countEntriesFor(db, {})).toEqual({ total: 120, maxId: 120 });
    expect(countEntriesFor(db, { dql: 'level:error', sessionIds: [2] }).total).toBe(
      evalIds('level:error and session:2').length,
    );
    expect(countEntriesFor(db, { dql: 'nothing-here' })).toEqual({ total: 0, maxId: 0 });
  });

  it('rejects invalid DQL and clamps paging', () => {
    expect(() => queryEntries(db, { dql: 'level:', paging: { limit: 10, offset: 0 } })).toThrow(
      /Invalid query/,
    );
    const page = queryEntries(db, { paging: { limit: 5000, offset: -3 } });
    expect(page).toMatchObject({ limit: 1000, offset: 0 });
  });

  it('getEntry returns raw and parsed props', () => {
    const e = getEntry(db, 3);
    expect(e.raw.startsWith('{')).toBe(true);
    expect(e.props).toMatchObject({ tenant: expect.any(String) });
    expect(() => getEntry(db, 9999)).toThrow(/Unknown entry/);
  });
});

describe('distinctValues and props', () => {
  it('lists values of fixed fields by frequency with prefix filtering', () => {
    expect(distinctValues(db, { field: 'stream' })).toEqual(['OUT', 'ERR']);
    expect(distinctValues(db, { field: 'level', prefix: 'e' })).toEqual(['ERROR']);
    expect(distinctValues(db, { field: 'app', sessionIds: [2] })).toEqual(['worker']);
    expect(distinctValues(db, { field: 'message' })).toEqual([]);
    expect(distinctValues(db, { field: 'instance', limit: 2 })).toHaveLength(2);
    expect(distinctValues(db, { field: 'ts', prefix: '2026-01-01T00:0' })).toHaveLength(10);
  });

  it('lists values of dynamic properties including nested paths and booleans', () => {
    expect(distinctValues(db, { field: 'tenant' }).sort()).toEqual(['T1', 't1', 't2', 't3']);
    expect(distinctValues(db, { field: 'meta.region' })).toEqual(
      expect.arrayContaining(['eu', 'us', 'eu-central']),
    );
    expect(distinctValues(db, { field: 'active' }).sort()).toEqual(['false', 'true']);
    expect(distinctValues(db, { field: 'meta' })).toEqual([]); // objects are not values
    expect(distinctValues(db, { field: 'count', prefix: '3' }).sort()).toEqual(['3', '3.5']);
    expect(() => distinctValues(db, { field: 'bad name' })).toThrow(/Invalid field/);
  });

  it('lists discovered props with types and counts', () => {
    const props = Object.fromEntries(listPropInfos(db).map((p) => [p.key, p]));
    expect(props['tenant']).toMatchObject({ type: 'string' });
    expect(props['count']).toMatchObject({ type: 'mixed' });
    expect(props['meta']).toMatchObject({ type: 'object' });
    expect(props['tags']).toMatchObject({ type: 'array' });
    expect(listPropInfos(db, [2]).every((p) => p.count <= props[p.key]!.count)).toBe(true);
  });
});
