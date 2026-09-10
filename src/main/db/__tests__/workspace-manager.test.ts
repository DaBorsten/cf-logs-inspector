import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { WorkspaceInfo } from '@shared/model/workspace';
import { MIGRATIONS, migrate, SCHEMA_VERSION } from '../schema';
import { slugify, WorkspaceManager } from '../workspace-manager';

let dir: string;
let changes: (string | undefined)[];
let seq: number;
let clock: number;

function manager(): WorkspaceManager {
  return new WorkspaceManager({
    dir: join(dir, 'workspaces'),
    registryPath: join(dir, 'workspaces.json'),
    idFactory: () => `id-${++seq}`,
    now: () => clock,
    onChange: (ws?: WorkspaceInfo) => changes.push(ws?.id),
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cfli-ws-'));
  changes = [];
  seq = 0;
  clock = 1_000;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('schema', () => {
  it('migrates an empty database to the current version and is idempotent', () => {
    const db = new Database(':memory:');
    expect(migrate(db)).toBe(SCHEMA_VERSION);
    expect(migrate(db)).toBe(SCHEMA_VERSION);
    const tables = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as {
        name: string;
      }[]
    ).map((t) => t.name);
    expect(tables).toEqual([
      'column_layouts',
      'kv',
      'log_entries',
      'log_sessions',
      'saved_filters',
      'session_props',
    ]);
    expect(MIGRATIONS.length).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('refuses databases from a newer app version', () => {
    const db = new Database(':memory:');
    db.pragma(`user_version = ${SCHEMA_VERSION + 5}`);
    expect(() => migrate(db)).toThrow(/newer than this app supports/);
    db.close();
  });
});

describe('slugify', () => {
  it.each([
    ['My Workspace', 'my-workspace'],
    ['  Prod / EU10  ', 'prod-eu10'],
    ['Ünïcödé', 'unicode'],
    ['###', 'workspace'],
    ['a'.repeat(60), 'a'.repeat(40)],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('WorkspaceManager', () => {
  it('starts without a workspace and creates one on demand', async () => {
    const wm = manager();
    expect(wm.list()).toEqual([]);
    expect(wm.current()).toBeUndefined();
    expect(() => wm.db()).toThrow(/No workspace is open/);

    const ws = await wm.create('Prod EU10');
    expect(ws).toMatchObject({
      id: 'id-1',
      name: 'Prod EU10',
      exists: true,
      createdAt: 1000,
      lastOpenedAt: 1000,
    });
    expect(ws.path).toMatch(/prod-eu10-id-1\.sqlite$/);
    expect(existsSync(ws.path)).toBe(true);
    expect(wm.current()?.id).toBe('id-1');
    expect(changes).toEqual(['id-1']);
    expect(wm.db().pragma('journal_mode', { simple: true })).toBe('wal');
    expect(JSON.parse(readFileSync(join(dir, 'workspaces.json'), 'utf8'))).toMatchObject({
      version: 1,
      lastOpenId: 'id-1',
    });
    await wm.close();
  });

  it('rejects duplicate or blank names', async () => {
    const wm = manager();
    await wm.create('one');
    await expect(wm.create(' ONE ')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(wm.create('   ')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await wm.close();
  });

  it('switches workspaces, running close hooks first, and keeps data per file', async () => {
    const wm = manager();
    const hookCalls: string[] = [];
    wm.onBeforeClose(() => {
      hookCalls.push(wm.currentId() ?? 'none');
    });
    const a = await wm.create('a');
    wm.kvSet('k', 'from-a');
    clock = 2_000;
    const b = await wm.create('b');
    expect(hookCalls).toEqual(['id-1']);
    expect(wm.kvGet('k')).toBeNull();
    wm.kvSet('k', 'from-b');
    await wm.openById(a.id);
    expect(hookCalls).toEqual(['id-1', 'id-2']);
    expect(wm.kvGet('k')).toBe('from-a');
    await wm.openById(a.id); // no-op
    expect(hookCalls).toHaveLength(2);
    expect(changes).toEqual(['id-1', undefined, 'id-2', undefined, 'id-1']);
    expect(wm.list().map((w) => w.id)).toEqual([a.id, b.id]); // most recently opened first
    await wm.close();
  });

  it('reopens the last workspace on start and falls back to default', async () => {
    const wm = manager();
    await wm.create('first');
    clock = 2_000;
    await wm.create('second');
    await wm.close();

    const wm2 = manager();
    expect((await wm2.openLastOrDefault()).name).toBe('second');
    await wm2.close();

    // Registry pointing at a deleted file falls back to another existing one, then to a new default.
    const second = wm2.list().find((w) => w.name === 'second')!;
    rmSync(second.path);
    const wm3 = manager();
    expect((await wm3.openLastOrDefault()).name).toBe('first');
    await wm3.delete(wm3.list().find((w) => w.name === 'first')!.id);
    await wm3.delete(second.id);
    const created = await wm3.openLastOrDefault();
    expect(created.name).toBe('default');
    await wm3.close();
  });

  it('deletes the current workspace including WAL side files', async () => {
    const wm = manager();
    const ws = await wm.create('gone');
    wm.kvSet('x', '1'); // creates -wal
    await wm.delete(ws.id);
    expect(wm.current()).toBeUndefined();
    expect(existsSync(ws.path)).toBe(false);
    expect(existsSync(`${ws.path}-wal`)).toBe(false);
    expect(wm.list()).toEqual([]);
    await expect(wm.delete(ws.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('opens external files and lists missing files as exists=false', async () => {
    const wm = manager();
    const external = join(dir, 'ext.sqlite');
    const db = new Database(external);
    migrate(db);
    db.prepare(`INSERT INTO kv(key, value) VALUES ('hello', 'world')`).run();
    db.close();

    const ws = await wm.openFile(external);
    expect(ws).toMatchObject({ name: 'ext', path: external });
    expect(wm.kvGet('hello')).toBe('world');
    expect((await wm.openFile(external)).id).toBe(ws.id); // same registration
    await expect(wm.openFile('relative.sqlite')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(wm.openFile(join(dir, 'missing.sqlite'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    await wm.create('other');
    rmSync(external);
    expect(wm.list().find((w) => w.id === ws.id)).toMatchObject({ exists: false, sizeBytes: 0 });
    await expect(wm.openById(ws.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await wm.close();
  });

  it('reports stats and resets running sessions on open', async () => {
    const wm = manager();
    const ws = await wm.create('stats');
    const db = wm.db();
    db.prepare(
      `INSERT INTO log_sessions (id, name, connection_id, app_guid, app_name, created_at, status) VALUES (1, 's', 'c', 'g', 'a', 0, 'running')`,
    ).run();
    db.prepare(
      `INSERT INTO log_entries (session_id, ts_ns, app_guid, app_name, source_type, stream, message, raw, dedupe_key)
       VALUES (1, ?, 'g', 'a', 'APP', 'OUT', 'm', 'm', 'k1'), (1, ?, 'g', 'a', 'APP', 'OUT', 'm', 'm', 'k2')`,
    ).run(1757500000000000001n, 1757500000000000999n);
    expect(wm.stats()).toMatchObject({
      id: ws.id,
      sessions: 1,
      entries: 2,
      minTsNs: '1757500000000000001',
      maxTsNs: '1757500000000000999',
    });
    expect(wm.stats().sizeBytes).toBeGreaterThan(0);
    await wm.close();
    await wm.openById(ws.id);
    expect(wm.db().prepare(`SELECT status FROM log_sessions WHERE id = 1`).get()).toEqual({
      status: 'stopped',
    });
    await wm.close();
  });

  it('survives a corrupt registry file', async () => {
    writeFileSync(join(dir, 'workspaces.json'), '{oops');
    const wm = manager();
    expect(wm.list()).toEqual([]);
    expect(existsSync(join(dir, 'workspaces.json'))).toBe(false);
    await wm.close();
  });

  it('kv set/get/delete round trip', async () => {
    const wm = manager();
    await wm.create('kv');
    expect(wm.kvGet('missing')).toBeNull();
    wm.kvSet('a', '1');
    wm.kvSet('a', '2');
    expect(wm.kvGet('a')).toBe('2');
    wm.kvSet('a', null);
    expect(wm.kvGet('a')).toBeNull();
    await wm.close();
  });
});
