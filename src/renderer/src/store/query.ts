import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SORT, type SortSpec, type TimeFilter } from '@shared/model/query';
import type { TimeZoneMode } from '../lib/time';

/** Auto refresh choices in ms; 0 = off. */
export const REFRESH_INTERVALS_MS = [0, 1000, 2000, 5000, 10_000, 30_000] as const;

interface QueryState {
  /** Committed DQL (what the table shows); the query bar edits a draft locally until submit. */
  dql: string;
  setDql(dql: string): void;
  sort: SortSpec[];
  setSort(sort: SortSpec[]): void;
  /** Cycle a column: asc -> desc -> default. */
  toggleSort(key: string): void;
  /** Scope to sessions; undefined = whole workspace. */
  sessionIds: number[] | undefined;
  setSessionIds(ids: number[] | undefined): void;
  time: TimeFilter | undefined;
  setTime(time: TimeFilter | undefined): void;
  tz: TimeZoneMode;
  setTz(tz: TimeZoneMode): void;
  /** Periodic refresh (0 = off). Persisted. */
  refreshIntervalMs: number;
  setRefreshIntervalMs(ms: number): void;
  /** Tail mode: apply new entries as they arrive while the view rests at the top. Persisted. */
  tail: boolean;
  setTail(tail: boolean): void;
}

export const useQueryStore = create<QueryState>()(
  persist(
    (set) => ({
      dql: '',
      setDql: (dql) => set({ dql }),
      sort: [...DEFAULT_SORT],
      setSort: (sort) => set({ sort }),
      toggleSort: (key) =>
        set((s) => {
          const current = s.sort[0];
          // The default sort state is indistinguishable from an explicit desc on its own key,
          // so treat it as "unsorted" and start the cycle at asc instead of resetting again.
          const isDefaultState =
            s.sort.length === DEFAULT_SORT.length &&
            current?.key === DEFAULT_SORT[0]?.key &&
            current?.dir === DEFAULT_SORT[0]?.dir;
          if (current?.key !== key || isDefaultState) return { sort: [{ key, dir: 'asc' }] };
          if (current.dir === 'asc') return { sort: [{ key, dir: 'desc' }] };
          return { sort: [...DEFAULT_SORT] };
        }),
      sessionIds: undefined,
      setSessionIds: (sessionIds) => set({ sessionIds }),
      time: undefined,
      setTime: (time) => set({ time }),
      tz: 'local',
      setTz: (tz) => set({ tz }),
      refreshIntervalMs: 0,
      setRefreshIntervalMs: (refreshIntervalMs) => set({ refreshIntervalMs }),
      tail: false,
      setTail: (tail) => set({ tail }),
    }),
    {
      name: 'cf-log-inspector.query',
      partialize: (s) => ({ tz: s.tz, refreshIntervalMs: s.refreshIntervalMs, tail: s.tail }),
    },
  ),
);
