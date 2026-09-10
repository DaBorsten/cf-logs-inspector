import * as React from 'react';
import { FolderOpen, FolderSearch, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { WorkspaceInfo } from '@shared/model/workspace';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { ErrorText, Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { formatBytes } from '../../lib/utils';
import {
  useCreateWorkspace,
  useCurrentWorkspace,
  useDeleteWorkspace,
  useOpenWorkspace,
  useOpenWorkspaceFile,
  useRevealWorkspace,
  useWorkspaces,
} from '../../queries/workspaces';
import { useUiStore } from '../../store/ui';

export function WorkspaceDialog(): React.JSX.Element {
  const open = useUiStore((s) => s.workspaceDialogOpen);
  const setOpen = useUiStore((s) => s.setWorkspaceDialogOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Workspaces</DialogTitle>
          <DialogDescription>
            Each workspace is one SQLite file with its own log sessions, saved filters and column
            layouts.
          </DialogDescription>
        </DialogHeader>
        <CreateWorkspaceForm />
        <WorkspaceList />
      </DialogContent>
    </Dialog>
  );
}

function CreateWorkspaceForm(): React.JSX.Element {
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState<string>();
  const create = useCreateWorkspace();
  const openFile = useOpenWorkspaceFile();

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter a name for the new workspace');
      return;
    }
    setError(undefined);
    create.mutate(name.trim(), {
      onSuccess: (ws) => {
        setName('');
        toast.success(`Workspace "${ws.name}" created and opened`);
      },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
      <div className="flex items-end gap-2">
        <Field id="ws-name" label="New workspace" className="flex-1" error={error}>
          <Input
            id="ws-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. prod-eu10"
            aria-invalid={Boolean(error)}
            autoFocus
          />
        </Field>
        <Button type="submit" loading={create.isPending}>
          Create
        </Button>
        <Button
          type="button"
          variant="outline"
          loading={openFile.isPending}
          onClick={() =>
            openFile.mutate(undefined, {
              onSuccess: (ws) => ws && toast.success(`Opened "${ws.name}"`),
              onError: (err) => toast.error(errorMessage(err)),
            })
          }
        >
          <FolderSearch /> Open file…
        </Button>
      </div>
    </form>
  );
}

function WorkspaceList(): React.JSX.Element {
  const { data: workspaces, isLoading } = useWorkspaces();
  const { data: current } = useCurrentWorkspace();
  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (!workspaces?.length)
    return <p className="text-xs text-muted-foreground">No workspaces yet.</p>;
  return (
    <ul className="flex max-h-[45vh] flex-col gap-1.5 overflow-auto pr-1" aria-label="Workspaces">
      {workspaces.map((ws) => (
        <WorkspaceRow key={ws.id} ws={ws} isCurrent={ws.id === current?.id} />
      ))}
    </ul>
  );
}

function WorkspaceRow({
  ws,
  isCurrent,
}: {
  ws: WorkspaceInfo;
  isCurrent: boolean;
}): React.JSX.Element {
  const open = useOpenWorkspace();
  const del = useDeleteWorkspace();
  const reveal = useRevealWorkspace();
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string>();

  const remove = (): void => {
    if (confirm !== ws.name) return;
    del.mutate(ws.id, {
      onSuccess: () => toast.success(`Workspace "${ws.name}" deleted`),
      onError: (err) => setError(errorMessage(err)),
    });
  };

  return (
    <li className="rounded-md border bg-card p-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{ws.name}</span>
            {isCurrent ? <Badge variant="success">current</Badge> : null}
            {!ws.exists ? <Badge variant="destructive">file missing</Badge> : null}
          </div>
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={ws.path}>
            {ws.path}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {formatBytes(ws.sizeBytes)}
            {ws.lastOpenedAt ? ` · last opened ${new Date(ws.lastOpenedAt).toLocaleString()}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isCurrent ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={!ws.exists}
              loading={open.isPending}
              onClick={() =>
                open.mutate(ws.id, { onError: (err) => toast.error(errorMessage(err)) })
              }
            >
              Open
            </Button>
          ) : null}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Reveal ${ws.name} in folder`}
            title="Reveal in folder"
            disabled={!ws.exists}
            onClick={() => reveal.mutate(ws.id)}
          >
            <FolderOpen />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Delete ${ws.name}`}
            title="Delete workspace"
            onClick={() => setConfirm(confirm === null ? '' : null)}
          >
            <Trash2 className="text-destructive" />
          </Button>
        </div>
      </div>
      {confirm !== null ? (
        <div className="mt-2 flex items-end gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2">
          <Field
            id={`confirm-${ws.id}`}
            label={
              <>
                Type <span className="font-mono">{ws.name}</span> to delete this workspace and its
                file
              </>
            }
            className="flex-1"
          >
            <Input
              id={`confirm-${ws.id}`}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoFocus
            />
          </Field>
          <Button
            variant="destructive"
            disabled={confirm !== ws.name}
            loading={del.isPending}
            onClick={remove}
          >
            Delete
          </Button>
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
        </div>
      ) : null}
      {error ? (
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}
    </li>
  );
}
