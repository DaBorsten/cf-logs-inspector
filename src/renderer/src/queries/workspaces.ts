import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '../api/client';
import { qk } from './keys';

export function useWorkspaces() {
  return useQuery({ queryKey: qk.workspaces, queryFn: () => invoke('workspace:list', undefined) });
}

export function useCurrentWorkspace() {
  return useQuery({
    queryKey: qk.currentWorkspace,
    queryFn: () => invoke('workspace:current', undefined),
  });
}

export function useWorkspaceStats(enabled = true) {
  return useQuery({
    queryKey: qk.workspaceStats,
    queryFn: () => invoke('workspace:stats', undefined),
    enabled,
    refetchInterval: 5000,
  });
}

/** Invalidate everything that depends on the open workspace. */
export function useInvalidateWorkspace() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.workspaces }),
      qc.invalidateQueries({ queryKey: qk.currentWorkspace }),
      qc.invalidateQueries({ queryKey: qk.workspaceStats }),
      qc.invalidateQueries({ queryKey: qk.sessions }),
      qc.invalidateQueries({ queryKey: qk.entries }),
      qc.invalidateQueries({ queryKey: qk.props }),
    ]);
}

export function useCreateWorkspace() {
  const invalidate = useInvalidateWorkspace();
  return useMutation({
    mutationFn: (name: string) => invoke('workspace:create', { name }),
    onSuccess: () => invalidate(),
  });
}

export function useOpenWorkspace() {
  const invalidate = useInvalidateWorkspace();
  return useMutation({
    mutationFn: (id: string) => invoke('workspace:open', { id }),
    onSuccess: () => invalidate(),
  });
}

/** Native file picker followed by `workspace:openFile`; resolves null when the user cancelled. */
export function useOpenWorkspaceFile() {
  const invalidate = useInvalidateWorkspace();
  return useMutation({
    mutationFn: async () => {
      const path = await invoke('workspace:pickFile', undefined);
      if (!path) return null;
      return invoke('workspace:openFile', { path });
    },
    onSuccess: () => invalidate(),
  });
}

export function useDeleteWorkspace() {
  const invalidate = useInvalidateWorkspace();
  return useMutation({
    mutationFn: (id: string) => invoke('workspace:delete', { id }),
    onSuccess: () => invalidate(),
  });
}

export function useRevealWorkspace() {
  return useMutation({ mutationFn: (id: string) => invoke('workspace:reveal', { id }) });
}
