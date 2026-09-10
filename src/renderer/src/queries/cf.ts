import { useQuery } from '@tanstack/react-query';
import { invoke } from '../api/client';
import { qk } from './keys';

/** Orgs of a connection; only fetched while `enabled` (i.e. logged in). */
export function useOrgs(connectionId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.orgs(connectionId ?? ''),
    queryFn: () => invoke('cf:orgs', { connectionId: connectionId! }),
    enabled: Boolean(connectionId) && enabled,
    staleTime: 60_000,
  });
}

export function useSpaces(connectionId: string | null, orgGuid: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.spaces(connectionId ?? '', orgGuid ?? ''),
    queryFn: () => invoke('cf:spaces', { connectionId: connectionId!, orgGuid: orgGuid! }),
    enabled: Boolean(connectionId && orgGuid) && enabled,
    staleTime: 60_000,
  });
}

export function useApps(connectionId: string | null, spaceGuid: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.apps(connectionId ?? '', spaceGuid ?? ''),
    queryFn: () => invoke('cf:apps', { connectionId: connectionId!, spaceGuid: spaceGuid! }),
    enabled: Boolean(connectionId && spaceGuid) && enabled,
    staleTime: 30_000,
  });
}
