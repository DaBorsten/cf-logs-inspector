import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMockCf, type MockCf } from '../../../../test/fixtures/mock-cf';
import { ConnectionStore, type Encryptor } from '../../store/connections';
import { ConnectionManager } from '../connection-manager';

const encryptor: Encryptor = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from(p).toString('base64'),
  decrypt: (c) => Buffer.from(c, 'base64').toString('utf8'),
};

let cf: MockCf;
let dir: string;
let clock: number;
const events: string[] = [];

function manager(): ConnectionManager {
  return new ConnectionManager({
    store: new ConnectionStore({
      filePath: join(dir, 'connections.json'),
      encryptor,
      now: () => clock,
    }),
    now: () => clock,
    onAuthRequired: (id, reason) => events.push(`required:${id}:${reason}`),
    onAuthChanged: (id, status) => events.push(`changed:${id}:${status.loggedIn}`),
  });
}

beforeAll(async () => {
  cf = await startMockCf();
});
afterAll(async () => {
  await cf.close();
});
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cfli-cm-'));
  clock = Date.parse('2026-09-10T10:00:00Z');
  events.length = 0;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('ConnectionManager', () => {
  it('normalises the API URL on save and reports unknown ids', async () => {
    const cm = manager();
    const p = await cm.save({
      name: 'local',
      apiUrl: `${cf.apiUrl}/v3/`,
      authMode: 'password',
      skipSslValidation: false,
    });
    expect(p.apiUrl).toBe(cf.apiUrl);
    expect(cm.list()).toHaveLength(1);
    expect(() => cm.get('nope')).toThrow(/Unknown connection/);
    await expect(cm.authStatus('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await cm.disposeAll();
  });

  it('test() discovers endpoints without saving anything', async () => {
    const cm = manager();
    const ep = await cm.test({ apiUrl: cf.apiUrl, skipSslValidation: false });
    expect(ep.login).toBe(cf.loginUrl);
    expect(cm.list()).toEqual([]);
    await expect(
      cm.test({ apiUrl: 'http://127.0.0.1:1', skipSslValidation: false }),
    ).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('logs in, lists orgs, persists the session and emits auth events', async () => {
    const cm = manager();
    const p = await cm.save({
      name: 'local',
      apiUrl: cf.apiUrl,
      authMode: 'password',
      skipSslValidation: false,
    });
    expect(await cm.authStatus(p.id)).toEqual({ loggedIn: false, canRefresh: false });

    const rt = await cm.runtime(p.id);
    expect(rt.endpoints.cloudControllerV3).toBe(`${cf.baseUrl}/v3`);
    const status = await rt.tokens.loginPassword('alice', 'secret');
    expect(status.loggedIn).toBe(true);
    expect(await rt.cc.listOrgs()).toHaveLength(2);
    expect(events).toEqual([`changed:${p.id}:true`]);
    await cm.disposeAll();

    // A fresh manager on the same file resumes the session from the encrypted store.
    const cm2 = manager();
    expect(await cm2.authStatus(p.id)).toMatchObject({
      loggedIn: true,
      username: 'alice',
      canRefresh: true,
    });
    const rt2 = await cm2.runtime(p.id);
    expect(await rt2.cc.listApps('space-1')).toHaveLength(2);
    await cm2.disposeAll();
  });

  it('propagates auth:required when the refresh token is revoked', async () => {
    const cm = manager();
    const p = await cm.save({
      name: 'local',
      apiUrl: cf.apiUrl,
      authMode: 'password',
      skipSslValidation: false,
    });
    const rt = await cm.runtime(p.id);
    await rt.tokens.loginPassword('alice', 'secret');
    cf.state.validRefreshTokens.clear();
    cf.state.validAccessTokens.clear();
    await expect(rt.cc.listOrgs()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(events).toContain(`required:${p.id}:refresh-failed`);
    expect(await cm.authStatus(p.id)).toMatchObject({ loggedIn: false });
    await cm.disposeAll();
  });

  it('saving a profile discards its runtime; deleting removes tokens', async () => {
    const cm = manager();
    const p = await cm.save({
      name: 'local',
      apiUrl: cf.apiUrl,
      authMode: 'password',
      skipSslValidation: false,
    });
    const rt1 = await cm.runtime(p.id);
    await cm.save({ ...p, name: 'renamed' });
    const rt2 = await cm.runtime(p.id);
    expect(rt2).not.toBe(rt1);
    expect(rt2.profile.name).toBe('renamed');
    await rt2.tokens.loginPassword('alice', 'secret');
    await cm.delete(p.id);
    expect(cm.list()).toEqual([]);
    await expect(cm.runtime(p.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('does not cache a failed runtime build', async () => {
    const cm = manager();
    const p = await cm.save({
      name: 'local',
      apiUrl: cf.apiUrl,
      authMode: 'password',
      skipSslValidation: false,
    });
    cf.state.notCf = true;
    await expect(cm.runtime(p.id)).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    cf.state.notCf = false;
    await expect(cm.runtime(p.id)).resolves.toBeDefined();
    await cm.disposeAll();
  });
});
