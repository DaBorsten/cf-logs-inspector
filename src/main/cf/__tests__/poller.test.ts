import type { LogEnvelope } from '@shared/model/log';
import { startMockCf, type MockCf } from '../../../../test/fixtures/mock-cf';
import { HttpClient } from '../http';
import { LogCacheClient } from '../log-cache';
import { LogPoller, type PollerOptions, type PollerStatus } from '../poller';
import { MemoryTokenStore, TokenManager, UaaClient } from '../uaa';

const MS = 1_000_000n;
const T = 1_757_500_000_000n * MS;
const SRC = 'app-1';

async function waitFor(pred: () => boolean, what = 'condition', timeoutMs = 4000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Manual sleep gate: the poller blocks on every sleep until the test releases it. */
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
  /** Waits until the poller is sleeping, then lets it continue. */
  async release(): Promise<void> {
    await waitFor(() => this.waiters.length > 0, 'poller to sleep');
    this.waiters.shift()!();
  }
}

let cf: MockCf;
let http: HttpClient;
let tokens: TokenManager;
let logCache: LogCacheClient;
let gate: Gate;
let batches: LogEnvelope[][];
let statuses: PollerStatus[];
let required: string[];
let pollers: LogPoller[];

const msgs = (b: LogEnvelope[]): string[] => b.map((e) => e.payload);
const all = (): string[] => batches.flatMap(msgs);

function poller(over: Partial<PollerOptions> = {}): LogPoller {
  const p = new LogPoller({
    logCache,
    sourceId: SRC,
    sleep: gate.sleep,
    nowNs: () => T,
    onBatch: (b) => {
      batches.push(b);
    },
    onStatus: (s) => statuses.push(s),
    ...over,
  });
  pollers.push(p);
  void p.start();
  return p;
}

beforeAll(async () => {
  cf = await startMockCf();
  http = new HttpClient();
});
afterAll(async () => {
  await http.close();
  await cf.close();
});
beforeEach(async () => {
  cf.state.logs = [];
  cf.state.requests.length = 0;
  cf.state.failLogCache = [];
  cf.state.scrambleLogCache = false;
  cf.state.logCacheLimitCap = 1000;
  gate = new Gate();
  batches = [];
  statuses = [];
  required = [];
  pollers = [];
  tokens = new TokenManager({
    uaa: new UaaClient({ http, loginUrl: cf.loginUrl }),
    store: new MemoryTokenStore(),
    onAuthRequired: (r) => required.push(r),
  });
  await tokens.loginPassword('alice', 'secret');
  logCache = new LogCacheClient({ http, baseUrl: `${cf.baseUrl}/logcache`, tokens });
  cf.state.requests.length = 0;
});
afterEach(async () => {
  await Promise.all(pollers.map((p) => p.stop()));
});

const reads = (): number => cf.requestsTo('/logcache/').length;

