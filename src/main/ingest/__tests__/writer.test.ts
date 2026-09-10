import Database from 'better-sqlite3';
import type { ParsedEntry } from '@shared/model/log-entry';
import type { StreamBatchEvent } from '@shared/model/session';
import { countEntries, listProps } from '../../db/repos/entries';
import { createSession, getSession } from '../../db/repos/sessions';
import { migrate } from '../../db/schema';
import { parseEnvelope } from '../parser';
import { collectProps, Writer } from '../writer';

const T = 1_757_500_000_000_000_000n;

let db: Database.Database;
let events: StreamBatchEvent[];
let s1: number;
let s2: number;

function entry(i: number, payload = `line ${i}`, over: Partial<ParsedEntry> = {}): ParsedEntry {
  return {
    ...parseEnvelope(
      {
        timestampNs: (T + BigInt(i) * 1_000_000n).toString(),
        sourceId: 'app-1',
        instanceId: '0',
        stream: 'OUT',
        payload,
        tags: {},
      },
      { appGuid: 'app-1', appName: 'api' },
    ),
    ...over,
  };
}
const entries = (from: number, n: number): ParsedEntry[] =>
  Array.from({ length: n }, (_, i) => entry(from + i));

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  events = [];
  s1 = createSession(db, { connectionId: 'c', appGuid: 'app-1', appName: 'api' }, 1).id;
  s2 = createSession(db, { connectionId: 'c', appGuid: 'app-2', appName: 'worker' }, 2).id;
});
afterEach(() => {
  db.close();
});

const writer = (over: Partial<ConstructorParameters<typeof Writer>[0]> = {}): Writer =>
  new Writer({ db, onBatch: (ev) => events.push(ev), flushIntervalMs: 20, maxBatch: 5, ...over });

