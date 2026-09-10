import type { TimeFilter } from './query';

/** A named DQL query (plus optional time filter) stored per workspace in `saved_filters`. */
export interface SavedFilter {
  id: number;
  name: string;
  dql: string;
  timeFilter?: TimeFilter;
  createdAt: number;
  updatedAt: number;
}

/** Create (no id) or update. Saving under an existing name overwrites that filter. */
export interface SavedFilterInput {
  id?: number;
  name: string;
  dql: string;
  timeFilter?: TimeFilter;
}

/** Number of recent queries remembered per workspace (kv key `query.history`). */
export const QUERY_HISTORY_LIMIT = 50;
export const QUERY_HISTORY_KV_KEY = 'query.history';
