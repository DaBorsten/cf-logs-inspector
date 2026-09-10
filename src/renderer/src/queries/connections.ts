import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IpcContracts } from '@shared/ipc/contracts';
import type { AuthStatus } from '@shared/model/connection';
import { invoke } from '../api/client';
import { qk } from './keys';

export function useConnections() {
  return useQuery({
    queryKey: qk.connections,
    queryFn: () => invoke('connection:list', undefined),
  });
}

export function useAuthStatus(connectionId: string | null | undefined) {
  return useQuery({
    queryKey: qk.auth(connectionId ?? ''),
    queryFn: () => invoke('auth:status', { connectionId: connectionId! }),
    enabled: Boolean(connectionId),
    staleTime: 30_000,
  });
}

export function useSaveConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: IpcContracts['connection:save']['req']) => invoke('connection:save', input),
    onSuccess: (profile) => {
      void qc.invalidateQueries({ queryKey: qk.connections });
      void qc.invalidateQueries({ queryKey: qk.auth(profile.id) });
    },
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoke('connection:delete', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.connections }),
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (input: IpcContracts['connection:test']['req']) => invoke('connection:test', input),
  });
}

function useSetAuth() {
  const qc = useQueryClient();
  return (connectionId: string, status: AuthStatus) => {
    qc.setQueryData(qk.auth(connectionId), status);
    void qc.invalidateQueries({ queryKey: ['cf', connectionId] });
  };
}

export function useLoginPassword() {
  const setAuth = useSetAuth();
  return useMutation({
    mutationFn: (input: IpcContracts['auth:loginPassword']['req']) =>
      invoke('auth:loginPassword', input),
    onSuccess: (status, input) => setAuth(input.connectionId, status),
  });
}

export function useStartPasscode() {
  const setAuth = useSetAuth();
  return useMutation({
    mutationFn: (connectionId: string) => invoke('auth:startPasscode', { connectionId }),
    onSuccess: (result, connectionId) => {
      if (result.kind === 'loggedIn') setAuth(connectionId, result.status);
    },
  });
}

export function usePasscodeLogin() {
  const setAuth = useSetAuth();
  return useMutation({
    mutationFn: (input: IpcContracts['auth:passcodeLogin']['req']) =>
      invoke('auth:passcodeLogin', input),
    onSuccess: (status, input) => setAuth(input.connectionId, status),
  });
}

export function useLogout() {
  const setAuth = useSetAuth();
  return useMutation({
    mutationFn: (connectionId: string) => invoke('auth:logout', { connectionId }),
    onSuccess: (_v, connectionId) => setAuth(connectionId, { loggedIn: false, canRefresh: false }),
  });
}
