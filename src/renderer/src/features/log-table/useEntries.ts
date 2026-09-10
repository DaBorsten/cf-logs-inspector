import * as React from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { EntryCountQuery, EntryRow, SortSpec } from '@shared/model/query';
import { invoke } from '../../api/client';
import { qk } from '../../queries/keys';

export const PAGE_SIZE = 200;

/** Everything that defines the result set except the snapshot. */
export interface EntryScope extends EntryCountQuery {
  sort: SortSpec[];
}

export function scopeKey(scope: EntryScope): string {
  return JSON.stringify({
    dql: scope.dql ?? '',
    sessionIds: scope.sessionIds ?? null,
    time: scope.time ?? null,
    sort: scope.sort,
  });
}

function countInput(scope: EntryScope, snapshotId?: number): EntryCountQuery {
  const q: EntryCountQuery = {};
  if (scope.dql) q.dql = scope.dql;
  if (scope.sessionIds) q.sessionIds = scope.sessionIds;
  if (scope.time) q.time = scope.time;
  if (snapshotId !== undefined) q.snapshotId = snapshotId;
  return q;
}

/**
 * Snapshot paging: the table shows rows with `id <= snapshotId`, taken when the scope changes or the user
 * refreshes. Rows arriving after the snapshot are counted separately and surfaced as "N new entries".
 */
export function useEntrySnapshot(scope: EntryScope) {
  const key = scopeKey(scope);
  const [snapshot, setSnapshot] = React.useState<{ key: string; id: number } | null>(null);

  // Count without snapshot: total matching rows right now and the highest matching id.
  const live = useQuery({
    queryKey: [...qk.entries, 'count', key],
    queryFn: () => invoke('entries:count', countInput(scope)),
    placeholderData: keepPreviousData,
  });

  // (Re)take the snapshot whenever the scope changes, as soon as the live count for it is known.
  React.useEffect(() => {
    if (live.data && (snapshot === null || snapshot.key !== key)) {
      setSnapshot({ key, id: live.data.maxId });
    }
  }, [live.data, key, snapshot]);

  const snapshotId = snapshot?.key === key ? snapshot.id : undefined;

  const inSnapshot = useQuery({
    queryKey: [...qk.entries, 'count', key, snapshotId],
    queryFn: () => invoke('entries:count', countInput(scope, snapshotId)),
    enabled: snapshotId !== undefined,
    placeholderData: keepPreviousData,
  });

  const refresh = React.useCallback(async () => {
    const result = await live.refetch();
    if (result.data) setSnapshot({ key, id: result.data.maxId });
  }, [live, key]);

  const total = inSnapshot.data?.total ?? 0;
  const newCount =
    live.data && inSnapshot.data ? Math.max(0, live.data.total - inSnapshot.data.total) : 0;

  return {
    snapshotId,
    total,
    newCount,
    isLoading: live.isLoading || (snapshotId !== undefined && inSnapshot.isLoading),
    error: live.error ?? inSnapshot.error,
    refresh,
  };
}

/** Pages of rows within the snapshot; `rows` is the flattened list for the virtualizer. */
export function useEntryPages(scope: EntryScope, snapshotId: number | undefined) {
  const key = scopeKey(scope);
  const query = useInfiniteQuery({
    queryKey: [...qk.entries, 'pages', key, snapshotId],
    enabled: snapshotId !== undefined,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      invoke('entries:query', {
        ...countInput(scope, snapshotId),
        sort: scope.sort,
        paging: { limit: PAGE_SIZE, offset: pageParam },
      }),
    getNextPageParam: (last) =>
      last.rows.length === PAGE_SIZE ? last.offset + PAGE_SIZE : undefined,
    placeholderData: keepPreviousData,
  });
  const rows = React.useMemo<EntryRow[]>(
    () => query.data?.pages.flatMap((p) => p.rows) ?? [],
    [query.data],
  );
  return { rows, ...query };
}

/** Discovered dynamic property keys of the workspace (most frequent first). */
export function useProps(sessionIds?: number[]) {
  return useQuery({
    queryKey: [...qk.props, sessionIds ?? null],
    queryFn: () => invoke('props:list', sessionIds ? { sessionIds } : {}),
    staleTime: 10_000,
  });
}
