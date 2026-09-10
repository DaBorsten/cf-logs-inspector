/**
 * In-process mock of a Cloud Foundry foundation for tests: API root (discovery), UAA `/oauth/token`
 * under `/uaa`, and Cloud Controller v3 orgs/spaces/apps with pagination under `/v3`.
 * Everything is observable/mutable through `state` so tests can assert requests and simulate failures.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer, type ServerOptions as HttpsOptions } from 'node:https';
import type { AddressInfo } from 'node:net';

export interface MockUser {
  username: string;
  password: string;
  /** When set, the login must carry `login_hint={"origin":...}` with this origin. */
  origin?: string;
}

export interface MockOrg {
  guid: string;
  name: string;
}
export interface MockSpace {
  guid: string;
  name: string;
  orgGuid: string;
}
export interface MockApp {
  guid: string;
  name: string;
  spaceGuid: string;
  state: string;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  form?: Record<string, string>;
}

export interface MockCfState {
  users: MockUser[];
  passcodes: Set<string>;
  orgs: MockOrg[];
  spaces: MockSpace[];
  apps: MockApp[];
  /** Access tokens the CC accepts. Clear it to simulate expiry on the resource server. */
  validAccessTokens: Set<string>;
  /** Refresh tokens UAA accepts. Clear it to simulate a revoked session. */
  validRefreshTokens: Set<string>;
  /** `expires_in` reported by UAA. */
  tokenTtlSec: number;
  /** Next CC request fails with this response (consumed once). */
  failNextCc?: { status: number; body?: string; headers?: Record<string, string> } | undefined;
  /** Next UAA request fails with this response (consumed once). */
  failNextUaa?: { status: number; body?: string } | undefined;
  requests: RecordedRequest[];
  /** Root document overrides (e.g. drop `log_cache`). */
  rootLinks?: Record<string, { href: string } | null> | undefined;
  /** Serve a non-CF HTML page at `/` instead of the links document. */
  notCf?: boolean;
  issued: number;
}

export interface MockCf {
  server: Server;
  baseUrl: string;
  apiUrl: string;
  loginUrl: string;
  state: MockCfState;
  /** Requests recorded for a path prefix. */
  requestsTo(prefix: string): RecordedRequest[];
  close(): Promise<void>;
}

export interface MockCfOptions {
  tls?: HttpsOptions;
  users?: MockUser[];
  passcodes?: string[];
  tokenTtlSec?: number;
  perPageCap?: number;
}

export function makeJwt(claims: Record<string, unknown>): string {
  const b64 = (s: string): string => Buffer.from(s).toString('base64url');
  return `${b64(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64(JSON.stringify(claims))}.sig`;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c: Buffer) => (s += c.toString('utf8')));
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

