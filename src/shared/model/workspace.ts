/** A workspace is one SQLite file holding log sessions, entries, saved filters and layouts. */
export interface WorkspaceInfo {
  id: string;
  name: string;
  /** Absolute path of the .sqlite file. */
  path: string;
  createdAt: number;
  lastOpenedAt?: number;
  /** File size including WAL, bytes; 0 when the file is missing. */
  sizeBytes: number;
  /** False when the registered file no longer exists on disk. */
  exists: boolean;
}

export interface WorkspaceStats {
  id: string;
  path: string;
  sizeBytes: number;
  sessions: number;
  entries: number;
  /** Oldest / newest entry timestamps (ns strings) or null when empty. */
  minTsNs: string | null;
  maxTsNs: string | null;
}

export interface RetentionSettings {
  /** Oldest rows of a session are pruned beyond this. */
  maxRowsPerSession: number;
  /** Oldest rows across the workspace are pruned beyond this. */
  maxRowsWorkspace: number;
}

export const DEFAULT_RETENTION: RetentionSettings = {
  maxRowsPerSession: 500_000,
  maxRowsWorkspace: 2_000_000,
};
