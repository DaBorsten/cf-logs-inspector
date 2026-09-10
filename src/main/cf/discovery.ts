import { z } from 'zod';
import type { CfEndpoints } from '@shared/model/cf';
import { BadResponseError, InvalidInputError } from './errors';
import type { HttpClient } from './http';

/** `GET {api}/` — only the links we use; unknown links and `null` entries are tolerated. */
const rootSchema = z.object({
  links: z.record(z.string(), z.object({ href: z.string() }).loose().nullable()).default({}),
});

/**
 * Normalises user input to `scheme://host[:port][/path]`: adds `https://`, drops query/hash, trailing
 * slashes and a `/v2` or `/v3` suffix (people paste the CC URL from `cf api`).
 */
export function normalizeApiUrl(input: string): string {
  let s = input.trim();
  if (!s) throw new InvalidInputError('API URL is required');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new InvalidInputError(`Invalid API URL: ${input}`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new InvalidInputError(`API URL must use http(s): ${input}`);
  }
  if (!u.hostname) throw new InvalidInputError(`Invalid API URL: ${input}`);
  let path = u.pathname.replace(/\/+$/, '');
  path = path.replace(/\/v[23]$/, '');
  return `${u.protocol}//${u.host}${path}`;
}

/** Log Cache lives on the `log-cache.` sibling of the `api.` host when the root document does not say. */
export function guessLogCacheUrl(apiUrl: string): string {
  const u = new URL(apiUrl);
  u.hostname = u.hostname.startsWith('api.')
    ? `log-cache.${u.hostname.slice(4)}`
    : `log-cache.${u.hostname}`;
  u.pathname = '';
  return stripSlash(u.toString());
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Resolves UAA, login, Log Cache and CC v3 URLs from the API root document. Transport/TLS/auth
 * problems propagate as `CfError`s from the HTTP client; a non-CF endpoint yields `BadResponseError`.
 */
export async function discoverEndpoints(
  http: HttpClient,
  apiUrl: string,
  signal?: AbortSignal,
): Promise<CfEndpoints> {
  const api = normalizeApiUrl(apiUrl);
  const req = signal ? { url: `${api}/`, signal } : { url: `${api}/` };
  const root = await http.json(req, rootSchema);
  const link = (name: string): string | undefined => {
    const href = root.links[name]?.href;
    return href ? stripSlash(href) : undefined;
  };
  const uaa = link('uaa') ?? link('login');
  const login = link('login') ?? uaa;
  if (!uaa || !login) {
    throw new BadResponseError(
      `${api} did not advertise a UAA/login endpoint; is this a Cloud Foundry API?`,
      {
        details: Object.keys(root.links),
      },
    );
  }
  return {
    api,
    uaa,
    login,
    logCache: link('log_cache') ?? guessLogCacheUrl(api),
    cloudControllerV3: link('cloud_controller_v3') ?? `${api}/v3`,
  };
}
