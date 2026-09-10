import { z } from 'zod';
import type { AuthRequiredReason, AuthStatus } from '@shared/model/connection';
import { AuthError, describeErrorBody, httpStatusError, tryParseJson } from './errors';
import { parseJsonBody, type HttpClient } from './http';
import { noopLogger, type Logger } from '../log';

/** Tokens for one connection. Persisted (encrypted) by a `TokenStore`; `expiresAt` is epoch ms. */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt: number;
  username?: string;
}

export interface TokenStore {
  load(): TokenSet | undefined;
  save(tokens: TokenSet | undefined): void;
}

export class MemoryTokenStore implements TokenStore {
  private tokens: TokenSet | undefined;
  load(): TokenSet | undefined {
    return this.tokens;
  }
  save(tokens: TokenSet | undefined): void {
    this.tokens = tokens;
  }
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  token_type: z.string().default('bearer'),
  expires_in: z.coerce.number().optional(),
});

/** Decodes the payload of a JWT without verifying it (we only read informational claims). */
export function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return undefined;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    );
    const payload = tryParseJson(json);
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function toTokenSet(body: z.infer<typeof tokenResponseSchema>, nowMs: number): TokenSet {
  const claims = decodeJwtPayload(body.access_token);
  const exp = typeof claims?.['exp'] === 'number' ? claims['exp'] * 1000 : undefined;
  const expiresAt =
    body.expires_in !== undefined ? nowMs + body.expires_in * 1000 : (exp ?? nowMs + 5 * 60_000);
  const username =
    typeof claims?.['user_name'] === 'string'
      ? claims['user_name']
      : typeof claims?.['email'] === 'string'
        ? claims['email']
        : undefined;
  const t: TokenSet = { accessToken: body.access_token, tokenType: body.token_type, expiresAt };
  if (body.refresh_token) t.refreshToken = body.refresh_token;
  if (username) t.username = username;
  return t;
}

export function authStatusOf(tokens: TokenSet | undefined, nowMs: number): AuthStatus {
  if (!tokens) return { loggedIn: false, canRefresh: false };
  const canRefresh = Boolean(tokens.refreshToken);
  const status: AuthStatus = {
    loggedIn: tokens.expiresAt > nowMs || canRefresh,
    canRefresh,
    expiresAt: tokens.expiresAt,
  };
  if (tokens.username) status.username = tokens.username;
  return status;
}

export interface UaaClientOptions {
  http: HttpClient;
  /** `links.login.href` from discovery, e.g. `https://login.cf.eu10.hana.ondemand.com`. */
  loginUrl: string;
  /** OAuth client; the CF CLI's public `cf` client with empty secret is the default. */
  clientId?: string;
  clientSecret?: string;
  now?: () => number;
  logger?: Logger;
}

/** Raw UAA `/oauth/token` grants as used by the CF CLI. */
export class UaaClient {
  private readonly http: HttpClient;
  private readonly tokenUrl: string;
  private readonly basicAuth: string;
  private readonly now: () => number;
  private readonly logger: Logger;

  constructor(opts: UaaClientOptions) {
    this.http = opts.http;
    this.tokenUrl = `${opts.loginUrl.replace(/\/+$/, '')}/oauth/token`;
    this.basicAuth = `Basic ${Buffer.from(`${opts.clientId ?? 'cf'}:${opts.clientSecret ?? ''}`).toString('base64')}`;
    this.now = opts.now ?? Date.now;
    this.logger = opts.logger ?? noopLogger;
  }

  /** Password grant; `origin` selects a custom identity provider via `login_hint`. */
  passwordGrant(p: {
    username: string;
    password: string;
    origin?: string | undefined;
  }): Promise<TokenSet> {
    const form: Record<string, string> = {
      grant_type: 'password',
      username: p.username,
      password: p.password,
    };
    if (p.origin) form['login_hint'] = JSON.stringify({ origin: p.origin });
    return this.token(form, 'login');
  }

  /** One-time passcode obtained from `{login}/passcode` (SSO). */
  passcodeGrant(passcode: string): Promise<TokenSet> {
    return this.token({ grant_type: 'password', passcode: passcode.trim() }, 'login');
  }

