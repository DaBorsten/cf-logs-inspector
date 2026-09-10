import { z } from 'zod';
import type { CfApp, CfOrg, CfSpace } from '@shared/model/cf';
import { AuthError, BadResponseError } from './errors';
import type { HttpClient } from './http';
import type { TokenManager } from './uaa';
import { noopLogger, type Logger } from '../log';

const guidRef = z.object({ data: z.object({ guid: z.string() }).nullable() });

const orgSchema = z.object({ guid: z.string(), name: z.string() });
const spaceSchema = z.object({
  guid: z.string(),
  name: z.string(),
  relationships: z.object({ organization: guidRef }),
});
const appSchema = z.object({
  guid: z.string(),
  name: z.string(),
  state: z.string(),
  relationships: z.object({ space: guidRef }),
});

interface Page<T> {
  pagination?: { next?: { href: string } | null | undefined } | undefined;
  resources: T[];
}

function pageSchema<T>(resource: z.ZodType<T>): z.ZodType<Page<T>> {
  return z.object({
    pagination: z
      .object({ next: z.object({ href: z.string() }).nullable().optional() })
      .loose()
      .optional(),
    resources: z.array(resource),
  });
}

export interface CcClientOptions {
  http: HttpClient;
  /** `links.cloud_controller_v3.href`, e.g. `https://api.cf.eu10.hana.ondemand.com/v3`. */
  v3Url: string;
  tokens: TokenManager;
  perPage?: number;
  /** Safety valve against broken `pagination.next` loops. */
  maxPages?: number;
  logger?: Logger;
}

/** Cloud Controller v3 reads needed to pick apps: orgs -> spaces -> apps, following `pagination.next`. */
export class CcClient {
  private readonly http: HttpClient;
  private readonly v3: string;
  private readonly tokens: TokenManager;
  private readonly perPage: number;
  private readonly maxPages: number;
  private readonly logger: Logger;

  constructor(opts: CcClientOptions) {
    this.http = opts.http;
    this.v3 = opts.v3Url.replace(/\/+$/, '');
    this.tokens = opts.tokens;
    this.perPage = opts.perPage ?? 200;
    this.maxPages = opts.maxPages ?? 100;
    this.logger = opts.logger ?? noopLogger;
  }

  async listOrgs(signal?: AbortSignal): Promise<CfOrg[]> {
    const rows = await this.paginate(`${this.v3}/organizations?${this.query()}`, orgSchema, signal);
    return rows.map((o) => ({ guid: o.guid, name: o.name }));
  }

  async listSpaces(orgGuid: string, signal?: AbortSignal): Promise<CfSpace[]> {
    const rows = await this.paginate(
      `${this.v3}/spaces?${this.query({ organization_guids: orgGuid })}`,
      spaceSchema,
      signal,
    );
    return rows.map((s) => ({
      guid: s.guid,
      name: s.name,
      orgGuid: s.relationships.organization.data?.guid ?? orgGuid,
    }));
  }

  async listApps(spaceGuid: string, signal?: AbortSignal): Promise<CfApp[]> {
    const rows = await this.paginate(
      `${this.v3}/apps?${this.query({ space_guids: spaceGuid })}`,
      appSchema,
      signal,
    );
    return rows.map((a) => ({
      guid: a.guid,
      name: a.name,
      state: a.state,
      spaceGuid: a.relationships.space.data?.guid ?? spaceGuid,
    }));
  }

  private query(extra: Record<string, string> = {}): string {
    return new URLSearchParams({
      ...extra,
      order_by: 'name',
      per_page: String(this.perPage),
    }).toString();
  }

  private async paginate<T>(
    firstUrl: string,
    resource: z.ZodType<T>,
    signal: AbortSignal | undefined,
  ): Promise<T[]> {
    const schema = pageSchema(resource);
    const out: T[] = [];
    let url: string | undefined = firstUrl;
    for (let page = 0; url; page++) {
      if (page >= this.maxPages) {
        throw new BadResponseError(`Gave up after ${this.maxPages} pages of ${firstUrl}`);
      }
      const body: Page<T> = await this.getWithAuth(url, schema, signal);
      out.push(...body.resources);
      url = body.pagination?.next?.href ?? undefined;
    }
    return out;
  }

  /** GET with bearer token; on 401 refresh once and retry, then drop the session if still rejected. */
  private async getWithAuth<T>(
    url: string,
    schema: z.ZodType<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const token = await this.tokens.getAccessToken();
    try {
      return await this.http.json(signal ? { url, token, signal } : { url, token }, schema);
    } catch (err) {
      if (!(err instanceof AuthError) || err.status !== 401) throw err;
      this.logger.info(`401 from ${url}; refreshing token and retrying once`);
      const fresh = await this.tokens.forceRefresh();
      try {
        return await this.http.json(
          signal ? { url, token: fresh, signal } : { url, token: fresh },
          schema,
        );
      } catch (err2) {
        if (err2 instanceof AuthError && err2.status === 401) this.tokens.reportUnauthorized();
        throw err2;
      }
    }
  }
}
