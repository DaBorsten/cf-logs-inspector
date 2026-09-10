/**
 * A log session is one app being streamed into the current workspace. The row lives in `log_sessions`;
 * the live state (running / backoff / paused) comes from the stream manager and is not persisted.
 */
export type SessionStatus = 'stopped' | 'running' | 'backoff' | 'paused-auth';

export interface LogSession {
  id: number;
  name: string;
  connectionId: string;
  orgGuid?: string;
  orgName?: string;
  spaceGuid?: string;
  spaceName?: string;
  appGuid: string;
  appName: string;
  createdAt: number;
  /** Timestamp (ns) of the newest stored entry; the poller resumes from here. */
  lastTsNs?: string;
  status: SessionStatus;
  entryCount: number;
  /** Poll interval used while running. */
  pollIntervalMs: number;
  lastError?: { code: string; message: string };
}

export interface SessionCreateInput {
  connectionId: string;
  appGuid: string;
  appName: string;
  orgGuid?: string;
  orgName?: string;
  spaceGuid?: string;
  spaceName?: string;
  /** Defaults to `<appName>`. */
  name?: string;
  pollIntervalMs?: number;
}

export interface SessionStartInput {
  sessionId: number;
  /** Backfill with the newest 1000 lines first (`cf logs --recent`). Default false. */
  recent?: boolean;
}

/** `stream:batch` push event: counts only, the renderer re-queries what it shows. */
export interface StreamBatchEvent {
  sessionId: number;
  inserted: number;
  totalCount: number;
  /** Highest `log_entries.id` in the workspace after this batch. */
  latestId: number;
}

/** `stream:status` push event. */
export interface StreamStatusEvent {
  sessionId: number;
  status: SessionStatus;
  cursorNs?: string;
  lastError?: { code: string; message: string };
  retryInMs?: number;
}

export const DEFAULT_POLL_INTERVAL_MS = 1000;
export const POLL_INTERVALS_MS = [1000, 2000, 5000, 10_000, 30_000] as const;

/** `session:range` result. */
export interface SessionRange {
  minTsNs: string;
  maxTsNs: string;
  count: number;
}
