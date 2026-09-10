import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startMockCf, type MockCf } from '../../../../test/fixtures/mock-cf';
import { HttpClient } from '../http';
import { compareNs, decodePayload, LogCacheClient } from '../log-cache';
import { MemoryTokenStore, TokenManager, UaaClient } from '../uaa';

const T = 1_757_500_000_000n * 1_000_000n; // 2025-09-10T09:46:40Z in ns

let cf: MockCf;
let http: HttpClient;
let tokens: TokenManager;
let lc: LogCacheClient;

beforeAll(async () => {
  cf = await startMockCf();
  http = new HttpClient();
  tokens = new TokenManager({
    uaa: new UaaClient({ http, loginUrl: cf.loginUrl }),
    store: new MemoryTokenStore(),
  });
  await tokens.loginPassword('alice', 'secret');
  lc = new LogCacheClient({ http, baseUrl: `${cf.baseUrl}/logcache/`, tokens });
});
afterAll(async () => {
  await http.close();
  await cf.close();
});
beforeEach(() => {
  cf.state.logs = [];
  cf.state.requests.length = 0;
  cf.state.logCacheLimitCap = 1000;
});

describe('helpers', () => {
  it.each([
    ['1', '2', -1],
    ['2', '1', 1],
    ['10', '10', 0],
    ['9223372036854775807', '9223372036854775806', 1],
  ])('compareNs(%s, %s) = %d', (a, b, expected) => {
    expect(compareNs(a, b)).toBe(expected);
  });

  it('decodes base64 payloads and tolerates garbage', () => {
    expect(decodePayload(Buffer.from('héllo\n').toString('base64'))).toBe('héllo\n');
    expect(decodePayload('')).toBe('');
  });
});

describe('LogCacheClient.readUrl', () => {
  it('builds the read URL with clamped limit and optional bounds', () => {
    const base = `${cf.baseUrl}/logcache/api/v1/read/`;
    expect(lc.readUrl('app/1')).toBe(`${base}app%2F1?envelope_types=LOG&limit=1000`);
    expect(lc.readUrl('a', { limit: 0 })).toContain('limit=1');
    expect(lc.readUrl('a', { limit: 5000 })).toContain('limit=1000');
    const u = new URL(
      lc.readUrl('a', {
        startTimeNs: T,
        endTimeNs: (T + 5n).toString(),
        limit: 10,
        descending: true,
      }),
    );
    expect(Object.fromEntries(u.searchParams)).toEqual({
      envelope_types: 'LOG',
      limit: '10',
      start_time: T.toString(),
      end_time: (T + 5n).toString(),
      descending: 'true',
    });
    expect(lc.readUrl('a', { descending: false })).not.toContain('descending');
  });
});

describe('LogCacheClient.read', () => {
  it('returns decoded envelopes with tags mapped', async () => {
    cf.state.logs.push(
      {
        sourceId: 'app-1',
        timestampNs: T.toString(),
        message: 'hello world\n',
        type: 'ERR',
        instanceId: '2',
        appName: 'api',
        sourceType: 'APP/PROC/WEB',
      },
      { sourceId: 'app-1', timestampNs: (T + 1n).toString(), message: '{"level":"info"}' },
      { sourceId: 'other', timestampNs: (T + 2n).toString(), message: 'not mine' },
    );
    const out = await lc.read('app-1');
    expect(out).toEqual([
      {
        timestampNs: T.toString(),
        sourceId: 'app-1',
        instanceId: '2',
        appName: 'api',
        sourceType: 'APP/PROC/WEB',
        stream: 'ERR',
        payload: 'hello world\n',
        tags: { app_name: 'api', source_type: 'APP/PROC/WEB', origin: 'rep' },
      },
      expect.objectContaining({
        timestampNs: (T + 1n).toString(),
        stream: 'OUT',
        payload: '{"level":"info"}',
      }),
    ]);
    expect(cf.requestsTo('/logcache/')[0]!.headers.authorization).toMatch(/^Bearer /);
  });

  it('applies bounds, limit and descending server-side', async () => {
    cf.addLogs('app-1', ['m0', 'm1', 'm2', 'm3', 'm4'], T);
    const asc = await lc.read('app-1', { startTimeNs: T + 1_000_000n, endTimeNs: T + 4_000_000n });
    expect(asc.map((e) => e.payload)).toEqual(['m1', 'm2', 'm3']);
    const desc = await lc.read('app-1', { descending: true, limit: 2 });
    expect(desc.map((e) => e.payload)).toEqual(['m4', 'm3']);
  });

  it('refreshes the token once on 401 and retries', async () => {
    cf.addLogs('app-1', ['m0'], T);
    cf.state.validAccessTokens.clear();
    const out = await lc.read('app-1');
    expect(out).toHaveLength(1);
    const refreshes = cf
      .requestsTo('/uaa/oauth/token')
      .filter((r) => r.form?.['grant_type'] === 'refresh_token');
    expect(refreshes).toHaveLength(1);
  });

  it('maps failures to CfErrors', async () => {
    cf.state.failLogCache.push({ status: 503 });
    await expect(lc.read('app-1')).rejects.toMatchObject({ code: 'SERVER_ERROR', status: 503 });
    cf.state.failLogCache.push({ status: 429, headers: { 'retry-after': '2' } });
    await expect(lc.read('app-1')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterMs: 2000,
    });
  });
});

describe('LogCacheClient.read schema tolerance', () => {
  let server: Server;
  let base: string;
  let body: unknown;
  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('accepts numeric timestamps, skips non-log envelopes and tolerates missing fields', async () => {
    body = {
      envelopes: {
        batch: [
          { timestamp: 1757500000000000000, log: { payload: Buffer.from('a').toString('base64') } },
          { timestamp: '2', counter: { name: 'requests', total: 1 } },
          { timestamp: '3', source_id: 'x', tags: { app_name: 'n' }, log: { type: 'ERR' } },
        ],
      },
    };
    const client = new LogCacheClient({ http, baseUrl: base, tokens });
    const out = await client.read('src');
    expect(out).toEqual([
      expect.objectContaining({
        timestampNs: '1757500000000000000',
        sourceId: 'src',
        payload: 'a',
        stream: 'OUT',
      }),
      expect.objectContaining({
        timestampNs: '3',
        sourceId: 'x',
        appName: 'n',
        payload: '',
        stream: 'ERR',
      }),
    ]);
  });

  it('treats an empty document as no envelopes and garbage as BAD_RESPONSE', async () => {
    const client = new LogCacheClient({ http, baseUrl: base, tokens });
    body = {};
    await expect(client.read('src')).resolves.toEqual([]);
    body = { envelopes: { batch: 'nope' } };
    await expect(client.read('src')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });
});