describe('LogPoller', () => {
  it('--recent delivers the newest page oldest-first, then tails from after it', async () => {
    cf.addLogs(
      SRC,
      Array.from({ length: 1200 }, (_, i) => `m${i}`),
      T - 1200n * MS,
    );
    const p = poller({ recent: true });
    await waitFor(() => batches.length === 1, 'backfill batch');
    expect(batches[0]).toHaveLength(1000);
    expect(msgs(batches[0]!)[0]).toBe('m200');
    expect(msgs(batches[0]!).at(-1)).toBe('m1199');
    await gate.release(); // idle poll finds nothing new
    await waitFor(() => gate.pending === 1, 'second sleep');
    expect(batches).toHaveLength(1);
    expect(p.status).toMatchObject({
      state: 'polling',
      total: 1000,
      cursorNs: (T - 1n * MS + 1n).toString(),
    });

    cf.addLogs(SRC, ['new1', 'new2'], T);
    await gate.release();
    await waitFor(() => batches.length === 2, 'tail batch');
    expect(msgs(batches[1]!)).toEqual(['new1', 'new2']);
    expect(gate.requested.every((ms) => ms === 1000)).toBe(true);
    expect(statuses.map((s) => s.state)).toContain('backfilling');
  });

  it('re-reads immediately after a full page and sleeps only when caught up', async () => {
    cf.state.logCacheLimitCap = 100;
    cf.addLogs(
      SRC,
      Array.from({ length: 250 }, (_, i) => `m${i}`),
      T,
    );
    poller({ fromNs: T.toString(), pageLimit: 100 });
    await waitFor(() => gate.pending === 1, 'first sleep');
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(all()).toEqual(Array.from({ length: 250 }, (_, i) => `m${i}`));
    expect(gate.requested).toEqual([1000]);
    expect(reads()).toBe(3);
  });

  it('uses an overlap window after idle polls and drops duplicates', async () => {
    cf.addLogs(SRC, ['a', 'b', 'c'], T, 1n * MS);
    poller({ fromNs: T.toString(), overlapMs: 2000 });
    await waitFor(() => gate.pending === 1, 'first sleep');
    expect(all()).toEqual(['a', 'b', 'c']);
    // Late arrival inside the overlap window plus a genuinely new line.
    cf.state.logs.push({
      sourceId: SRC,
      timestampNs: (T + 1n * MS + 500n).toString(),
      message: 'late',
    });
    cf.addLogs(SRC, ['d'], T + 10n * MS);
    await gate.release();
    await waitFor(() => batches.length === 2, 'second batch');
    expect(msgs(batches[1]!)).toEqual(['late', 'd']);
    const last = cf.requestsTo('/logcache/').at(-1)!;
    // Read started 2 s before the cursor (cursor = ts(c) + 1).
    expect(last.path).toContain('/read/app-1');
    await gate.release();
    await waitFor(() => gate.pending === 1 && reads() === 3, 'third read');
    expect(all()).toEqual(['a', 'b', 'c', 'late', 'd']); // nothing re-delivered
  });

  it('sorts scrambled pages before delivering', async () => {
    cf.state.scrambleLogCache = true;
    cf.addLogs(SRC, ['1', '2', '3', '4', '5', '6'], T);
    poller({ fromNs: T.toString() });
    await waitFor(() => batches.length === 1, 'batch');
    expect(msgs(batches[0]!)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('resumes from fromNs and ignores older history', async () => {
    cf.addLogs(SRC, ['old1', 'old2'], T - 60n * 1000n * MS);
    cf.addLogs(SRC, ['now1'], T);
    poller({ fromNs: T.toString() });
    await waitFor(() => gate.pending === 1, 'sleep');
    expect(all()).toEqual(['now1']);
  });

  it('starts at "now" when neither recent nor fromNs is given', async () => {
    cf.addLogs(SRC, ['old'], T - 5n * MS);
    poller();
    await waitFor(() => gate.pending === 1, 'sleep');
    expect(all()).toEqual([]);
    cf.addLogs(SRC, ['fresh'], T + 1n * MS);
    await gate.release();
    await waitFor(() => batches.length === 1, 'fresh batch');
    expect(all()).toEqual(['fresh']);
  });

  it('refreshes the token transparently on 401', async () => {
    cf.addLogs(SRC, ['x'], T);
    cf.state.validAccessTokens.clear();
    poller({ fromNs: T.toString() });
    await waitFor(() => batches.length === 1, 'batch');
    expect(required).toEqual([]);
    expect(
      cf.requestsTo('/uaa/oauth/token').filter((r) => r.form?.['grant_type'] === 'refresh_token'),
    ).toHaveLength(1);
  });

  it('backs off exponentially on server errors and resets after success', async () => {
    cf.state.failLogCache.push({ status: 500 }, { status: 502 }, { status: 503 }, { status: 500 });
    cf.addLogs(SRC, ['ok'], T);
    const p = poller({ fromNs: T.toString(), initialBackoffMs: 1000, maxBackoffMs: 4000 });
    for (const expected of [1000, 2000, 4000, 4000]) {
      await waitFor(() => gate.pending === 1, `backoff sleep ${expected}`);
      expect(gate.requested.at(-1)).toBe(expected);
      expect(p.status).toMatchObject({ state: 'backoff', retryInMs: expected });
      expect(p.status.lastError?.code).toBe('SERVER_ERROR');
      await gate.release();
    }
    await waitFor(() => batches.length === 1, 'recovery batch');
    await waitFor(() => gate.pending === 1, 'idle sleep');
    expect(gate.requested.at(-1)).toBe(1000); // normal poll interval again
    expect(p.status.state).toBe('polling');
    expect(p.status.lastError).toBeUndefined();
  });

  it('honours Retry-After on 429', async () => {
    cf.state.failLogCache.push({ status: 429, headers: { 'retry-after': '7' } });
    const p = poller({ fromNs: T.toString() });
    await waitFor(() => gate.pending === 1, 'retry sleep');
    expect(gate.requested).toEqual([7000]);
    expect(p.status).toMatchObject({ state: 'backoff', lastError: { code: 'RATE_LIMITED' } });
  });

  it('pauses on lost sessions and continues after resume()', async () => {
    cf.addLogs(SRC, ['before'], T);
    cf.state.validAccessTokens.clear();
    cf.state.validRefreshTokens.clear();
    const p = poller({ fromNs: T.toString() });
    await waitFor(() => p.status.state === 'paused-auth', 'pause');
    expect(required).toEqual(['refresh-failed']);
    expect(batches).toEqual([]);
    expect(gate.requested).toEqual([]); // no backoff sleeping while paused
    p.resume(); // nothing happens without a session... the loop retries and pauses again
    await waitFor(() => required.length === 2, 'second auth failure');
    expect(p.status.state).toBe('paused-auth');

    await tokens.loginPassword('alice', 'secret');
    p.resume();
    await waitFor(() => batches.length === 1, 'batch after login');
    expect(all()).toEqual(['before']);
    expect(p.status.state).toBe('polling');
  });

  it('re-delivers a batch when the consumer fails', async () => {
    cf.addLogs(SRC, ['a', 'b'], T);
    let fail = true;
    const p = poller({
      fromNs: T.toString(),
      onBatch: (b) => {
        if (fail) {
          fail = false;
          throw new Error('disk full');
        }
        batches.push(b);
      },
    });
    await waitFor(() => p.status.state === 'backoff', 'backoff');
    expect(p.status.lastError).toEqual({ code: 'INTERNAL', message: 'disk full' });
    expect(p.status.total).toBe(0);
    await gate.release();
    await waitFor(() => batches.length === 1, 'redelivery');
    expect(msgs(batches[0]!)).toEqual(['a', 'b']);
    expect(p.status.total).toBe(2);
  });

  it('stop() interrupts a sleep, is idempotent and reports stopped', async () => {
    const p = poller({ fromNs: T.toString() });
    await waitFor(() => gate.pending === 1, 'sleep');
    const t0 = Date.now();
    await p.stop();
    await p.stop();
    expect(Date.now() - t0).toBeLessThan(500);
    expect(p.status.state).toBe('stopped');
    expect(statuses.at(-1)?.state).toBe('stopped');
    cf.addLogs(SRC, ['after'], T);
    await new Promise((r) => setTimeout(r, 30));
    expect(all()).toEqual([]);
  });

  it('stop() while paused for auth resolves immediately', async () => {
    cf.state.validAccessTokens.clear();
    cf.state.validRefreshTokens.clear();
    const p = poller({ fromNs: T.toString() });
    await waitFor(() => p.status.state === 'paused-auth', 'pause');
    await p.stop();
    expect(p.status.state).toBe('stopped');
  });
});