export async function startMockCf(opts: MockCfOptions = {}): Promise<MockCf> {
  const state: MockCfState = {
    users: opts.users ?? [{ username: 'alice', password: 'secret' }],
    passcodes: new Set(opts.passcodes ?? ['PC123456']),
    orgs: [
      { guid: 'org-1', name: 'acme' },
      { guid: 'org-2', name: 'beta' },
    ],
    spaces: [
      { guid: 'space-1', name: 'dev', orgGuid: 'org-1' },
      { guid: 'space-2', name: 'prod', orgGuid: 'org-1' },
      { guid: 'space-3', name: 'dev', orgGuid: 'org-2' },
    ],
    apps: [
      { guid: 'app-1', name: 'api', spaceGuid: 'space-1', state: 'STARTED' },
      { guid: 'app-2', name: 'worker', spaceGuid: 'space-1', state: 'STOPPED' },
      { guid: 'app-3', name: 'ui', spaceGuid: 'space-2', state: 'STARTED' },
    ],
    validAccessTokens: new Set(),
    validRefreshTokens: new Set(),
    tokenTtlSec: opts.tokenTtlSec ?? 600,
    requests: [],
    issued: 0,
  };
  const perPageCap = opts.perPageCap ?? 2;
  let baseUrl = '';

  const issueTokens = (username: string): Record<string, unknown> => {
    state.issued++;
    const access = makeJwt({
      user_name: username,
      exp: Math.floor(Date.now() / 1000) + state.tokenTtlSec,
      jti: `at-${state.issued}`,
    });
    const refresh = `rt-${state.issued}`;
    state.validAccessTokens.add(access);
    state.validRefreshTokens.add(refresh);
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'bearer',
      expires_in: state.tokenTtlSec,
    };
  };

  const handleUaa = (
    req: IncomingMessage,
    res: ServerResponse,
    form: Record<string, string>,
  ): void => {
    if (state.failNextUaa) {
      const f = state.failNextUaa;
      state.failNextUaa = undefined;
      res.writeHead(f.status, { 'content-type': 'application/json' });
      res.end(f.body ?? '{"error":"server_error"}');
      return;
    }
    if (req.headers.authorization !== 'Basic Y2Y6') {
      json(res, 401, { error: 'unauthorized', error_description: 'Bad client credentials' });
      return;
    }
    switch (form['grant_type']) {
      case 'password': {
        if (form['passcode'] !== undefined) {
          if (state.passcodes.has(form['passcode'])) {
            state.passcodes.delete(form['passcode']);
            json(res, 200, issueTokens('sso-user'));
          } else json(res, 401, { error: 'unauthorized', error_description: 'Invalid passcode' });
          return;
        }
        const hint = form['login_hint']
          ? (JSON.parse(form['login_hint']) as { origin?: string })
          : undefined;
        const user = state.users.find(
          (u) =>
            u.username === form['username'] &&
            u.password === form['password'] &&
            (u.origin ?? undefined) === hint?.origin,
        );
        if (!user) {
          json(res, 401, { error: 'unauthorized', error_description: 'Bad credentials' });
          return;
        }
        json(res, 200, issueTokens(user.username));
        return;
      }
      case 'refresh_token': {
        const rt = form['refresh_token'] ?? '';
        if (!state.validRefreshTokens.has(rt)) {
          json(res, 401, { error: 'invalid_token', error_description: 'Invalid refresh token' });
          return;
        }
        state.validRefreshTokens.delete(rt);
        json(res, 200, issueTokens('alice'));
        return;
      }
      default:
        json(res, 400, { error: 'unsupported_grant_type' });
    }
  };

  const paged = <T>(res: ServerResponse, url: URL, rows: T[], map: (r: T) => unknown): void => {
    const perPage = Math.min(Number(url.searchParams.get('per_page') ?? 50), perPageCap);
    const page = Number(url.searchParams.get('page') ?? 1);
    const start = (page - 1) * perPage;
    const slice = rows.slice(start, start + perPage);
    const hasNext = start + perPage < rows.length;
    const next = new URL(url);
    next.searchParams.set('page', String(page + 1));
    json(res, 200, {
      pagination: {
        total_results: rows.length,
        total_pages: Math.ceil(rows.length / perPage),
        next: hasNext ? { href: `${baseUrl}${next.pathname}${next.search}` } : null,
      },
      resources: slice.map(map),
    });
  };

  const handleCc = (req: IncomingMessage, res: ServerResponse, url: URL): void => {
    if (state.failNextCc) {
      const f = state.failNextCc;
      state.failNextCc = undefined;
      res.writeHead(f.status, { 'content-type': 'application/json', ...(f.headers ?? {}) });
      res.end(
        f.body ??
          JSON.stringify({ errors: [{ code: 10001, title: 'CF-Error', detail: 'simulated' }] }),
      );
      return;
    }
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!state.validAccessTokens.has(token)) {
      json(res, 401, {
        errors: [{ code: 10002, title: 'CF-NotAuthenticated', detail: 'Authentication error' }],
      });
      return;
    }
    const byName = <T extends { name: string }>(a: T, b: T): number => a.name.localeCompare(b.name);
    switch (url.pathname) {
      case '/v3/organizations':
        paged(res, url, [...state.orgs].sort(byName), (o) => ({
          guid: o.guid,
          name: o.name,
          extra: 1,
        }));
        return;
      case '/v3/spaces': {
        const orgs = url.searchParams.get('organization_guids')?.split(',');
        const rows = state.spaces.filter((s) => !orgs || orgs.includes(s.orgGuid)).sort(byName);
        paged(res, url, rows, (s) => ({
          guid: s.guid,
          name: s.name,
          relationships: { organization: { data: { guid: s.orgGuid } } },
        }));
        return;
      }
      case '/v3/apps': {
        const spaces = url.searchParams.get('space_guids')?.split(',');
        const rows = state.apps.filter((a) => !spaces || spaces.includes(a.spaceGuid)).sort(byName);
        paged(res, url, rows, (a) => ({
          guid: a.guid,
          name: a.name,
          state: a.state,
          relationships: { space: { data: { guid: a.spaceGuid } } },
        }));
        return;
      }
      default:
        json(res, 404, {
          errors: [{ code: 10000, title: 'CF-NotFound', detail: 'Unknown request' }],
        });
    }
  };

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', baseUrl);
    const body = await readBody(req);
    const rec: RecordedRequest = {
      method: req.method ?? 'GET',
      path: url.pathname,
      headers: req.headers,
    };
    if (body && (req.headers['content-type'] ?? '').includes('x-www-form-urlencoded')) {
      rec.form = Object.fromEntries(new URLSearchParams(body));
    }
    state.requests.push(rec);

    if (url.pathname === '/') {
      if (state.notCf) {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body>Welcome to nginx!</body></html>');
        return;
      }
      const links: Record<string, { href: string } | null> = state.rootLinks ?? {
        self: { href: `${baseUrl}` },
        cloud_controller_v3: { href: `${baseUrl}/v3` },
        uaa: { href: `${baseUrl}/uaa` },
        login: { href: `${baseUrl}/uaa` },
        log_cache: { href: `${baseUrl}/logcache` },
        credhub: null,
      };
      json(res, 200, { links });
      return;
    }
    if (url.pathname === '/uaa/oauth/token') {
      handleUaa(req, res, rec.form ?? {});
      return;
    }
    if (url.pathname.startsWith('/v3/')) {
      handleCc(req, res, url);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  };

  const server = opts.tls
    ? createHttpsServer(opts.tls, (req, res) => void handler(req, res))
    : createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `${opts.tls ? 'https' : 'http'}://127.0.0.1:${port}`;

  return {
    server,
    baseUrl,
    apiUrl: baseUrl,
    loginUrl: `${baseUrl}/uaa`,
    state,
    requestsTo: (prefix) => state.requests.filter((r) => r.path.startsWith(prefix)),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** Port that nothing listens on, for connection-refused tests. */
export async function unusedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return port;
}
