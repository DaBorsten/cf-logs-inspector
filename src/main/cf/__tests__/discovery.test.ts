import { startMockCf, type MockCf } from '../../../../test/fixtures/mock-cf';
import { discoverEndpoints, guessLogCacheUrl, normalizeApiUrl } from '../discovery';
import { BadResponseError, InvalidInputError } from '../errors';
import { HttpClient } from '../http';

describe('normalizeApiUrl', () => {
  const ok: [string, string][] = [
    ['api.cf.eu10.hana.ondemand.com', 'https://api.cf.eu10.hana.ondemand.com'],
    ['https://api.cf.eu10.hana.ondemand.com/', 'https://api.cf.eu10.hana.ondemand.com'],
    ['  https://api.cf.eu10.hana.ondemand.com/v3  ', 'https://api.cf.eu10.hana.ondemand.com'],
    ['https://api.cf.eu10.hana.ondemand.com/v2/', 'https://api.cf.eu10.hana.ondemand.com'],
    ['https://api.example.com:8443/cf?x=1#y', 'https://api.example.com:8443/cf'],
    ['http://127.0.0.1:9000', 'http://127.0.0.1:9000'],
    ['HTTPS://API.EXAMPLE.COM', 'https://api.example.com'],
  ];
  it.each(ok)('%s -> %s', (input, expected) => {
    expect(normalizeApiUrl(input)).toBe(expected);
  });

  const bad = ['', '   ', 'ftp://api.example.com', 'https://', 'not a url'];
  it.each(bad)('rejects %j', (input) => {
    expect(() => normalizeApiUrl(input)).toThrow(InvalidInputError);
  });
});

describe('guessLogCacheUrl', () => {
  it.each([
    ['https://api.cf.eu10.hana.ondemand.com', 'https://log-cache.cf.eu10.hana.ondemand.com'],
    ['https://api.sys.example.com:8443/x', 'https://log-cache.sys.example.com:8443'],
    ['https://cf.example.com', 'https://log-cache.cf.example.com'],
  ])('%s -> %s', (api, expected) => {
    expect(guessLogCacheUrl(api)).toBe(expected);
  });
});

describe('discoverEndpoints', () => {
  let cf: MockCf;
  let http: HttpClient;
  beforeAll(async () => {
    cf = await startMockCf();
    http = new HttpClient();
  });
  afterAll(async () => {
    await http.close();
    await cf.close();
  });
  beforeEach(() => {
    cf.state.rootLinks = undefined;
    cf.state.notCf = false;
  });

  it('reads the links from the root document', async () => {
    const ep = await discoverEndpoints(http, `${cf.apiUrl}/`);
    expect(ep).toEqual({
      api: cf.apiUrl,
      uaa: `${cf.baseUrl}/uaa`,
      login: `${cf.baseUrl}/uaa`,
      logCache: `${cf.baseUrl}/logcache`,
      cloudControllerV3: `${cf.baseUrl}/v3`,
    });
  });

  it('falls back to the log-cache host and /v3 when links are missing', async () => {
    cf.state.rootLinks = { uaa: { href: 'https://uaa.example.com/' } };
    const ep = await discoverEndpoints(http, cf.apiUrl);
    expect(ep.uaa).toBe('https://uaa.example.com');
    expect(ep.login).toBe('https://uaa.example.com');
    expect(ep.logCache).toBe(guessLogCacheUrl(cf.apiUrl));
    expect(ep.cloudControllerV3).toBe(`${cf.apiUrl}/v3`);
  });

  it('rejects endpoints without UAA information', async () => {
    cf.state.rootLinks = { self: { href: cf.baseUrl } };
    await expect(discoverEndpoints(http, cf.apiUrl)).rejects.toBeInstanceOf(BadResponseError);
  });

  it('rejects non-CF servers (HTML at /)', async () => {
    cf.state.notCf = true;
    await expect(discoverEndpoints(http, cf.apiUrl)).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
    });
  });
});
