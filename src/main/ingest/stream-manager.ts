import type { AuthStatus } from '@shared/model/connection';
import {
  POLL_INTERVALS_MS,
  type LogSession,
  type SessionCreateInput,
  type SessionStatus,
  type StreamBatchEvent,
  type StreamStatusEvent,
} from '@shared/model/session';
import type { RetentionSettings } from '@shared/model/workspace';
import type { ConnectionManager } from '../cf/connection-manager';
import { InvalidInputError } from '../cf/errors';
import { LogPoller, type PollerOptions, type PollerStatus } from '../cf/poller';
import {
  clearSessionData,
  createSession,
  deleteSession,
  getSession,
  listSessions,
  setPollInterval,
  setSessionStatus,
} from '../db/repos/sessions';
import { readRetention } from '../db/settings';
import type { WorkspaceManager } from '../db/workspace-manager';
import { noopLogger, type Logger } from '../log';
import { parseEnvelope } from './parser';
import { Writer } from './writer';

export interface StreamManagerOptions {
  workspaces: WorkspaceManager;
  connections: ConnectionManager;
  onBatch?: (event: StreamBatchEvent) => void;
  onStatus?: (event: StreamStatusEvent) => void;
  retention?: RetentionSettings;
  logger?: Logger;
  now?: () => number;
  /** Test hook to inject `sleep`/`nowNs` into pollers. */
  pollerFactory?: (opts: PollerOptions) => LogPoller;
  /** Writer flush interval override (tests). */
  flushIntervalMs?: number;
}

interface Live {
  poller: LogPoller;
  connectionId: string;
  status: SessionStatus;
  lastError?: { code: string; message: string };
  cursorNs?: string;
}

function toSessionStatus(state: PollerStatus['state']): SessionStatus {
  switch (state) {
    case 'backfilling':
    case 'polling':
    case 'idle':
      return 'running';
    case 'backoff':
      return 'backoff';
    case 'paused-auth':
      return 'paused-auth';
    case 'stopped':
      return 'stopped';
  }
}

/**
 * Maps log sessions of the open workspace to running pollers. One `Writer` per open workspace batches
 * all sessions' entries. Switching workspaces stops everything first (registered as a close hook).
 */
export class StreamManager {
  private readonly workspaces: WorkspaceManager;
  private readonly connections: ConnectionManager;
  private readonly onBatch: StreamManagerOptions['onBatch'];
  private readonly onStatus: StreamManagerOptions['onStatus'];
  private readonly retention: RetentionSettings | undefined;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly pollerFactory: (opts: PollerOptions) => LogPoller;
  private readonly flushIntervalMs: number | undefined;
  private readonly live = new Map<number, Live>();
  private writerInstance: Writer | undefined;

  constructor(opts: StreamManagerOptions) {
    this.workspaces = opts.workspaces;
    this.connections = opts.connections;
    this.onBatch = opts.onBatch;
    this.onStatus = opts.onStatus;
    this.retention = opts.retention;
    this.logger = opts.logger ?? noopLogger;
    this.now = opts.now ?? Date.now;
    this.pollerFactory = opts.pollerFactory ?? ((o) => new LogPoller(o));
    this.flushIntervalMs = opts.flushIntervalMs;
    this.workspaces.onBeforeClose(() => this.stopAll());
  }

  // ---- sessions -------------------------------------------------------------------------------

  list(): LogSession[] {
    return listSessions(this.workspaces.db()).map((s) => this.merge(s));
  }

  get(sessionId: number): LogSession {
    return this.merge(getSession(this.workspaces.db(), sessionId));
  }

  create(input: SessionCreateInput): LogSession {
    this.connections.get(input.connectionId); // validates the connection exists
    if (input.pollIntervalMs !== undefined) validateInterval(input.pollIntervalMs);
    return this.merge(createSession(this.workspaces.db(), input, this.now()));
  }

  /** Starts (or resumes from `last_ts_ns`) a session's poller. No-op when already running. */
  async start(sessionId: number, recent = false): Promise<LogSession> {
    if (this.live.has(sessionId)) return this.get(sessionId);
    const db = this.workspaces.db();
    const session = getSession(db, sessionId);
    const runtime = await this.connections.runtime(session.connectionId);
    const fromNs =
      !recent && session.lastTsNs ? (BigInt(session.lastTsNs) + 1n).toString() : undefined;
    const pollerOpts: PollerOptions = {
      logCache: runtime.logCache,
      sourceId: session.appGuid,
      recent,
      pollIntervalMs: session.pollIntervalMs,
      logger: this.logger,
      onBatch: async (envelopes) => {
        const parsed = envelopes.map((e) =>
          parseEnvelope(e, { appGuid: session.appGuid, appName: session.appName }),
        );
        await this.writer().enqueue(sessionId, parsed);
      },
      onStatus: (status) => this.handlePollerStatus(sessionId, status),
    };
    if (fromNs !== undefined) pollerOpts.fromNs = fromNs;
    const poller = this.pollerFactory(pollerOpts);
    const entry: Live = { poller, connectionId: session.connectionId, status: 'running' };
    this.live.set(sessionId, entry);
    setSessionStatus(db, sessionId, 'running');
    this.onStatus?.({ sessionId, status: 'running' });
    void poller.start().finally(() => {
      if (this.live.get(sessionId) === entry) this.live.delete(sessionId);
    });
    this.logger.info(
      `session ${sessionId} (${session.appName}) started${recent ? ' with --recent' : ''}`,
    );
    return this.get(sessionId);
  }

