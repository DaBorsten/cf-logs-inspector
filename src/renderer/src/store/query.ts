import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SORT, type SortSpec, type TimeFilter } from '@shared/model/query';
import type { TimeZoneMode } from '../lib/time';

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
          if (current?.key !== key) return { sort: [{ key, dir: 'asc' }] };
          if (current.dir === 'asc') return { sort: [{ key, dir: 'desc' }] };
          return { sort: [...DEFAULT_SORT] };
        }),
      sessionIds: undefined,
      setSessionIds: (sessionIds) => set({ sessionIds }),
      time: undefined,
      setTime: (time) => set({ time }),
      tz: 'local',
      setTz: (tz) => set({ tz }),
    }),
    { name: 'cf-log-inspector.query', partialize: (s) => ({ tz: s.tz }) },
  ),
);
