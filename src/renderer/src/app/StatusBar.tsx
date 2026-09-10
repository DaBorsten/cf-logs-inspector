import * as React from 'react';
import { formatCount } from '../lib/utils';
import { useAppVersion, useSessions } from '../queries/sessions';
import { useCurrentWorkspace, useWorkspaceStats } from '../queries/workspaces';

export function StatusBar(): React.JSX.Element {
  const { data: workspace } = useCurrentWorkspace();
  const { data: stats } = useWorkspaceStats(Boolean(workspace));
  const { data: sessions } = useSessions(Boolean(workspace));
  const { data: version } = useAppVersion();
  const running = sessions?.filter((s) => s.status !== 'stopped').length ?? 0;
  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t bg-card px-3 text-[11px] text-muted-foreground">
      {workspace ? (
        <>
          <span title={workspace.path} className="truncate">
            Workspace: <span className="text-foreground">{workspace.name}</span>
          </span>
          <span>
            Entries:{' '}
            <span className="text-foreground">{stats ? formatCount(stats.entries) : '…'}</span>
          </span>
          <span>
            Streams: <span className="text-foreground">{running}</span> running /{' '}
            {sessions?.length ?? 0}
          </span>
        </>
      ) : (
        <span>No workspace open</span>
      )}
      <span className="flex-1" />
      <span>v{version ?? '…'}</span>
    </footer>
  );
}
