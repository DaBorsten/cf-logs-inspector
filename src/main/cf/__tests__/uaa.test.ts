import { makeJwt, startMockCf, type MockCf } from '../../../../test/fixtures/mock-cf';
import { AuthError } from '../errors';
import { HttpClient } from '../http';
import {
  authStatusOf,
  decodeJwtPayload,
  MemoryTokenStore,
  TokenManager,
  UaaClient,
  type TokenSet,
} from '../uaa';

let cf: MockCf;
let http: HttpClient;
let clock: number;
const now = (): number => clock;

beforeAll(async () => {
  cf = await startMockCf({
    users: [
      { username: 'alice', password: 'secret' },
      { username: 'bob', password: 'pw', origin: 'my-idp' },
    ],
    passcodes: ['PC123456', 'PC000001'],
    tokenTtlSec: 600,
  });
  http = new HttpClient();
});
afterAll(async () => {
  await http.close();
  await cf.close();
});
beforeEach(() => {
  clock = Date.parse('2026-09-10T10:00:00Z');
  cf.state.requests.length = 0;
});

const uaa = (): UaaClient => new UaaClient({ http, loginUrl: cf.loginUrl, now });

describe('decodeJwtPayload / authStatusOf', () => {
  it('decodes claims and tolerates garbage', () => {
    expect(decodeJwtPayload(makeJwt({ user_name: 'x', exp: 1 }))).toEqual({
      user_name: 'x',
      exp: 1,
    });
    expect(decodeJwtPayload('not-a-jwt')).toBeUndefined();
    expect(decodeJwtPayload('a.!!!.c')).toBeUndefined();
  });

  const t = (over: Partial<TokenSet>): TokenSet => ({
    accessToken: 'a',
    tokenType: 'bearer',
    expiresAt: 2000,
    ...over,
  });
  it.each<[TokenSet | undefined, number, Partial<ReturnType<typeof authStatusOf>>]>([
    [undefined, 1000, { loggedIn: false, canRefresh: false }],
    [t({}), 1000, { loggedIn: true, canRefresh: false, expiresAt: 2000 }],
    [t({}), 3000, { loggedIn: false, canRefresh: false }],
    [t({ refreshToken: 'r' }), 3000, { loggedIn: true, canRefresh: true }],
    [t({ username: 'u' }), 1000, { username: 'u' }],
  ])('%j at %d', (tokens, at, expected) => {
    expect(authStatusOf(tokens, at)).toMatchObject(expected);
  });
});

describe('UaaClient grants', () => {
  it('password grant sends the cf client credentials and form fields', async () => {
    const tokens = await uaa().passwordGrant({ username: 'alice', password: 'secret' });
    const req = cf.requestsTo('/uaa/oauth/token')[0]!;
    expect(req.headers.authorization).toBe('Basic Y2Y6');
    expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(req.form).toEqual({ grant_type: 'password', username: 'alice', password: 'secret' });
    expect(tokens).toMatchObject({
      tokenType: 'bearer',
      username: 'alice',
      expiresAt: clock + 600_000,
      refreshToken: expect.stringMatching(/^rt-/),
    });
  });

  it('origin login adds a JSON login_hint', async () => {
    await uaa().passwordGrant({ username: 'bob', password: 'pw', origin: 'my-idp' });
    expect(cf.requestsTo('/uaa/oauth/token')[0]!.form?.['login_hint']).toBe('{"origin":"my-idp"}');
  });

  it('passcode grant sends only the passcode', async () => {
    const tokens = await uaa().passcodeGrant('  PC123456 ');
    expect(cf.requestsTo('/uaa/oauth/token')[0]!.form).toEqual({
      grant_type: 'password',
      passcode: 'PC123456',
    });
    expect(tokens.username).toBe('sso-user');
  });

  it('maps rejected credentials to AUTH_FAILED with the UAA description', async () => {
    const err = await uaa()
      .passwordGrant({ username: 'alice', password: 'wrong' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err).toMatchObject({
      code: 'AUTH_FAILED',
      status: 401,
      message: expect.stringContaining('Bad credentials'),
    });
  });

  it('maps a rejected refresh token to AUTH_REQUIRED', async () => {
    await expect(uaa().refreshGrant('rt-bogus')).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      status: 401,
    });
  });

  it('maps other UAA failures to the generic status errors', async () => {
    cf.state.failNextUaa = { status: 502, body: 'bad gateway' };
    await expect(
      uaa().passwordGrant({ username: 'alice', password: 'secret' }),
    ).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      status: 502,
    });
  });
});

