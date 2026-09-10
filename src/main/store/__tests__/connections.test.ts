import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvalidInputError } from '../../cf/errors';
import type { TokenSet } from '../../cf/uaa';
import { ConnectionStore, memoryOnlyEncryptor, type Encryptor } from '../connections';

/** Reversible "encryption" that is easy to spot in the file (base64 with a marker). */
const fakeEncryptor: Encryptor = {
  isAvailable: () => true,
  encrypt: (plain) => `enc:${Buffer.from(plain).toString('base64')}`,
  decrypt: (cipher) => {
    if (!cipher.startsWith('enc:')) throw new Error('bad cipher');
    return Buffer.from(cipher.slice(4), 'base64').toString('utf8');
  },
};

let dir: string;
let file: string;
let clock = 1_000;
let seq = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cfli-store-'));
  file = join(dir, 'nested', 'connections.json');
  clock = 1_000;
  seq = 0;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const make = (encryptor: Encryptor = fakeEncryptor): ConnectionStore =>
  new ConnectionStore({
    filePath: file,
    encryptor,
    now: () => clock,
    idFactory: () => `id-${++seq}`,
  });

const input = {
  name: 'EU10',
  apiUrl: 'https://api.cf.eu10.hana.ondemand.com',
  authMode: 'password' as const,
  skipSslValidation: false,
};

describe('ConnectionStore profiles', () => {
  it('starts empty when no file exists', () => {
    expect(make().list()).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it('creates, updates and lists profiles sorted by name', () => {
    const store = make();
    const a = store.save({ ...input, name: 'zulu', username: '  alice ' });
    expect(a).toEqual({
      ...input,
      name: 'zulu',
      username: 'alice',
      id: 'id-1',
      createdAt: 1000,
      updatedAt: 1000,
    });
    clock = 2_000;
    const b = store.save({ ...input, name: 'alpha', authMode: 'origin', origin: 'idp' });
    expect(store.list().map((c) => c.name)).toEqual(['alpha', 'zulu']);
    clock = 3_000;
    const a2 = store.save({ ...a, name: 'yankee', username: '' });
    expect(a2).toMatchObject({ id: 'id-1', name: 'yankee', createdAt: 1000, updatedAt: 3000 });
    expect(a2).not.toHaveProperty('username');
    expect(store.get(b.id)?.origin).toBe('idp');
  });

  it('persists to disk and reloads', () => {
    make().save(input);
    const reloaded = make();
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.get('id-1')?.name).toBe('EU10');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ version: 1 });
  });

  it('deletes profiles together with their tokens', () => {
    const store = make();
    store.save(input);
    store.tokenStore('id-1').save({ accessToken: 'a', tokenType: 'bearer', expiresAt: 1 });
    expect(store.delete('id-1')).toBe(true);
    expect(store.delete('id-1')).toBe(false);
    expect(store.list()).toEqual([]);
    expect(JSON.parse(readFileSync(file, 'utf8')).tokens).toEqual({});
  });

  const invalid: [string, Partial<typeof input & { origin?: string; id?: string }>][] = [
    ['blank name', { name: '  ' }],
    ['missing api url', { apiUrl: '' }],
    ['origin mode without origin', { authMode: 'origin' as never }],
    ['unknown id', { id: 'missing' }],
  ];
  it.each(invalid)('rejects %s', (_n, patch) => {
    expect(() => make().save({ ...input, ...patch })).toThrow(InvalidInputError);
  });

  it('moves a corrupt file aside and starts empty', () => {
    make().save(input);
    writeFileSync(file, '{not json');
    const store = make();
    expect(store.list()).toEqual([]);
    expect(existsSync(`${file}.corrupt-1000`)).toBe(true);
  });
});

describe('ConnectionStore tokens', () => {
  const tokens: TokenSet = {
    accessToken: 'at',
    refreshToken: 'rt',
    tokenType: 'bearer',
    expiresAt: 5,
    username: 'u',
  };

  it('stores tokens encrypted and never in plain text', () => {
    const store = make();
    store.save(input);
    store.tokenStore('id-1').save(tokens);
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain('"rt"');
    expect(raw).toContain('enc:');
    expect(make().tokenStore('id-1').load()).toEqual(tokens);
  });

  it('clears tokens when saving undefined', () => {
    const store = make();
    store.save(input);
    const ts = store.tokenStore('id-1');
    ts.save(tokens);
    ts.save(undefined);
    expect(ts.load()).toBeUndefined();
    expect(JSON.parse(readFileSync(file, 'utf8')).tokens).toEqual({});
  });

  it('drops undecryptable tokens instead of throwing', () => {
    const store = make();
    store.save(input);
    store.tokenStore('id-1').save(tokens);
    const other = new ConnectionStore({
      filePath: file,
      encryptor: {
        ...fakeEncryptor,
        decrypt: () => {
          throw new Error('keychain changed');
        },
      },
    });
    expect(other.tokenStore('id-1').load()).toBeUndefined();
    expect(JSON.parse(readFileSync(file, 'utf8')).tokens).toEqual({});
  });

  it('falls back to memory-only storage when encryption is unavailable', () => {
    const store = make(memoryOnlyEncryptor);
    store.save(input);
    store.tokenStore('id-1').save(tokens);
    expect(store.tokenStore('id-1').load()).toEqual(tokens); // same in-memory store per id
    expect(JSON.parse(readFileSync(file, 'utf8')).tokens).toEqual({});
    expect(make(memoryOnlyEncryptor).tokenStore('id-1').load()).toBeUndefined();
  });
});