  refreshGrant(refreshToken: string): Promise<TokenSet> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken }, 'refresh');
  }

  private async token(form: Record<string, string>, kind: 'login' | 'refresh'): Promise<TokenSet> {
    this.logger.debug(`UAA ${form['grant_type']} grant (${kind})`);
    const res = await this.http.send({
      method: 'POST',
      url: this.tokenUrl,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        authorization: this.basicAuth,
      },
      body: new URLSearchParams(form).toString(),
    });
    if (res.status === 400 || res.status === 401) {
      const reason = describeErrorBody(res.text);
      const details = tryParseJson(res.text);
      if (kind === 'login') {
        throw new AuthError(`Login failed${reason ? `: ${reason}` : ''}`, {
          code: 'AUTH_FAILED',
          status: res.status,
          details,
        });
      }
      throw new AuthError(`Session expired, please log in again${reason ? ` (${reason})` : ''}`, {
        code: 'AUTH_REQUIRED',
        status: res.status,
        details,
      });
    }
    if (res.status < 200 || res.status >= 300) {
      throw httpStatusError(res.status, res.text, this.tokenUrl, res.headers, this.now());
    }
    return toTokenSet(parseJsonBody(res.text, tokenResponseSchema, this.tokenUrl), this.now());
  }
}

export interface TokenManagerOptions {
  uaa: UaaClient;
  store?: TokenStore;
  now?: () => number;
  /** Refresh this long before the access token expires. */
  refreshSkewMs?: number;
  logger?: Logger;
  /** No usable session: the UI must ask the user to log in; pollers should pause. */
  onAuthRequired?: (reason: AuthRequiredReason) => void;
  onChange?: (status: AuthStatus) => void;
}

/**
 * Owns the token lifecycle of one connection: hands out a valid access token, refreshes it ahead of
 * expiry with a single in-flight refresh, persists tokens through the store and reports lost sessions.
 */
export class TokenManager {
  private readonly uaa: UaaClient;
  private readonly store: TokenStore;
  private readonly now: () => number;
  private readonly skewMs: number;
  private readonly logger: Logger;
  private readonly onAuthRequired: ((reason: AuthRequiredReason) => void) | undefined;
  private readonly onChange: ((status: AuthStatus) => void) | undefined;
  private tokens: TokenSet | undefined;
  private inflight: Promise<TokenSet> | undefined;

  constructor(opts: TokenManagerOptions) {
    this.uaa = opts.uaa;
    this.store = opts.store ?? new MemoryTokenStore();
    this.now = opts.now ?? Date.now;
    this.skewMs = opts.refreshSkewMs ?? 60_000;
    this.logger = opts.logger ?? noopLogger;
    this.onAuthRequired = opts.onAuthRequired;
    this.onChange = opts.onChange;
    this.tokens = this.store.load();
  }

  status(): AuthStatus {
    return authStatusOf(this.tokens, this.now());
  }

  /** Valid access token, refreshing when it expires within the skew window. Throws `AuthError` when logged out. */
  async getAccessToken(): Promise<string> {
    const t = this.tokens;
    if (t && t.expiresAt - this.skewMs > this.now()) return t.accessToken;
    return (await this.refresh()).accessToken;
  }

  /** Refresh regardless of expiry (after a 401 from a resource server). */
  async forceRefresh(): Promise<string> {
    return (await this.refresh()).accessToken;
  }

  async loginPassword(username: string, password: string, origin?: string): Promise<AuthStatus> {
    const tokens = await this.uaa.passwordGrant(
      origin ? { username, password, origin } : { username, password },
    );
    this.set(tokens);
    return this.status();
  }

  async loginPasscode(passcode: string): Promise<AuthStatus> {
    this.set(await this.uaa.passcodeGrant(passcode));
    return this.status();
  }

  logout(): void {
    if (this.tokens) this.set(undefined);
  }

  /** A resource server rejected a freshly refreshed token: drop the session and ask for login. */
  reportUnauthorized(): void {
    this.set(undefined);
    this.onAuthRequired?.('unauthorized');
  }

  private refresh(): Promise<TokenSet> {
    if (this.inflight) return this.inflight;
    const refreshToken = this.tokens?.refreshToken;
    if (!refreshToken) {
      this.onAuthRequired?.('no-token');
      return Promise.reject(new AuthError('Not logged in', { code: 'AUTH_REQUIRED' }));
    }
    this.inflight = this.uaa
      .refreshGrant(refreshToken)
      .then(
        (tokens) => {
          this.set(tokens);
          return tokens;
        },
        (err: unknown) => {
          if (err instanceof AuthError) {
            this.logger.warn('token refresh rejected by UAA; session dropped');
            this.set(undefined);
            this.onAuthRequired?.('refresh-failed');
          }
          throw err;
        },
      )
      .finally(() => {
        this.inflight = undefined;
      });
    return this.inflight;
  }

  private set(tokens: TokenSet | undefined): void {
    this.tokens = tokens;
    this.store.save(tokens);
    this.onChange?.(this.status());
  }
}
