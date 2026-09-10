import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StreamBatchEvent, StreamStatusEvent } from '@shared/model/session';
import { startMockCf, type MockCf } from '../../../../test/fixtures/mock-cf';
import { ConnectionManager } from '../../cf/connection-manager';
import { LogPoller, type PollerOptions } from '../../cf/poller';
import { WorkspaceManager } from '../../db/workspace-manager';
import { ConnectionStore, type Encryptor } from '../../store/connections';
import { StreamManager } from '../stream-manager';

const MS = 1_000_000n;
const T = 1_757_500_000_000n * MS;

const encryptor: Encryptor = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from(p).toString('base64'),
  decrypt: (c) => Buffer.from(c, 'base64').toString('utf8'),
};

async function waitFor(pred: () => boolean, what = 'condition', timeoutMs = 4000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Shared manual sleep gate for all pollers created by the stream manager under test. */
class Gate {
  readonly requested: number[] = [];
  private waiters: (() => void)[] = [];
  readonly sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise<void>((resolve) => {
      this.requested.push(ms);
      if (signal.aborted) return resolve();
      const done = (): void => {
        signal.removeEventListener('abort', done);
        this.waiters = this.waiters.filter((w) => w !== done);
        resolve();
      };
      signal.addEventListener('abort', done);
      this.waiters.push(done);
    });
  get pending(): number {
    return this.waiters.length;
  }
  async release(): Promise<void> {
    await waitFor(() => this.waiters.length > 0, 'poller to sleep');
    this.waiters.shift()!();
  }
}

let cf: MockCf;
let dir: string;
let gate: Gate;
let batches: StreamBatchEvent[];
let statuses: StreamStatusEvent[];
let workspaces: WorkspaceManager;
let connections: ConnectionManager;
let streams: StreamManager;
let connectionId: string;

beforeAll(async () => {
  cf = await startMockCf();
});
afterAll(async () => {
  await cf.close();
});
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cfli-sm-'));
  gate = new Gate();
  batches = [];
  statuses = [];
  cf.state.logs = [];
  cf.state.failLogCache = [];
  cf.state.requests.length = 0;
  workspaces = new WorkspaceManager({
    dir: join(dir, 'ws'),
    registryPath: join(dir, 'workspaces.json'),
  });
  connections = new ConnectionManager({
    store: new ConnectionStore({ filePath: join(dir, 'connections.json'), encryptor }),
    onAuthChanged: (id, status) => streams.handleAuthChanged(id, status),
  });
  streams = new StreamManager({
    workspaces,
    connections,
    flushIntervalMs: 10,
    onBatch: (ev) => batches.push(ev),
    onStatus: (ev) => statuses.push(ev),
    pollerFactory: (opts: PollerOptions) =>
      new LogPoller({ ...opts, sleep: gate.sleep, nowNs: () => T }),
  });
  const profile = await connections.save({
    name: 'local',
    apiUrl: cf.apiUrl,
    authMode: 'password',
    skipSslValidation: false,
  });
  connectionId = profile.id;
  await (await connections.runtime(connectionId)).tokens.loginPassword('alice', 'secret');
  await workspaces.create('test');
});
afterEach(async () => {
  await streams.stopAll();
  await workspaces.close();
  await connections.disposeAll();
  rmSync(dir, { recursive: true, force: true });
});

const create = (appGuid = 'app-1', appName = 'api') =>
  streams.create({ connectionId, appGuid, appName, orgName: 'acme', spaceName: 'dev' });

const messages = (sessionId: number): string[] =>
  (
    workspaces
      .db()
      .prepare(`SELECT message FROM log_entries WHERE session_id = ? ORDER BY ts_ns, id`)
      .all(sessionId) as { message: string }[]
  ).map((r) => r.message);

