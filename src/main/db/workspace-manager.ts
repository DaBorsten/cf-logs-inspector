import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import type { WorkspaceInfo, WorkspaceStats } from '@shared/model/workspace';
import { InvalidInputError, NotFoundError } from '../cf/errors';
import { noopLogger, type Logger } from '../log';
import { readJsonFile, writeJsonAtomic } from '../store/json-file';
import { applyPragmas, migrate } from './schema';

export type Db = Database.Database;

const registryEntry = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  createdAt: z.number(),
  lastOpenedAt: z.number().optional(),
});
const registrySchema = z.object({
  version: z.literal(1),
  workspaces: z.array(registryEntry),
  lastOpenId: z.string().optional(),
});
type Registry = z.infer<typeof registrySchema>;
type RegistryEntry = z.infer<typeof registryEntry>;

export interface WorkspaceManagerOptions {
  /** Directory for workspace files created by the app (`<userData>/workspaces`). */
  dir: string;
  /** Registry JSON (`<userData>/workspaces.json`). */
  registryPath: string;
  logger?: Logger;
  now?: () => number;
  idFactory?: () => string;
  /** Fired after the current workspace changed (`undefined` when none is open). */
  onChange?: (workspace: WorkspaceInfo | undefined) => void;
}

export const DEFAULT_WORKSPACE_NAME = 'default';

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '') // strip combining marks left by the decomposition
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'workspace';
}

function fileSize(path: string): number {
  let total = 0;
  for (const p of [path, `${path}-wal`]) {
    try {
      total += statSync(p).size;
    } catch {
      /* missing */
    }
  }
  return total;
}

/**
 * Owns the registry of workspace files and the single open SQLite connection. Switching workspaces runs
 * the registered `beforeClose` hooks first (the stream manager stops pollers and flushes the writer).
 */
export class WorkspaceManager {
  private readonly dir: string;
  private readonly registryPath: string;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly onChange: WorkspaceManagerOptions['onChange'];
  private readonly closeHooks: (() => void | Promise<void>)[] = [];
  private registry: Registry;
  private open: { entry: RegistryEntry; db: Db } | undefined;

  constructor(opts: WorkspaceManagerOptions) {
    this.dir = opts.dir;
    this.registryPath = opts.registryPath;
    this.logger = opts.logger ?? noopLogger;
    this.now = opts.now ?? Date.now;
    this.newId = opts.idFactory ?? randomUUID;
    this.onChange = opts.onChange;
    this.registry = readJsonFile(
      this.registryPath,
      registrySchema,
      () => ({ version: 1, workspaces: [] }),
      this.logger,
    );
  }

  /** Runs before the current workspace is closed (switch, delete, shutdown). */
  onBeforeClose(hook: () => void | Promise<void>): void {
    this.closeHooks.push(hook);
  }

  // ---- registry -------------------------------------------------------------------------------

