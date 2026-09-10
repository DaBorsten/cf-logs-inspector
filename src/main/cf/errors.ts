/**
 * Typed error hierarchy for everything that talks to Cloud Foundry. `code` is what travels over IPC
 * (see `toIpcError` in `src/main/ipc/handle.ts`), so the renderer can branch on it without string matching.
 */

export type CfErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_FAILED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'TLS_ERROR'
  | 'BAD_RESPONSE'
  | 'INVALID_INPUT'
  | 'CANCELLED';

export interface CfErrorOptions {
  status?: number;
  details?: unknown;
  cause?: unknown;
  /** Only set for RATE_LIMITED when the server sent `Retry-After`. */
  retryAfterMs?: number;
}

export class CfError extends Error {
  readonly code: CfErrorCode;
  readonly status: number | undefined;
  readonly details: unknown;
  readonly retryAfterMs: number | undefined;

  constructor(code: CfErrorCode, message: string, opts: CfErrorOptions = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = opts.status;
    this.details = opts.details;
    this.retryAfterMs = opts.retryAfterMs;
  }

  toJSON(): { code: CfErrorCode; message: string; status?: number; details?: unknown } {
    const json: { code: CfErrorCode; message: string; status?: number; details?: unknown } = {
      code: this.code,
      message: this.message,
    };
    if (this.status !== undefined) json.status = this.status;
    if (this.details !== undefined) json.details = this.details;
    return json;
  }
}

/** 401 or a failed login/refresh. `AUTH_FAILED` = wrong credentials; `AUTH_REQUIRED` = no usable session. */
export class AuthError extends CfError {
  constructor(
    message: string,
    opts: CfErrorOptions & { code?: 'AUTH_REQUIRED' | 'AUTH_FAILED' } = {},
  ) {
    const { code, ...rest } = opts;
    super(code ?? 'AUTH_REQUIRED', message, rest);
  }
}
export class ForbiddenError extends CfError {
  constructor(message: string, opts?: CfErrorOptions) {
    super('FORBIDDEN', message, opts);
  }
}
export class NotFoundError extends CfError {
  constructor(message: string, opts?: CfErrorOptions) {
    super('NOT_FOUND', message, opts);
  }
}
export class RateLimitError extends CfError {
  constructor(message: string, opts?: CfErrorOptions) {
    super('RATE_LIMITED', message, opts);
  }
}
export class ServerError extends CfError {
  constructor(message: string, opts?: CfErrorOptions) {
    super('SERVER_ERROR', message, opts);
  }
}
export class NetworkError extends CfError {
  constructor(message: string, opts?: CfErrorOptions) {
    super('NETWORK_ERROR', message, opts);
  }
}
export class TlsError extends CfError {
  constructor(message: string, opts?: CfErrorOptions) {
    super('TLS_ERROR', message, opts);
  }
}
/** 2xx with an unparsable or unexpected body, or an unexpected status code. */
export class BadResponseError extends CfError {
  constructor(message: string, opts?: CfErrorOptions) {
    super('BAD_RESPONSE', message, opts);
  }
}
export class InvalidInputError extends CfError {
  constructor(message: string, opts?: CfErrorOptions) {
    super('INVALID_INPUT', message, opts);
  }
}
export class CancelledError extends CfError {
  constructor(message = 'Cancelled', opts?: CfErrorOptions) {
    super('CANCELLED', message, opts);
  }
}

export function isCfError(err: unknown): err is CfError {
  return err instanceof CfError;
}

// ---- response body helpers -----------------------------------------------------------------------

export function tryParseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Human-readable summary of an error body. Understands UAA (`error`, `error_description`) and
 * Cloud Controller v3 (`errors[]{title,detail}`) shapes; falls back to a trimmed text excerpt.
 */
export function describeErrorBody(text: string): string | undefined {
  const json = tryParseJson(text);
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o['errors'])) {
      const parts = (o['errors'] as unknown[])
        .map((e) => {
          if (!e || typeof e !== 'object') return undefined;
          const r = e as Record<string, unknown>;
          const title = typeof r['title'] === 'string' ? r['title'] : undefined;
          const detail = typeof r['detail'] === 'string' ? r['detail'] : undefined;
          return [title, detail].filter(Boolean).join(': ') || undefined;
        })
        .filter((s): s is string => Boolean(s));
      if (parts.length > 0) return parts.join('; ');
    }
    const desc = o['error_description'];
    const err = o['error'];
    if (typeof desc === 'string' && desc)
      return typeof err === 'string' && err ? `${err}: ${desc}` : desc;
    if (typeof err === 'string' && err) return err;
    if (typeof o['message'] === 'string') return o['message'] as string;
  }
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || /^</.test(t)) return undefined; // HTML pages are useless as messages
  return t.length > 200 ? `${t.slice(0, 200)}…` : t;
}

function parseRetryAfter(value: string | string[] | undefined, nowMs: number): number | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(v);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}

export type HeaderMap = Record<string, string | string[] | undefined>;

/** Maps a non-2xx HTTP response to a typed error. */
export function httpStatusError(
  status: number,
  body: string,
  url: string,
  headers: HeaderMap = {},
  nowMs: number = Date.now(),
): CfError {
  const summary = describeErrorBody(body);
  const details = tryParseJson(body) ?? (body ? body.slice(0, 500) : undefined);
  const where = shortUrl(url);
  const suffix = summary ? `: ${summary}` : '';
  const opts: CfErrorOptions = { status, details };
  switch (true) {
    case status === 401:
      return new AuthError(`Unauthorized (401) from ${where}${suffix}`, {
        ...opts,
        code: 'AUTH_REQUIRED',
      });
    case status === 403:
      return new ForbiddenError(`Forbidden (403) from ${where}${suffix}`, opts);
    case status === 404:
      return new NotFoundError(`Not found (404) at ${where}${suffix}`, opts);
    case status === 429: {
      const retryAfterMs = parseRetryAfter(headers['retry-after'], nowMs);
      return new RateLimitError(`Rate limited (429) by ${where}${suffix}`, {
        ...opts,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      });
    }
    case status >= 500:
      return new ServerError(`Server error (${status}) from ${where}${suffix}`, opts);
    default:
      return new BadResponseError(`Unexpected HTTP ${status} from ${where}${suffix}`, opts);
  }
}

// ---- transport error mapping ---------------------------------------------------------------------

const TLS_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_SIGNATURE_FAILURE',
  'CERT_UNTRUSTED',
  'CERT_REVOKED',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'HOSTNAME_MISMATCH',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'EPROTO',
]);

/** Walks `code` through the `cause` chain (undici wraps socket errors). */
export function errorCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === 'object'; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

function isAbort(err: unknown, code: string | undefined): boolean {
  return (
    code === 'UND_ERR_ABORTED' ||
    code === 'ABORT_ERR' ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

/** Maps a thrown transport error (undici / net / tls) to `TlsError`, `NetworkError` or `CancelledError`. */
export function mapNetworkError(err: unknown, url: string): CfError {
  if (isCfError(err)) return err;
  const code = errorCode(err);
  const where = shortUrl(url);
  const message = err instanceof Error ? err.message : String(err);
  if (isAbort(err, code))
    return new CancelledError(`Request to ${where} was cancelled`, { cause: err });
  if (code && (TLS_CODES.has(code) || code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL'))) {
    return new TlsError(`TLS error connecting to ${where} (${code}): ${message}`, {
      cause: err,
      details: { code },
    });
  }
  return new NetworkError(`Network error for ${where}${code ? ` (${code})` : ''}: ${message}`, {
    cause: err,
    details: code ? { code } : undefined,
  });
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}
