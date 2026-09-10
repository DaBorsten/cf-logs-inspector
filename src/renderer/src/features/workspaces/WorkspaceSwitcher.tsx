import * as React from 'react';
import { Check, ChevronDown, Database, FolderOpen, Plus, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import {
  useCurrentWorkspace,
  useOpenWorkspace,
  useOpenWorkspaceFile,
  useWorkspaces,
} from '../../queries/workspaces';
import { useUiStore } from '../../store/ui';

export function WorkspaceSwitcher(): React.JSX.Element {
  const { data: current } = useCurrentWorkspace();
  const { data: workspaces } = useWorkspaces();
  const open = useOpenWorkspace();
  const openFile = useOpenWorkspaceFile();
  const setDialogOpen = useUiStore((s) => s.setWorkspaceDialogOpen);

  const switchTo = (id: string): void => {
    if (id === current?.id) return;
    open.mutate(id, {
      onSuccess: (ws) => toast.success(`Switched to workspace "${ws.name}"`),
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 font-medium"
          aria-label="Switch workspace"
        >
          <Database className="text-muted-foreground" />
          {current?.name ?? 'No workspace'}
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {(workspaces ?? []).map((ws) => (
          <DropdownMenuItem
            key={ws.id}
            disabled={!ws.exists}
            onSelect={() => switchTo(ws.id)}
            className="justify-between"
          >
            <span className="truncate">{ws.name}</span>
            {ws.id === current?.id ? (
              <Check />
            ) : !ws.exists ? (
              <span className="text-[10px] text-muted-foreground">missing</span>
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setDialogOpen(true)}>
          <Plus /> New workspace…
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            openFile.mutate(undefined, {
              onSuccess: (ws) => ws && toast.success(`Opened "${ws.name}"`),
              onError: (err) => toast.error(errorMessage(err)),
            })
          }
        >
          <FolderOpen /> Open file…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDialogOpen(true)}>
          <Settings2 /> Manage workspaces…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
