import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CfApp, CfOrg, CfSpace } from '@shared/model/cf';
import type { LogSession } from '@shared/model/session';
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

function useInvalidateSessions() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.sessions }),
      qc.invalidateQueries({ queryKey: qk.workspaceStats }),
    ]);
}

export interface StartStreamsInput {
  connectionId: string;
  org: CfOrg | null;
  space: CfSpace | null;
  apps: CfApp[];
  recent: boolean;
}

/**
 * Starts one stream per app: reuses the workspace's existing session for the same connection + app
 * GUID, otherwise creates one, then starts it. Sequential so errors point at a specific app.
 */
export function useStartStreams() {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: async (input: StartStreamsInput): Promise<LogSession[]> => {
      const existing = await invoke('session:list', undefined);
      const started: LogSession[] = [];
      for (const app of input.apps) {
        try {
          let session = existing.find(
            (s) => s.connectionId === input.connectionId && s.appGuid === app.guid,
          );
          if (!session) {
            session = await invoke('session:create', {
              connectionId: input.connectionId,
              appGuid: app.guid,
              appName: app.name,
              ...(input.org ? { orgGuid: input.org.guid, orgName: input.org.name } : {}),
              ...(input.space ? { spaceGuid: input.space.guid, spaceName: input.space.name } : {}),
            });
          }
          started.push(
            await invoke('session:start', { sessionId: session.id, recent: input.recent }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`${app.name}: ${message}`);
        }
      }
      return started;
    },
    onSettled: () => invalidate(),
  });
}

export function useStartSession() {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: (input: { sessionId: number; recent?: boolean }) =>
      invoke('session:start', input.recent === undefined ? { sessionId: input.sessionId } : input),
    onSettled: () => invalidate(),
  });
}

export function useStopSession() {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: (sessionId: number) => invoke('session:stop', { sessionId }),
    onSettled: () => invalidate(),
  });
}

export function useSetSessionInterval() {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: (input: { sessionId: number; pollIntervalMs: number }) =>
      invoke('session:setInterval', input),
    onSettled: () => invalidate(),
  });
}

export function useClearSession() {
  const invalidate = useInvalidateSessions();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: number) => invoke('session:clear', { sessionId }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.entries });
      return invalidate();
    },
  });
}

export function useDeleteSession() {
  const invalidate = useInvalidateSessions();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: number) => invoke('session:delete', { sessionId }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.entries });
      return invalidate();
    },
  });
}
