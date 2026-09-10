import { startMockCf, type MockCf } from '../../../../test/fixtures/mock-cf';
import { CcClient } from '../cc-client';
import { HttpClient } from '../http';
import { MemoryTokenStore, TokenManager, UaaClient } from '../uaa';

let cf: MockCf;
let http: HttpClient;
let tokens: TokenManager;
let cc: CcClient;
let clock: number;
const required: string[] = [];

beforeAll(async () => {
  cf = await startMockCf({ perPageCap: 2 });
  http = new HttpClient();
});
afterAll(async () => {
  await http.close();
  await cf.close();
});
beforeEach(async () => {
  clock = Date.parse('2026-09-10T10:00:00Z');
  required.length = 0;
  tokens = new TokenManager({
    uaa: new UaaClient({ http, loginUrl: cf.loginUrl, now: () => clock }),
    store: new MemoryTokenStore(),
    now: () => clock,
    onAuthRequired: (r) => required.push(r),
  });
  await tokens.loginPassword('alice', 'secret');
  cc = new CcClient({ http, v3Url: `${cf.baseUrl}/v3/`, tokens, perPage: 2 });
  cf.state.requests.length = 0;
  cf.state.orgs = [
    { guid: 'org-1', name: 'acme' },
    { guid: 'org-2', name: 'beta' },
  ];
});

describe('CcClient', () => {
  it('lists orgs across pages in name order', async () => {
    cf.state.orgs = [
      { guid: 'o3', name: 'charlie' },
      { guid: 'o1', name: 'alpha' },
      { guid: 'o2', name: 'bravo' },
    ];
    const orgs = await cc.listOrgs();
    expect(orgs).toEqual([
      { guid: 'o1', name: 'alpha' },
      { guid: 'o2', name: 'bravo' },
      { guid: 'o3', name: 'charlie' },
    ]);
    const pages = cf.requestsTo('/v3/organizations');
    expect(pages).toHaveLength(2);
    expect(pages[0]!.headers.authorization).toMatch(/^Bearer /);
  });

  it('lists spaces filtered by org', async () => {
    await expect(cc.listSpaces('org-1')).resolves.toEqual([
      { guid: 'space-1', name: 'dev', orgGuid: 'org-1' },
      { guid: 'space-2', name: 'prod', orgGuid: 'org-1' },
    ]);
    await expect(cc.listSpaces('org-2')).resolves.toEqual([
      { guid: 'space-3', name: 'dev', orgGuid: 'org-2' },
    ]);
    await expect(cc.listSpaces('nope')).resolves.toEqual([]);
  });

  it('lists apps with state', async () => {
    await expect(cc.listApps('space-1')).resolves.toEqual([
      { guid: 'app-1', name: 'api', spaceGuid: 'space-1', state: 'STARTED' },
      { guid: 'app-2', name: 'worker', spaceGuid: 'space-1', state: 'STOPPED' },
    ]);
  });

  it('refreshes once and retries when the CC rejects the token', async () => {
    cf.state.validAccessTokens.clear(); // token revoked server-side, still "valid" locally
    const orgs = await cc.listOrgs();
    expect(orgs).toHaveLength(2);
    const refreshes = cf
      .requestsTo('/uaa/oauth/token')
      .filter((r) => r.form?.['grant_type'] === 'refresh_token');
    expect(refreshes).toHaveLength(1);
    expect(required).toEqual([]);
  });

  it('gives up and reports unauthorized when the refreshed token is rejected too', async () => {
    cf.state.validAccessTokens.clear();
    // Make the mock reject *all* access tokens by intercepting the issuance side effect.
    const origAdd = cf.state.validAccessTokens.add.bind(cf.state.validAccessTokens);
    cf.state.validAccessTokens.add = () => cf.state.validAccessTokens;
    try {
      await expect(cc.listOrgs()).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
      expect(required).toEqual(['unauthorized']);
      expect(tokens.status().loggedIn).toBe(false);
    } finally {
      cf.state.validAccessTokens.add = origAdd;
    }
  });

  it('surfaces the login requirement when there is no session', async () => {
    tokens.logout();
    await expect(cc.listOrgs()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(required).toEqual(['no-token']);
    expect(cf.requestsTo('/v3/')).toHaveLength(0);
  });

  it('passes other errors through', async () => {
    cf.state.failNextCc = { status: 403 };
    await expect(cc.listOrgs()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    cf.state.failNextCc = { status: 500 };
    await expect(cc.listApps('space-1')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
  });
});