describe('TokenManager', () => {
  function manager(
    opts: {
      store?: MemoryTokenStore;
      onAuthRequired?: (r: string) => void;
      onChange?: () => void;
    } = {},
  ) {
    const store = opts.store ?? new MemoryTokenStore();
    const tm = new TokenManager({
      uaa: uaa(),
      store,
      now,
      ...(opts.onAuthRequired ? { onAuthRequired: opts.onAuthRequired } : {}),
      ...(opts.onChange ? { onChange: opts.onChange } : {}),
    });
    return { tm, store };
  }

  it('reports logged out and rejects token requests before login', async () => {
    const required: string[] = [];
    const { tm } = manager({ onAuthRequired: (r) => required.push(r) });
    expect(tm.status()).toEqual({ loggedIn: false, canRefresh: false });
    await expect(tm.getAccessToken()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(required).toEqual(['no-token']);
  });

  it('logs in, persists tokens and serves the cached access token', async () => {
    const changes: unknown[] = [];
    const { tm, store } = manager({ onChange: () => changes.push(1) });
    const status = await tm.loginPassword('alice', 'secret');
    expect(status).toMatchObject({
      loggedIn: true,
      username: 'alice',
      canRefresh: true,
      expiresAt: clock + 600_000,
    });
    expect(store.load()?.accessToken).toBe(await tm.getAccessToken());
    expect(cf.requestsTo('/uaa/oauth/token')).toHaveLength(1);
    expect(changes).toHaveLength(1);
  });

  it('refreshes ahead of expiry exactly once for concurrent callers', async () => {
    const { tm } = manager();
    await tm.loginPassword('alice', 'secret');
    const first = await tm.getAccessToken();
    clock += 600_000 - 30_000; // inside the 60 s skew window
    const tokens = await Promise.all(Array.from({ length: 10 }, () => tm.getAccessToken()));
    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).not.toBe(first);
    const refreshes = cf
      .requestsTo('/uaa/oauth/token')
      .filter((r) => r.form?.['grant_type'] === 'refresh_token');
    expect(refreshes).toHaveLength(1);
  });

  it('drops the session and reports refresh-failed when UAA rejects the refresh token', async () => {
    const required: string[] = [];
    const { tm, store } = manager({ onAuthRequired: (r) => required.push(r) });
    await tm.loginPassword('alice', 'secret');
    cf.state.validRefreshTokens.clear();
    clock += 700_000;
    await expect(tm.getAccessToken()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(required).toEqual(['refresh-failed']);
    expect(store.load()).toBeUndefined();
    expect(tm.status().loggedIn).toBe(false);
  });

  it('keeps the session when the refresh fails for non-auth reasons', async () => {
    const { tm, store } = manager();
    await tm.loginPassword('alice', 'secret');
    clock += 700_000;
    cf.state.failNextUaa = { status: 500 };
    await expect(tm.forceRefresh()).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(store.load()).toBeDefined();
    expect(tm.status().canRefresh).toBe(true);
  });

  it('resumes from a persisted token set', async () => {
    const store = new MemoryTokenStore();
    await manager({ store }).tm.loginPassword('alice', 'secret');
    const resumed = manager({ store }).tm;
    expect(resumed.status()).toMatchObject({ loggedIn: true, username: 'alice' });
    clock += 700_000;
    expect(resumed.status().loggedIn).toBe(true); // refreshable
    await expect(resumed.getAccessToken()).resolves.toMatch(/\./);
  });

  it('logout clears the store and reportUnauthorized notifies', async () => {
    const required: string[] = [];
    const { tm, store } = manager({ onAuthRequired: (r) => required.push(r) });
    await tm.loginPasscode('PC000001');
    tm.logout();
    expect(store.load()).toBeUndefined();
    tm.reportUnauthorized();
    expect(required).toEqual(['unauthorized']);
  });
});
