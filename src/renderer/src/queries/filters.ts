import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SavedFilterInput } from '@shared/model/filters';
import { invoke } from '../api/client';
import { qk } from './keys';
import { useCurrentWorkspace } from './workspaces';

export function useSavedFilters() {
  const { data: workspace } = useCurrentWorkspace();
  return useQuery({
    queryKey: [...qk.filters, workspace?.id ?? null],
    queryFn: () => invoke('filters:list', undefined),
    enabled: Boolean(workspace),
  });
}

export function useSaveFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SavedFilterInput) => invoke('filters:save', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.filters }),
  });
}

export function useDeleteFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => invoke('filters:delete', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.filters }),
  });
}
