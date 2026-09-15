import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateStatus } from '@shared/model/update';
import { invoke } from '../api/client';
import { qk } from './keys';

export function useAppInfo() {
  return useQuery({
    queryKey: qk.appInfo,
    queryFn: () => invoke('app:info', undefined),
    staleTime: Infinity,
  });
}

export function useUpdateStatus(enabled = true) {
  return useQuery({
    queryKey: qk.updateStatus,
    queryFn: () => invoke('update:status', undefined),
    enabled,
  });
}

function useSetUpdateStatus() {
  const qc = useQueryClient();
  return (status: UpdateStatus) => qc.setQueryData(qk.updateStatus, status);
}

export function useCheckForUpdate() {
  const setStatus = useSetUpdateStatus();
  return useMutation({
    mutationFn: () => invoke('update:check', undefined),
    onSuccess: setStatus,
  });
}

export function useDownloadUpdate() {
  const setStatus = useSetUpdateStatus();
  return useMutation({
    mutationFn: () => invoke('update:download', undefined),
    onSuccess: setStatus,
  });
}

export function useInstallUpdate() {
  return useMutation({
    mutationFn: () => invoke('update:install', undefined),
  });
}
