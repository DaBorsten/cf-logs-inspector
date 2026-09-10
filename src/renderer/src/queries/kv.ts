import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '../api/client';
import { useCurrentWorkspace } from './workspaces';

export function kvKey(workspaceId: string | null, key: string) {
  return ['workspace', 'kv', workspaceId, key] as const;
}

/** JSON value stored in the open workspace's kv table. */
export function useKvJson<T>(key: string, fallback: T) {
  const { data: workspace } = useCurrentWorkspace();
  const wsId = workspace?.id ?? null;
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: kvKey(wsId, key),
    queryFn: () => invoke('workspace:kvGet', { key }),
    enabled: Boolean(workspace),
    staleTime: Infinity,
  });
  let value: T = fallback;
  if (query.data) {
    try {
      value = JSON.parse(query.data) as T;
    } catch {
      value = fallback;
    }
  }
  const set = useMutation({
    mutationFn: async (next: T) => {
      const text = JSON.stringify(next);
      await invoke('workspace:kvSet', { key, value: text });
      return text;
    },
    onSuccess: (text) => qc.setQueryData(kvKey(wsId, key), text),
  });
  return { value, set: (next: T) => set.mutate(next), isLoading: query.isLoading };
}
