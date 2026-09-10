import { z } from 'zod';
import type { LogEnvelope } from '@shared/model/log';
import { getJsonWithAuth } from './authorized';
import type { HttpClient } from './http';
import type { TokenManager } from './uaa';
import { noopLogger, type Logger } from '../log';

/** Log Cache caps `limit` at 1000 (`cf logs --recent` uses exactly this). */
export const LOG_CACHE_MAX_LIMIT = 1000;

const envelopeSchema = z
  .object({
    timestamp: z.union([z.string(), z.number()]).transform(String),
    source_id: z.string().default(''),
    instance_id: z.string().default(''),
    tags: z.record(z.string(), z.string()).default({}),
    log: z
      .object({ payload: z.string().default(''), type: z.string().default('OUT') })
      .loose()
      .optional(),
  })
  .loose();

const readResponseSchema = z.object({
  envelopes: z
    .object({ batch: z.array(envelopeSchema).default([]) })
    .loose()
    .optional(),
});

export interface LogCacheReadOptions {
  /** Inclusive lower bound, ns. */
  startTimeNs?: string | bigint;
  /** Exclusive upper bound, ns. */
  endTimeNs?: string | bigint;
  /** 1..1000, default 1000. */
  limit?: number;
  /** Newest first (used for `--recent`). */
  descending?: boolean;
  signal?: AbortSignal;
}

export interface LogCacheClientOptions {
  http: HttpClient;
  /** `links.log_cache.href`, e.g. `https://log-cache.cf.eu10.hana.ondemand.com`. */
  baseUrl: string;
  tokens: TokenManager;
  logger?: Logger;
}

/** Compares two nanosecond timestamps given as decimal strings. */
export function compareNs(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function decodePayload(base64: string): string {
  try {
    return Buffer.from(base64, 'base64').toString('utf8');
  } catch {
    return base64;
  }
}

/** `GET {log_cache}/api/v1/read/<source-id>` returning only LOG envelopes with decoded payloads. */
export class LogCacheClient {
  private readonly http: HttpClient;
  private readonly base: string;
  private readonly tokens: TokenManager;
  private readonly logger: Logger;

  constructor(opts: LogCacheClientOptions) {
    this.http = opts.http;
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.tokens = opts.tokens;
    this.logger = opts.logger ?? noopLogger;
  }

  readUrl(sourceId: string, opts: LogCacheReadOptions = {}): string {
    const q = new URLSearchParams({ envelope_types: 'LOG' });
    q.set(
      'limit',
      String(Math.min(Math.max(opts.limit ?? LOG_CACHE_MAX_LIMIT, 1), LOG_CACHE_MAX_LIMIT)),
    );
    if (opts.startTimeNs !== undefined) q.set('start_time', String(opts.startTimeNs));
    if (opts.endTimeNs !== undefined) q.set('end_time', String(opts.endTimeNs));
    if (opts.descending) q.set('descending', 'true');
    return `${this.base}/api/v1/read/${encodeURIComponent(sourceId)}?${q.toString()}`;
  }

  async read(sourceId: string, opts: LogCacheReadOptions = {}): Promise<LogEnvelope[]> {
    const url = this.readUrl(sourceId, opts);
    const body = await getJsonWithAuth(this.http, this.tokens, url, readResponseSchema, {
      signal: opts.signal,
      logger: this.logger,
    });
    const out: LogEnvelope[] = [];
    for (const e of body.envelopes?.batch ?? []) {
      if (!e.log) continue; // envelope_types=LOG should guarantee this, but be defensive
      const env: LogEnvelope = {
        timestampNs: e.timestamp,
        sourceId: e.source_id || sourceId,
        instanceId: e.instance_id,
        stream: e.log.type === 'ERR' ? 'ERR' : 'OUT',
        payload: decodePayload(e.log.payload),
        tags: e.tags,
      };
      if (e.tags['app_name']) env.appName = e.tags['app_name'];
      if (e.tags['source_type']) env.sourceType = e.tags['source_type'];
      out.push(env);
    }
    return out;
  }
}
