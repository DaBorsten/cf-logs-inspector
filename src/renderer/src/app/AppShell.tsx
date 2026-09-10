import * as React from 'react';
import { Database, Table2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/misc';
import { ConnectionEditorDialog } from '../features/connections/ConnectionEditorDialog';
import { LoginDialog } from '../features/connections/LoginDialog';
import { WorkspaceDialog } from '../features/workspaces/WorkspaceDialog';
import { formatBytes, formatCount } from '../lib/utils';
import { useCurrentWorkspace, useWorkspaceStats } from '../queries/workspaces';
import { useUiStore } from '../store/ui';
import { ApiEvents } from './ApiEvents';
import { SidePanel } from './SidePanel';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';
import { useThemeEffect } from './theme';

export function AppShell(): React.JSX.Element {
  useThemeEffect();
  const sidePanelOpen = useUiStore((s) => s.sidePanelOpen);
  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {sidePanelOpen ? <SidePanel /> : null}
        <main className="min-w-0 flex-1 overflow-auto bg-background">
          <MainArea />
        </main>
      </div>
      <StatusBar />
      <WorkspaceDialog />
      <ConnectionEditorDialog />
      <LoginDialog />
      <ApiEvents />
    </div>
  );
}

function MainArea(): React.JSX.Element {
  const { data: workspace, isLoading } = useCurrentWorkspace();
  const { data: stats } = useWorkspaceStats(Boolean(workspace));
  const setWorkspaceDialogOpen = useUiStore((s) => s.setWorkspaceDialogOpen);
  if (isLoading) return <div className="p-6 text-xs text-muted-foreground">Loading workspace…</div>;
  if (!workspace) {
    return (
      <EmptyState
        className="h-full"
        icon={<Database />}
        title="No workspace is open"
        description="Logs are stored in workspace files. Create one or open an existing file to get started."
        action={<Button onClick={() => setWorkspaceDialogOpen(true)}>Manage workspaces</Button>}
      />
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <EmptyState
        icon={<Table2 />}
        title="The log table arrives with the next milestones"
        description="Add a connection, log in, and pick apps to stream. Entries are stored in the open workspace and will show up here."
      />
      {stats ? (
        <dl className="grid grid-cols-3 gap-x-8 gap-y-1 rounded-md border bg-card px-4 py-3 text-xs">
          <dt className="text-muted-foreground">Workspace</dt>
          <dt className="text-muted-foreground">Sessions</dt>
          <dt className="text-muted-foreground">Entries</dt>
          <dd className="font-medium" title={stats.path}>
            {workspace.name} · {formatBytes(stats.sizeBytes)}
          </dd>
          <dd className="font-medium">{formatCount(stats.sessions)}</dd>
          <dd className="font-medium">{formatCount(stats.entries)}</dd>
        </dl>
      ) : null}
    </div>
  );
}