describe('StreamManager', () => {
  it('creates sessions with defaults and validates the connection', () => {
    const s = create();
    expect(s).toMatchObject({
      name: 'api',
      appGuid: 'app-1',
      orgName: 'acme',
      spaceName: 'dev',
      status: 'stopped',
      entryCount: 0,
      pollIntervalMs: 1000,
    });
    expect(streams.list()).toHaveLength(1);
    expect(() => streams.create({ connectionId: 'nope', appGuid: 'a', appName: 'a' })).toThrow(
      /Unknown connection/,
    );
    expect(() =>
      streams.create({ connectionId, appGuid: 'a', appName: 'a', pollIntervalMs: 10 }),
    ).toThrow(/Poll interval/);
  });

  it('streams --recent backfill and live lines into the workspace', async () => {
    cf.addLogs('app-1', ['old1', 'old2', '{"msg":"json","level":"error"}'], T - 3n * MS);
    const s = create();
    const started = await streams.start(s.id, true);
    expect(started.status).toBe('running');
    expect(streams.runningIds()).toEqual([s.id]);
    await waitFor(() => batches.length === 1, 'backfill batch');
    expect(batches[0]).toMatchObject({ sessionId: s.id, inserted: 3, totalCount: 3 });
    expect(messages(s.id)).toEqual(['old1', 'old2', 'json']);
    expect(
      workspaces.db().prepare(`SELECT level FROM log_entries WHERE message = 'json'`).get(),
    ).toEqual({
      level: 'ERROR',
    });

    await gate.release();
    cf.addLogs('app-1', ['live1'], T + 5n * MS);
    await gate.release();
    await waitFor(() => batches.length === 2, 'live batch');
    expect(messages(s.id)).toEqual(['old1', 'old2', 'json', 'live1']);
    expect(streams.get(s.id)).toMatchObject({
      status: 'running',
      entryCount: 4,
      lastTsNs: (T + 5n * MS).toString(),
    });
    expect(statuses[0]).toMatchObject({ sessionId: s.id, status: 'running' });

    const stopped = await streams.stop(s.id);
    expect(stopped.status).toBe('stopped');
    expect(streams.runningIds()).toEqual([]);
    expect(
      workspaces.db().prepare(`SELECT status FROM log_sessions WHERE id = ?`).get(s.id),
    ).toEqual({
      status: 'stopped',
    });
  });

  it('resumes from last_ts_ns without re-reading history', async () => {
    cf.addLogs('app-1', ['a', 'b'], T);
    const s = create();
    await streams.start(s.id, true);
    await waitFor(() => batches.length === 1, 'first batch');
    await streams.stop(s.id);
    cf.state.requests.length = 0;

    cf.addLogs('app-1', ['c'], T + 10n * MS);
    await streams.start(s.id);
    await waitFor(() => batches.length === 2, 'resume batch');
    expect(messages(s.id)).toEqual(['a', 'b', 'c']);
    const firstRead = cf.requestsTo('/logcache/')[0]!;
    expect(firstRead.path).toContain('/read/app-1');
    expect(batches[1]).toMatchObject({ inserted: 1, totalCount: 3 });
  });

  it('start is idempotent and setInterval restarts a running session', async () => {
    const s = create();
    await streams.start(s.id);
    await streams.start(s.id);
    expect(streams.runningIds()).toEqual([s.id]);
    await waitFor(() => gate.pending === 1, 'sleep');
    expect(gate.requested).toEqual([1000]);
    const updated = await streams.setInterval(s.id, 5000);
    expect(updated).toMatchObject({ pollIntervalMs: 5000, status: 'running' });
    await waitFor(() => gate.requested.at(-1) === 5000, 'new interval');
    await expect(streams.setInterval(s.id, 1)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await streams.stop(s.id);
    expect((await streams.setInterval(s.id, 2000)).status).toBe('stopped');
  });

  it('clear() empties a session and delete() removes it with its rows', async () => {
    cf.addLogs('app-1', ['a', 'b'], T);
    const s = create();
    await streams.start(s.id, true);
    await waitFor(() => batches.length === 1, 'batch');
    const cleared = await streams.clear(s.id);
    expect(cleared).toMatchObject({ status: 'stopped', entryCount: 0 });
    expect(cleared.lastTsNs).toBeUndefined();
    expect(messages(s.id)).toEqual([]);
    await streams.start(s.id);
    await streams.delete(s.id);
    expect(streams.list()).toEqual([]);
    expect(streams.runningIds()).toEqual([]);
    expect(workspaces.db().prepare(`SELECT COUNT(*) AS n FROM log_entries`).get()).toEqual({
      n: 0,
    });
    await expect(streams.delete(s.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('switching workspaces stops all streams and flushes', async () => {
    cf.addLogs('app-1', ['a'], T);
    cf.addLogs('app-2', ['b'], T);
    const s1 = create('app-1', 'api');
    const s2 = create('app-2', 'worker');
    await streams.start(s1.id, true);
    await streams.start(s2.id, true);
    await waitFor(() => batches.length === 2, 'both batches');
    await workspaces.create('other');
    expect(streams.runningIds()).toEqual([]);
    expect(streams.list()).toEqual([]); // new workspace has no sessions
    await workspaces.openById(workspaces.list().find((w) => w.name === 'test')!.id);
    expect(streams.list().map((s) => [s.name, s.status, s.entryCount])).toEqual([
      ['api', 'stopped', 1],
      ['worker', 'stopped', 1],
    ]);
  });

  it('reports backoff and pauses/resumes around authentication', async () => {
    cf.addLogs('app-1', ['a'], T);
    cf.state.failLogCache.push({ status: 503 });
    const s = create();
    await streams.start(s.id, true);
    await waitFor(() => statuses.some((st) => st.status === 'backoff'), 'backoff status');
    expect(statuses.find((st) => st.status === 'backoff')).toMatchObject({
      sessionId: s.id,
      lastError: { code: 'SERVER_ERROR' },
      retryInMs: 1000,
    });
    expect(streams.get(s.id).status).toBe('backoff');
    await gate.release();
    await waitFor(() => batches.length === 1, 'recovery');
    expect(streams.get(s.id).status).toBe('running');

    // Lose the session: CC rejects tokens and UAA rejects the refresh.
    cf.state.validAccessTokens.clear();
    cf.state.validRefreshTokens.clear();
    await gate.release();
    await waitFor(() => streams.get(s.id).status === 'paused-auth', 'paused');
    expect(
      workspaces.db().prepare(`SELECT status FROM log_sessions WHERE id = ?`).get(s.id),
    ).toEqual({
      status: 'paused-auth',
    });

    // Logging in again resumes the poller through handleAuthChanged.
    cf.addLogs('app-1', ['after-login'], T + 3n * MS);
    const rt = await connections.runtime(connectionId);
    await rt.tokens.loginPassword('alice', 'secret');
    await waitFor(() => batches.length === 2, 'batch after re-login');
    expect(messages(s.id)).toEqual(['a', 'after-login']);
    expect(streams.get(s.id).status).toBe('running');
  });
});