describe('Writer', () => {
  it('flushes on the timer and resolves enqueue after commit', async () => {
    const w = writer();
    const p = w.enqueue(s1, entries(0, 2));
    expect(countEntries(db)).toBe(0);
    expect(w.pending).toBe(2);
    await p;
    expect(countEntries(db, s1)).toBe(2);
    expect(events).toEqual([{ sessionId: s1, inserted: 2, totalCount: 2, latestId: 2 }]);
    expect(getSession(db, s1)).toMatchObject({
      entryCount: 2,
      lastTsNs: (T + 1_000_000n).toString(),
    });
    w.close();
  });

  it('flushes immediately when maxBatch is reached and groups sessions', async () => {
    const w = writer();
    const a = w.enqueue(s1, entries(0, 3));
    const b = w.enqueue(s2, entries(0, 2)); // reaches 5
    await Promise.all([a, b]);
    expect(events.map((e) => [e.sessionId, e.inserted, e.totalCount, e.latestId])).toEqual([
      [s1, 3, 3, 5],
      [s2, 2, 2, 5],
    ]);
    expect(w.inserted).toBe(5);
    w.close();
  });

  it('ignores duplicates by dedupe key and still reports the session total', async () => {
    const w = writer();
    await w.enqueue(s1, entries(0, 3));
    await w.enqueue(s1, [...entries(1, 3), entry(1, 'line 1', { appName: 'renamed' })]);
    expect(countEntries(db, s1)).toBe(4); // 0,1,2 + 3
    expect(events.at(-1)).toMatchObject({ sessionId: s1, inserted: 1, totalCount: 4 });
    await w.enqueue(s1, entries(0, 2));
    expect(events.at(-1)).toMatchObject({ inserted: 0, totalCount: 4 });
    w.close();
  });

  it('stores BigInt timestamps exactly and keeps last_ts_ns monotonic', async () => {
    const w = writer();
    await w.enqueue(s1, [entry(5), entry(2)]);
    const rows = db
      .prepare(`SELECT CAST(ts_ns AS TEXT) AS ts FROM log_entries ORDER BY ts_ns`)
      .all() as {
      ts: string;
    }[];
    expect(rows.map((r) => r.ts)).toEqual([
      (T + 2_000_000n).toString(),
      (T + 5_000_000n).toString(),
    ]);
    expect(getSession(db, s1).lastTsNs).toBe((T + 5_000_000n).toString());
    await w.enqueue(s1, [entry(3)]);
    expect(getSession(db, s1).lastTsNs).toBe((T + 5_000_000n).toString());
    w.close();
  });

  it('aggregates top-level JSON keys into session_props', async () => {
    const w = writer();
    await w.enqueue(s1, [
      entry(0, '{"level":"info","msg":"a","tenant":"t1","meta":{"x":1}}'),
      entry(1, '{"level":"warn","msg":"b","tenant":"t2","count":3}'),
      entry(2, '{"level":40,"msg":"c","count":null}'),
      entry(3, 'plain text'),
    ]);
    const props = Object.fromEntries(listProps(db, [s1]).map((p) => [p.key, p]));
    expect(props['level']).toMatchObject({ type: 'mixed', count: 3, sample: 'info' });
    expect(props['msg']).toMatchObject({ type: 'string', count: 3 });
    expect(props['tenant']).toMatchObject({ type: 'string', count: 2, sample: 't1' });
    expect(props['meta']).toMatchObject({ type: 'object', count: 1, sample: '{"x":1}' });
    expect(props['count']).toMatchObject({ type: 'mixed', count: 2 });
    await w.enqueue(s1, [entry(4, '{"tenant":"t3"}')]);
    expect(listProps(db, [s1]).find((p) => p.key === 'tenant')).toMatchObject({ count: 3 });
    expect(listProps(db, [s2])).toEqual([]);
    w.close();
  });

  it('applies per-session retention by dropping the oldest rows', async () => {
    const w = writer({ retention: { maxRowsPerSession: 4, maxRowsWorkspace: 1000 } });
    await w.enqueue(s1, entries(0, 3));
    await w.enqueue(s1, entries(3, 3));
    expect(countEntries(db, s1)).toBe(4);
    const remaining = db
      .prepare(`SELECT message FROM log_entries WHERE session_id = ? ORDER BY ts_ns`)
      .all(s1) as {
      message: string;
    }[];
    expect(remaining.map((r) => r.message)).toEqual(['line 2', 'line 3', 'line 4', 'line 5']);
    expect(events.at(-1)).toMatchObject({ inserted: 3, totalCount: 4 });
    expect(getSession(db, s1).entryCount).toBe(4);
    w.close();
  });

  it('applies workspace-wide retention across sessions and recounts', async () => {
    const w = writer({ retention: { maxRowsPerSession: 1000, maxRowsWorkspace: 5 } });
    await w.enqueue(s1, entries(0, 3)); // ts 0..2
    await w.enqueue(s2, entries(10, 4)); // ts 10..13 -> total 7 -> prune 2 oldest (s1: 0,1)
    expect(countEntries(db)).toBe(5);
    expect(countEntries(db, s1)).toBe(1);
    expect(countEntries(db, s2)).toBe(4);
    expect(getSession(db, s1).entryCount).toBe(1);
    expect(events.at(-1)).toMatchObject({ sessionId: s2, inserted: 4, totalCount: 4 });
    w.close();
  });

  it('rejects enqueued promises when the flush fails and stays usable', async () => {
    const w = writer();
    // INSERT OR IGNORE swallows constraint conflicts, but foreign key violations still abort the flush.
    await expect(w.enqueue(999, [entry(0)])).rejects.toThrow(/FOREIGN KEY/);
    expect(countEntries(db)).toBe(0);
    await w.enqueue(s1, entries(1, 1));
    expect(countEntries(db)).toBe(1);
    w.close();
    await expect(w.enqueue(s1, entries(2, 1))).rejects.toThrow(/closed/);
  });

  it('close() flushes pending entries', async () => {
    const w = writer({ flushIntervalMs: 10_000 });
    const p = w.enqueue(s1, entries(0, 2));
    w.close();
    await p;
    expect(countEntries(db)).toBe(2);
  });

  it('collectProps handles empty and non-JSON batches', () => {
    expect(collectProps([])).toEqual([]);
    expect(collectProps([entry(0, 'text')])).toEqual([]);
    expect(collectProps([entry(0, '{"a":"x".repeat(1)}')])).toEqual([]); // invalid JSON -> text
    const long = 'y'.repeat(300);
    expect(collectProps([entry(0, `{"a":"${long}"}`)])[0]?.sample).toHaveLength(201);
  });
});
