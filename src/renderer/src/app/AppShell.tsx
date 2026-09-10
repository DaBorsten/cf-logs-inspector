import * as React from 'react';
import { Database } from 'lucide-react';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/misc';
import { ConnectionEditorDialog } from '../features/connections/ConnectionEditorDialog';
import { LoginDialog } from '../features/connections/LoginDialog';
import { LogView } from '../features/log-table/LogView';
import { WorkspaceDialog } from '../features/workspaces/WorkspaceDialog';
import { useCurrentWorkspace } from '../queries/workspaces';
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
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
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
  return <LogView key={workspace.id} />;
}
