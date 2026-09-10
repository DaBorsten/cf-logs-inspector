import { useQuery } from '@tanstack/react-query';
import { invoke } from '../api/client';
import { qk } from './keys';

export function useSessions(enabled = true) {
  return useQuery({
    queryKey: qk.sessions,
    queryFn: () => invoke('session:list', undefined),
    enabled,
  });
}

export function useAppVersion() {
  return useQuery({
    queryKey: qk.version,
    queryFn: () => invoke('app:version', undefined),
    staleTime: Infinity,
  });
}
