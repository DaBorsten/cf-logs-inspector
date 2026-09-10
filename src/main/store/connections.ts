import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { ConnectionInput, ConnectionProfile } from '@shared/model/connection';
import { InvalidInputError } from '../cf/errors';
import { MemoryTokenStore, type TokenSet, type TokenStore } from '../cf/uaa';
import { noopLogger, type Logger } from '../log';

/** Symmetric encryption for secrets at rest. Production uses Electron `safeStorage` (see safe-storage.ts). */
export interface Encryptor {
  isAvailable(): boolean;
  /** Plain text -> opaque string safe for JSON (base64). */
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
}

/** Fallback when the OS keychain is unavailable: tokens live in memory only and are lost on restart. */
export const memoryOnlyEncryptor: Encryptor = {
  isAvailable: () => false,
  encrypt: () => {
    throw new Error('encryption unavailable');
  },
  decrypt: () => {
    throw new Error('encryption unavailable');
  },
};

const profileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  apiUrl: z.string().min(1),
  region: z.string().optional(),
  authMode: z.enum(['password', 'origin', 'passcode']),
  origin: z.string().optional(),
  username: z.string().optional(),
  skipSslValidation: z.boolean(),
  caCertPem: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const fileSchema = z.object({
  version: z.literal(1),
  connections: z.array(profileSchema),
  /** connection id -> encrypted JSON `TokenSet`. */
  tokens: z.record(z.string(), z.string()).default({}),
});
type FileData = z.infer<typeof fileSchema>;

const tokenSetSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  tokenType: z.string(),
  expiresAt: z.number(),
  username: z.string().optional(),
});

export interface ConnectionStoreOptions {
  filePath: string;
  encryptor: Encryptor;
  now?: () => number;
  idFactory?: () => string;
  logger?: Logger;
}

/**
 * Connection profiles plus their encrypted tokens in one JSON file (`<userData>/connections.json`).
 * Writes are atomic (tmp file + rename). A corrupt file is moved aside and the store starts empty.
 */
export class ConnectionStore {
  private readonly filePath: string;
  private readonly encryptor: Encryptor;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly logger: Logger;
  private readonly memoryTokens = new Map<string, MemoryTokenStore>();
  private data: FileData;

  constructor(opts: ConnectionStoreOptions) {
    this.filePath = opts.filePath;
    this.encryptor = opts.encryptor;
    this.now = opts.now ?? Date.now;
    this.newId = opts.idFactory ?? randomUUID;
    this.logger = opts.logger ?? noopLogger;
    this.data = this.read();
  }

  list(): ConnectionProfile[] {
    return [...this.data.connections]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => compact(c) as ConnectionProfile);
  }

  get(id: string): ConnectionProfile | undefined {
    const c = this.data.connections.find((x) => x.id === id);
    return c ? (compact(c) as ConnectionProfile) : undefined;
  }

  /** Creates (no `id`) or updates a profile. Callers normalise `apiUrl` first. */
  save(input: ConnectionInput & { id?: string }): ConnectionProfile {
    validateInput(input);
    const now = this.now();
    const idx = input.id ? this.data.connections.findIndex((c) => c.id === input.id) : -1;
    if (input.id && idx < 0) throw new InvalidInputError(`Unknown connection ${input.id}`);
    const base: ConnectionProfile = {
      id: input.id ?? this.newId(),
      name: input.name.trim(),
      apiUrl: input.apiUrl,
      authMode: input.authMode,
      skipSslValidation: input.skipSslValidation,
      createdAt: idx >= 0 ? this.data.connections[idx]!.createdAt : now,
      updatedAt: now,
    };
    if (input.region) base.region = input.region;
    if (input.authMode === 'origin' && input.origin) base.origin = input.origin.trim();
    if (input.username?.trim()) base.username = input.username.trim();
    if (input.caCertPem?.trim()) base.caCertPem = input.caCertPem.trim();
    if (idx >= 0) this.data.connections[idx] = base;
    else this.data.connections.push(base);
    this.persist();
    return { ...base };
  }

  delete(id: string): boolean {
    const before = this.data.connections.length;
    this.data.connections = this.data.connections.filter((c) => c.id !== id);
    delete this.data.tokens[id];
    this.memoryTokens.delete(id);
    if (this.data.connections.length === before) return false;
    this.persist();
    return true;
  }

  /** Encrypted, persistent token store for a connection; memory-only when encryption is unavailable. */
  tokenStore(connectionId: string): TokenStore {
    if (!this.encryptor.isAvailable()) {
      let mem = this.memoryTokens.get(connectionId);
      if (!mem) {
        this.logger.warn('secure storage unavailable; tokens are kept in memory only');
        mem = new MemoryTokenStore();
        this.memoryTokens.set(connectionId, mem);
      }
      return mem;
    }
    return {
      load: (): TokenSet | undefined => {
        const cipher = this.data.tokens[connectionId];
        if (!cipher) return undefined;
        try {
          const parsed = tokenSetSchema.safeParse(JSON.parse(this.encryptor.decrypt(cipher)));
          if (parsed.success) return compact(parsed.data) as TokenSet;
        } catch (err) {
          this.logger.warn(`could not decrypt stored tokens for ${connectionId}: ${String(err)}`);
        }
        delete this.data.tokens[connectionId];
        this.persist();
        return undefined;
      },
      save: (tokens): void => {
        if (tokens) this.data.tokens[connectionId] = this.encryptor.encrypt(JSON.stringify(tokens));
        else delete this.data.tokens[connectionId];
        this.persist();
      },
    };
  }

  private read(): FileData {
    let text: string;
    try {
      text = readFileSync(this.filePath, 'utf8');
    } catch {
      return { version: 1, connections: [], tokens: {} };
    }
    try {
      return fileSchema.parse(JSON.parse(text));
    } catch (err) {
      const backup = `${this.filePath}.corrupt-${this.now()}`;
      this.logger.error(`connections file unreadable, moving to ${backup}: ${String(err)}`);
      try {
        renameSync(this.filePath, backup);
      } catch {
        /* ignore */
      }
      return { version: 1, connections: [], tokens: {} };
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    renameSync(tmp, this.filePath);
  }
}

function validateInput(input: ConnectionInput & { id?: string }): void {
  if (!input.name?.trim()) throw new InvalidInputError('Connection name is required');
  if (!input.apiUrl?.trim()) throw new InvalidInputError('API URL is required');
  if (input.authMode === 'origin' && !input.origin?.trim()) {
    throw new InvalidInputError('An identity provider origin is required for origin login');
  }
}

/** Drops `undefined` values so objects satisfy `exactOptionalPropertyTypes` and serialise compactly. */
function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