  async stop(sessionId: number): Promise<LogSession> {
    const entry = this.live.get(sessionId);
    if (entry) {
      await entry.poller.stop();
      this.live.delete(sessionId);
      this.writerInstance?.flush();
      this.logger.info(`session ${sessionId} stopped`);
    }
    const db = this.workspaces.db();
    setSessionStatus(db, sessionId, 'stopped');
    return this.get(sessionId);
  }

  /** Persists a new poll interval; a running session is restarted (resuming from its cursor). */
  async setInterval(sessionId: number, pollIntervalMs: number): Promise<LogSession> {
    validateInterval(pollIntervalMs);
    setPollInterval(this.workspaces.db(), sessionId, pollIntervalMs);
    if (this.live.has(sessionId)) {
      await this.stop(sessionId);
      return this.start(sessionId);
    }
    return this.get(sessionId);
  }

  /** Stops the session and deletes its entries; the session itself and its settings remain. */
  async clear(sessionId: number): Promise<LogSession> {
    await this.stop(sessionId);
    clearSessionData(this.workspaces.db(), sessionId);
    return this.get(sessionId);
  }

  async delete(sessionId: number): Promise<void> {
    const entry = this.live.get(sessionId);
    if (entry) {
      await entry.poller.stop();
      this.live.delete(sessionId);
      this.writerInstance?.flush();
    }
    deleteSession(this.workspaces.db(), sessionId);
  }

  /** Stops all pollers and flushes/closes the writer (workspace switch, shutdown). */
  async stopAll(): Promise<void> {
    const entries = [...this.live.entries()];
    this.live.clear();
    await Promise.all(entries.map(([, e]) => e.poller.stop()));
    if (this.writerInstance) {
      this.writerInstance.close();
      this.writerInstance = undefined;
    }
    try {
      const db = this.workspaces.db();
      for (const [id] of entries) setSessionStatus(db, id, 'stopped');
    } catch {
      /* workspace already closed */
    }
  }

  /** Pollers paused for authentication continue once the connection is logged in again. */
  handleAuthChanged(connectionId: string, status: AuthStatus): void {
    if (!status.loggedIn) return;
    for (const e of this.live.values()) {
      if (e.connectionId === connectionId && e.status === 'paused-auth') e.poller.resume();
    }
  }

  /** Live status view for tests/diagnostics. */
  runningIds(): number[] {
    return [...this.live.keys()];
  }

  // ---- internals ------------------------------------------------------------------------------

  private writer(): Writer {
    if (!this.writerInstance) {
      const opts: ConstructorParameters<typeof Writer>[0] = {
        db: this.workspaces.db(),
        logger: this.logger,
        onBatch: (ev) => this.onBatch?.(ev),
      };
      // Fixed limits (tests) or the workspace's kv settings, read on every flush.
      opts.retention = this.retention ?? (() => readRetention(this.workspaces.db()));
      if (this.flushIntervalMs !== undefined) opts.flushIntervalMs = this.flushIntervalMs;
      this.writerInstance = new Writer(opts);
    }
    return this.writerInstance;
  }

  private handlePollerStatus(sessionId: number, status: PollerStatus): void {
    const entry = this.live.get(sessionId);
    if (!entry) return;
    const next = toSessionStatus(status.state);
    if (status.state === 'stopped' && entry.status === 'running') {
      // Poller ended on its own (should not happen); reflect it.
    }
    const changed = next !== entry.status || status.lastError?.message !== entry.lastError?.message;
    entry.status = next;
    if (status.lastError) entry.lastError = status.lastError;
    else delete entry.lastError;
    if (status.cursorNs) entry.cursorNs = status.cursorNs;
    if (!changed) return;
    if (next !== 'stopped') {
      try {
        setSessionStatus(this.workspaces.db(), sessionId, next);
      } catch {
        /* workspace closed underneath us */
      }
    }
    const ev: StreamStatusEvent = { sessionId, status: next };
    if (entry.cursorNs) ev.cursorNs = entry.cursorNs;
    if (entry.lastError) ev.lastError = entry.lastError;
    if (status.retryInMs !== undefined) ev.retryInMs = status.retryInMs;
    this.onStatus?.(ev);
  }

  private merge(session: LogSession): LogSession {
    const live = this.live.get(session.id);
    if (!live) return { ...session, status: 'stopped' };
    const merged: LogSession = { ...session, status: live.status };
    if (live.lastError) merged.lastError = live.lastError;
    return merged;
  }
}

function validateInterval(ms: number): void {
  if (!Number.isInteger(ms) || ms < 250 || ms > 300_000) {
    throw new InvalidInputError(
      `Poll interval must be between 250 and 300000 ms (suggested: ${POLL_INTERVALS_MS.join(', ')})`,
    );
  }
}
