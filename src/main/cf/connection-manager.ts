import type {
  AuthRequiredReason,
  AuthStatus,
  ConnectionInput,
  ConnectionProfile,
} from '@shared/model/connection';
import type { CfEndpoints } from '@shared/model/cf';
import { CcClient } from './cc-client';
import { discoverEndpoints, normalizeApiUrl } from './discovery';
import { NotFoundError } from './errors';
import { HttpClient, type TlsOptions } from './http';
import { authStatusOf, TokenManager, UaaClient } from './uaa';
import { noopLogger, type Logger } from '../log';
import type { ConnectionStore } from '../store/connections';

/** Everything needed to talk to one foundation; built lazily on first use and cached per profile. */
export interface ConnectionRuntime {
  profile: ConnectionProfile;
  endpoints: CfEndpoints;
  http: HttpClient;
  uaa: UaaClient;
  tokens: TokenManager;
  cc: CcClient;
}

export interface ConnectionManagerOptions {
  store: ConnectionStore;
  logger?: Logger;
  now?: () => number;
  onAuthRequired?: (connectionId: string, reason: AuthRequiredReason) => void;
  onAuthChanged?: (connectionId: string, status: AuthStatus) => void;
  /** Override for tests. */
  httpFactory?: (tls: TlsOptions) => HttpClient;
}

export type ConnectionTestInput = Pick<
  ConnectionInput,
  'apiUrl' | 'skipSslValidation' | 'caCertPem'
>;

export class ConnectionManager {
  private readonly store: ConnectionStore;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly onAuthRequired: ConnectionManagerOptions['onAuthRequired'];
  private readonly onAuthChanged: ConnectionManagerOptions['onAuthChanged'];
  private readonly httpFactory: (tls: TlsOptions) => HttpClient;
  private readonly runtimes = new Map<string, Promise<ConnectionRuntime>>();

  constructor(opts: ConnectionManagerOptions) {
    this.store = opts.store;
    this.logger = opts.logger ?? noopLogger;
    this.now = opts.now ?? Date.now;
    this.onAuthRequired = opts.onAuthRequired;
    this.onAuthChanged = opts.onAuthChanged;
    this.httpFactory =
      opts.httpFactory ?? ((tls) => new HttpClient({ ...tls, logger: this.logger }));
  }

  // ---- profiles -------------------------------------------------------------------------------

  list(): ConnectionProfile[] {
    return this.store.list();
  }

  get(id: string): ConnectionProfile {
    const p = this.store.get(id);
    if (!p) throw new NotFoundError(`Unknown connection ${id}`);
    return p;
  }

  /** Normalises the API URL, persists, and discards any cached runtime so new TLS settings take effect. */
  async save(input: ConnectionInput & { id?: string }): Promise<ConnectionProfile> {
    const profile = this.store.save({ ...input, apiUrl: normalizeApiUrl(input.apiUrl) });
    await this.dispose(profile.id);
    return profile;
  }

  async delete(id: string): Promise<void> {
    await this.dispose(id);
    this.store.delete(id);
  }

  /** Discovery with the given TLS settings; throws the mapped `CfError` when unreachable. */
  async test(input: ConnectionTestInput, signal?: AbortSignal): Promise<CfEndpoints> {
    const http = this.httpFactory(tlsOf(input));
    try {
      return await discoverEndpoints(http, input.apiUrl, signal);
    } finally {
      await http.close();
    }
  }

  // ---- auth -----------------------------------------------------------------------------------

  /** Cheap status without network: reads stored tokens when no runtime exists yet. */
  async authStatus(id: string): Promise<AuthStatus> {
    this.get(id);
    const cached = this.runtimes.get(id);
    if (cached) return (await cached).tokens.status();
    return authStatusOf(this.store.tokenStore(id).load(), this.now());
  }

  // ---- runtime --------------------------------------------------------------------------------

  /** Cached per profile; always returns a promise (unknown ids reject with NotFoundError). */
  runtime(id: string): Promise<ConnectionRuntime> {
    let p = this.runtimes.get(id);
    if (!p) {
      const profile = this.store.get(id);
      if (!profile) return Promise.reject(new NotFoundError(`Unknown connection ${id}`));
      p = this.build(profile);
      this.runtimes.set(id, p);
      p.catch(() => this.runtimes.delete(id));
    }
    return p;
  }

  private async build(profile: ConnectionProfile): Promise<ConnectionRuntime> {
    const http = this.httpFactory(tlsOf(profile));
    try {
      const endpoints = await discoverEndpoints(http, profile.apiUrl);
      this.logger.info(
        `connection ${profile.name}: uaa=${endpoints.uaa} log-cache=${endpoints.logCache}`,
      );
      const uaa = new UaaClient({
        http,
        loginUrl: endpoints.login,
        now: this.now,
        logger: this.logger,
      });
      const tokens = new TokenManager({
        uaa,
        store: this.store.tokenStore(profile.id),
        now: this.now,
        logger: this.logger,
        onAuthRequired: (reason) => this.onAuthRequired?.(profile.id, reason),
        onChange: (status) => this.onAuthChanged?.(profile.id, status),
      });
      const cc = new CcClient({
        http,
        v3Url: endpoints.cloudControllerV3,
        tokens,
        logger: this.logger,
      });
      return { profile, endpoints, http, uaa, tokens, cc };
    } catch (err) {
      await http.close();
      throw err;
    }
  }

  async dispose(id: string): Promise<void> {
    const p = this.runtimes.get(id);
    this.runtimes.delete(id);
    if (!p) return;
    const rt = await p.catch(() => undefined);
    await rt?.http.close();
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.runtimes.keys()].map((id) => this.dispose(id)));
  }
}

function tlsOf(input: ConnectionTestInput): TlsOptions {
  const tls: TlsOptions = { skipSslValidation: input.skipSslValidation };
  if (input.caCertPem) tls.caCertPem = input.caCertPem;
  return tls;
}
