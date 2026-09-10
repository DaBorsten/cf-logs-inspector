import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApiEvent } from '../api/useApiEvent';
import { useConnections } from '../queries/connections';
import { qk } from '../queries/keys';
import { useInvalidateWorkspace } from '../queries/workspaces';
import { useUiStore } from '../store/ui';

/** Bridges main-process push events into query invalidation and user notifications. Render once. */
export function ApiEvents(): null {
  const qc = useQueryClient();
  const invalidateWorkspace = useInvalidateWorkspace();
  const openLogin = useUiStore((s) => s.openLogin);
  const { data: connections } = useConnections();

  useApiEvent('workspace:changed', () => {
    void invalidateWorkspace();
  });

  useApiEvent('auth:changed', ({ connectionId, status }) => {
    qc.setQueryData(qk.auth(connectionId), status);
    void qc.invalidateQueries({ queryKey: ['cf', connectionId] });
  });

  useApiEvent('auth:required', ({ connectionId, reason }) => {
    const name = connections?.find((c) => c.id === connectionId)?.name ?? 'connection';
    const why =
      reason === 'refresh-failed'
        ? 'The session expired and could not be refreshed.'
        : reason === 'unauthorized'
          ? 'Cloud Foundry rejected the session.'
          : 'You are not logged in.';
    toast.error(`Login required for ${name}`, {
      id: `auth-required-${connectionId}`,
      description: why,
      duration: 15_000,
      action: { label: 'Log in', onClick: () => openLogin(connectionId) },
    });
    qc.setQueryData(qk.auth(connectionId), { loggedIn: false, canRefresh: false });
  });

  useApiEvent('stream:status', () => {
    void qc.invalidateQueries({ queryKey: qk.sessions });
  });

  useApiEvent('stream:batch', () => {
    void qc.invalidateQueries({ queryKey: qk.sessions });
    void qc.invalidateQueries({ queryKey: qk.workspaceStats });
    // Live counts drive the "N new entries" banner; snapshot pages stay put.
    void qc.invalidateQueries({ queryKey: [...qk.entries, 'count'] });
    void qc.invalidateQueries({ queryKey: qk.props });
  });

  return null;
}