  list(): WorkspaceInfo[] {
    return this.registry.workspaces
      .map((e) => this.info(e))
      .sort(
        (a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || a.name.localeCompare(b.name),
      );
  }

  current(): WorkspaceInfo | undefined {
    return this.open ? this.info(this.open.entry) : undefined;
  }

  /** The open database; throws when no workspace is open. */
  db(): Db {
    if (!this.open) throw new InvalidInputError('No workspace is open');
    return this.open.db;
  }

  currentId(): string | undefined {
    return this.open?.entry.id;
  }

  /** Creates a new workspace file in `dir`, migrates it and opens it. */
  async create(name: string): Promise<WorkspaceInfo> {
    const trimmed = name.trim();
    if (!trimmed) throw new InvalidInputError('Workspace name is required');
    if (this.registry.workspaces.some((w) => w.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new InvalidInputError(`A workspace named "${trimmed}" already exists`);
    }
    const id = this.newId();
    mkdirSync(this.dir, { recursive: true });
    const entry: RegistryEntry = {
      id,
      name: trimmed,
      path: join(this.dir, `${slugify(trimmed)}-${id.slice(0, 8)}.sqlite`),
      createdAt: this.now(),
    };
    this.registry.workspaces.push(entry);
    this.persist();
    return this.openEntry(entry);
  }

  /** Switches to a registered workspace. */
  async openById(id: string): Promise<WorkspaceInfo> {
    const entry = this.registry.workspaces.find((w) => w.id === id);
    if (!entry) throw new NotFoundError(`Unknown workspace ${id}`);
    if (!existsSync(entry.path))
      throw new NotFoundError(`Workspace file is missing: ${entry.path}`);
    return this.openEntry(entry);
  }

  /** Registers an existing .sqlite file (or an already registered path) and opens it. */
  async openFile(path: string): Promise<WorkspaceInfo> {
    if (!isAbsolute(path)) throw new InvalidInputError('Workspace path must be absolute');
    const abs = resolve(path);
    let entry = this.registry.workspaces.find((w) => resolve(w.path) === abs);
    if (!entry) {
      if (!existsSync(abs)) throw new NotFoundError(`No such file: ${abs}`);
      entry = {
        id: this.newId(),
        name: this.uniqueName(basename(abs).replace(/\.sqlite$/i, '')),
        path: abs,
        createdAt: this.now(),
      };
      this.registry.workspaces.push(entry);
      this.persist();
    }
    return this.openEntry(entry);
  }

  /** Closes (if current) and deletes the workspace file and its registry entry. */
  async delete(id: string): Promise<void> {
    const entry = this.registry.workspaces.find((w) => w.id === id);
    if (!entry) throw new NotFoundError(`Unknown workspace ${id}`);
    if (this.open?.entry.id === id) await this.close();
    for (const p of [entry.path, `${entry.path}-wal`, `${entry.path}-shm`]) {
      try {
        unlinkSync(p);
      } catch {
        /* missing */
      }
    }
    this.registry.workspaces = this.registry.workspaces.filter((w) => w.id !== id);
    if (this.registry.lastOpenId === id) delete this.registry.lastOpenId;
    this.persist();
  }

  /** App start: reopen the last workspace, else the first existing one, else create `default`. */
  async openLastOrDefault(): Promise<WorkspaceInfo> {
    const last = this.registry.workspaces.find(
      (w) => w.id === this.registry.lastOpenId && existsSync(w.path),
    );
    if (last) return this.openEntry(last);
    const any = this.registry.workspaces.find((w) => existsSync(w.path));
    if (any) return this.openEntry(any);
    return this.create(this.uniqueName(DEFAULT_WORKSPACE_NAME));
  }

  async close(): Promise<void> {
    if (!this.open) return;
    for (const hook of this.closeHooks) await hook();
    this.open.db.close();
    this.logger.info(`workspace closed: ${this.open.entry.path}`);
    this.open = undefined;
    this.onChange?.(undefined);
  }

  // ---- data -----------------------------------------------------------------------------------

  stats(): WorkspaceStats {
    const db = this.db();
    const entry = this.open!.entry;
    const row = db
      .prepare(
        `SELECT COUNT(*) AS entries, CAST(MIN(ts_ns) AS TEXT) AS minTs, CAST(MAX(ts_ns) AS TEXT) AS maxTs FROM log_entries`,
      )
      .get() as { entries: number; minTs: string | null; maxTs: string | null };
    const sessions = db.prepare(`SELECT COUNT(*) AS n FROM log_sessions`).get() as { n: number };
    return {
      id: entry.id,
      path: entry.path,
      sizeBytes: fileSize(entry.path),
      sessions: sessions.n,
      entries: row.entries,
      minTsNs: row.minTs,
      maxTsNs: row.maxTs,
    };
  }

  kvGet(key: string): string | null {
    const row = this.db().prepare(`SELECT value FROM kv WHERE key = ?`).get(key) as
      { value: string | null } | undefined;
    return row?.value ?? null;
  }

  kvSet(key: string, value: string | null): void {
    if (value === null) this.db().prepare(`DELETE FROM kv WHERE key = ?`).run(key);
    else {
      this.db()
        .prepare(
          `INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(key, value);
    }
  }

  // ---- internals ------------------------------------------------------------------------------

  private async openEntry(entry: RegistryEntry): Promise<WorkspaceInfo> {
    if (this.open?.entry.id === entry.id) return this.info(entry);
    await this.close();
    const db = new Database(entry.path);
    try {
      applyPragmas(db);
      const version = migrate(db);
      // Sessions never survive a restart in the running state.
      db.prepare(`UPDATE log_sessions SET status = 'stopped' WHERE status <> 'stopped'`).run();
      this.logger.info(`workspace opened: ${entry.path} (schema v${version})`);
    } catch (err) {
      db.close();
      throw err;
    }
    entry.lastOpenedAt = this.now();
    this.registry.lastOpenId = entry.id;
    this.persist();
    this.open = { entry, db };
    const info = this.info(entry);
    this.onChange?.(info);
    return info;
  }

  private info(entry: RegistryEntry): WorkspaceInfo {
    const exists = existsSync(entry.path);
    const info: WorkspaceInfo = {
      id: entry.id,
      name: entry.name,
      path: entry.path,
      createdAt: entry.createdAt,
      sizeBytes: exists ? fileSize(entry.path) : 0,
      exists,
    };
    if (entry.lastOpenedAt !== undefined) info.lastOpenedAt = entry.lastOpenedAt;
    return info;
  }

  private uniqueName(base: string): string {
    const taken = new Set(this.registry.workspaces.map((w) => w.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  }

  private persist(): void {
    writeJsonAtomic(this.registryPath, this.registry);
  }
}
