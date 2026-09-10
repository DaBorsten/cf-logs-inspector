/** Entry query contract between renderer and main (see docs/DEVELOPMENT_PLAN.md "IPC contract"). */

export type TimeUnit = 'm' | 'h' | 'd';

export type TimeFilter =
  /** Last `amount` units relative to now (resolved in main at query time). */
  | { kind: 'relative'; amount: number; unit: TimeUnit }
  /** Inclusive `fromMs`, exclusive `toMs`; either side optional. */
  | { kind: 'absolute'; fromMs?: number; toMs?: number };

export interface SortSpec {
  /** Fixed field name/alias or a dynamic property name. */
  key: string;
  dir: 'asc' | 'desc';
}

export const DEFAULT_SORT: readonly SortSpec[] = [{ key: 'timestamp', dir: 'desc' }];
export const MAX_PAGE_SIZE = 1000;

export interface EntryQuery {
  /** Scope; omitted = whole workspace. */
  sessionIds?: number[];
  /** DQL query; parsed and compiled in main. */
  dql?: string;
  time?: TimeFilter;
  /** Default: timestamp desc; `id` is always appended as tiebreaker. */
  sort?: SortSpec[];
  /** Rows with id > snapshotId are excluded, giving stable paging while streaming. */
  snapshotId?: number;
  paging: { limit: number; offset: number };
}

export interface EntryRow {
  id: number;
  sessionId: number;
  /** Nanoseconds, decimal string. */
  tsNs: string;
  appGuid: string;
  appName: string;
  sourceType: string;
  instance: number | null;
  stream: 'OUT' | 'ERR';
  level: string | null;
  message: string;
  isJson: boolean;
  /** Parsed JSON payload for dynamic columns; null for plain text lines. */
  props: Record<string, unknown> | null;
}

export interface EntryDetail extends EntryRow {
  raw: string;
}

export interface EntryPage {
  rows: EntryRow[];
  limit: number;
  offset: number;
}

export interface EntryCount {
  /** Matching rows (respecting `snapshotId` when given). */
  total: number;
  /** Highest matching id ignoring `snapshotId`; `> snapshotId` means new entries arrived. */
  maxId: number;
}

export interface EntryCountQuery {
  sessionIds?: number[];
  dql?: string;
  time?: TimeFilter;
  snapshotId?: number;
}

/** Distinct values of a field for autocomplete. Text fields (message, raw) are not enumerable. */
export interface ValuesQuery {
  field: string;
  /** Case-insensitive prefix filter. */
  prefix?: string;
  sessionIds?: number[];
  time?: TimeFilter;
  /** Default 50, max 500. */
  limit?: number;
}

export interface PropInfo {
  key: string;
  /** JSON type or `mixed`. */
  type: string;
  count: number;
  sample: string | null;
}
