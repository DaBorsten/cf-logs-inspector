import { rootCertificates } from 'node:tls';
import { Agent, request as undiciRequest, type Dispatcher } from 'undici';
import type { z } from 'zod';
import { BadResponseError, httpStatusError, mapNetworkError, type HeaderMap } from './errors';
import { noopLogger, type Logger } from '../log';

export interface TlsOptions {
  /** Accept any server certificate (per-connection opt-in, mirrors `cf api --skip-ssl-validation`). */
  skipSslValidation?: boolean;
  /** Additional PEM CA certificate(s), appended to the system roots. */
  caCertPem?: string | undefined;
}

export interface HttpClientOptions extends TlsOptions {
  /** Inject a dispatcher (tests, proxies). When given, TLS options are ignored and the dispatcher is not closed. */
  dispatcher?: Dispatcher;
  logger?: Logger;
  /** Default per-request timeout for headers and body, ms. */
  timeoutMs?: number;
  userAgent?: string;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpRequest {
  method?: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  /** Bearer token; added as `Authorization` header. Never logged. */
  token?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: HeaderMap;
  text: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Thin wrapper over undici with one connection pool per CF connection profile so that TLS settings
 * (`skipSslValidation`, custom CA) are isolated. All transport failures surface as `CfError`s.
 */
export class HttpClient {
  private readonly dispatcher: Dispatcher;
  private readonly ownsDispatcher: boolean;
  private readonly logger: Logger;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(opts: HttpClientOptions = {}) {
    this.logger = opts.logger ?? noopLogger;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.userAgent = opts.userAgent ?? 'cf-log-inspector';
    if (opts.dispatcher) {
      this.dispatcher = opts.dispatcher;
      this.ownsDispatcher = false;
    } else {
      const connect: { rejectUnauthorized: boolean; ca?: string[] } = {
        rejectUnauthorized: !opts.skipSslValidation,
      };
      if (opts.caCertPem?.trim()) connect.ca = [...rootCertificates, opts.caCertPem];
      this.dispatcher = new Agent({ connect, connections: 8 });
      this.ownsDispatcher = true;
    }
  }

  /** Performs the request and returns the raw response; only transport errors throw. */
  async send(req: HttpRequest): Promise<HttpResponse> {
    const method = req.method ?? 'GET';
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': this.userAgent,
      ...lowerKeys(req.headers ?? {}),
    };
    if (req.token) headers['authorization'] = `Bearer ${req.token}`;
    const timeout = req.timeoutMs ?? this.timeoutMs;
    this.logger.debug(`${method} ${req.url}`);
    try {
      const res = await undiciRequest(req.url, {
        method,
        headers,
        body: req.body ?? null,
        dispatcher: this.dispatcher,
        signal: req.signal ?? null,
        headersTimeout: timeout,
        bodyTimeout: timeout,
      });
      const text = await res.body.text();
      this.logger.debug(`${method} ${req.url} -> ${res.statusCode}`);
      return { status: res.statusCode, headers: res.headers, text };
    } catch (err) {
      throw mapNetworkError(err, req.url);
    }
  }

  /** Request that must succeed with 2xx and a JSON body matching `schema`; everything else throws a `CfError`. */
  async json<T>(req: HttpRequest, schema: z.ZodType<T>): Promise<T> {
    const res = await this.send(req);
    if (res.status < 200 || res.status >= 300) {
      throw httpStatusError(res.status, res.text, req.url, res.headers);
    }
    return parseJsonBody(res.text, schema, req.url);
  }

  async close(): Promise<void> {
    if (this.ownsDispatcher) await this.dispatcher.close();
  }
}

/** Parses and validates a JSON body; malformed or unexpected content becomes `BadResponseError`. */
export function parseJsonBody<T>(text: string, schema: z.ZodType<T>, url: string): T {
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch (err) {
    throw new BadResponseError(`Response from ${url} is not JSON`, {
      cause: err,
      details: text.slice(0, 200),
    });
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new BadResponseError(`Response from ${url} has an unexpected shape`, {
      details: parsed.error.issues.slice(0, 5),
    });
  }
  return parsed.data;
}

function lowerKeys(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}
