import * as React from 'react';
import { History } from 'lucide-react';
import type { SessionStatus } from '@shared/model/session';
import { Badge } from '../../components/ui/badge';
import { EmptyState, Spinner } from '../../components/ui/misc';
import { formatCount } from '../../lib/utils';
import { useSessions } from '../../queries/sessions';
import { useCurrentWorkspace } from '../../queries/workspaces';

const STATUS_VARIANT: Record<SessionStatus, 'success' | 'muted' | 'warning' | 'destructive'> = {
  running: 'success',
  stopped: 'muted',
  backoff: 'warning',
  'paused-auth': 'destructive',
};

export function SessionsPanel(): React.JSX.Element {
  const { data: workspace } = useCurrentWorkspace();
  const { data: sessions, isLoading } = useSessions(Boolean(workspace));
  if (!workspace) return <EmptyState icon={<History />} title="No workspace open" />;
  if (isLoading) {
    return (
      <div className="flex justify-center p-4">
        <Spinner />
      </div>
    );
  }
  if (!sessions?.length) {
    return (
      <EmptyState
        icon={<History />}
        title="No log sessions yet"
        description="Every app you stream becomes a session in this workspace. Past sessions stay browsable here."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-1.5 p-2" aria-label="Sessions">
      {sessions.map((s) => (
        <li key={s.id} className="rounded-md border bg-background p-2.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{s.name}</span>
            <Badge variant={STATUS_VARIANT[s.status]}>{s.status}</Badge>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {[s.orgName, s.spaceName].filter(Boolean).join(' / ') || s.appGuid}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {formatCount(s.entryCount)} entries · created {new Date(s.createdAt).toLocaleString()}
          </p>
          {s.lastError ? (
            <p className="mt-1 text-[11px] text-destructive">{s.lastError.message}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
