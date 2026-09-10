import type { z } from 'zod';
import { AuthError } from './errors';
import type { HttpClient } from './http';
import type { TokenManager } from './uaa';
import { noopLogger, type Logger } from '../log';

export interface AuthorizedGetOptions {
  signal?: AbortSignal | undefined;
  logger?: Logger;
}

/**
 * GET with a bearer token from the token manager. On 401 the token is force-refreshed once and the
 * request retried; if the resource server still says 401 the session is dropped (`reportUnauthorized`).
 * Shared by the Cloud Controller and Log Cache clients.
 */
export async function getJsonWithAuth<T>(
  http: HttpClient,
  tokens: TokenManager,
  url: string,
  schema: z.ZodType<T>,
  opts: AuthorizedGetOptions = {},
): Promise<T> {
  const logger = opts.logger ?? noopLogger;
  const req = (token: string) =>
    opts.signal ? { url, token, signal: opts.signal } : { url, token };
  const token = await tokens.getAccessToken();
  try {
    return await http.json(req(token), schema);
  } catch (err) {
    if (!(err instanceof AuthError) || err.status !== 401) throw err;
    logger.info(`401 from ${url}; refreshing token and retrying once`);
    const fresh = await tokens.forceRefresh();
    try {
      return await http.json(req(fresh), schema);
    } catch (err2) {
      if (err2 instanceof AuthError && err2.status === 401) tokens.reportUnauthorized();
      throw err2;
    }
  }
}
