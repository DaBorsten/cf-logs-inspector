import * as React from 'react';
import { KeyRound, LogIn, LogOut, Pencil, Plug, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AuthMode, ConnectionProfile } from '@shared/model/connection';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { EmptyState, Spinner } from '../../components/ui/misc';
import { hostOf } from '../../lib/utils';
import {
  useAuthStatus,
  useConnections,
  useDeleteConnection,
  useLogout,
} from '../../queries/connections';
import { useUiStore } from '../../store/ui';

const AUTH_MODE_LABEL: Record<AuthMode, string> = {
  password: 'Password',
  origin: 'Custom IdP',
  passcode: 'SSO passcode',
};

export function ConnectionsPanel(): React.JSX.Element {
  const { data: connections, isLoading, error } = useConnections();
  const openEditor = useUiStore((s) => s.openConnectionEditor);
  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Connections
        </h2>
        <Button size="sm" variant="secondary" onClick={() => openEditor({ mode: 'create' })}>
          <Plus /> Add
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center p-4">
          <Spinner />
        </div>
      ) : error ? (
        <p className="p-2 text-xs text-destructive">{errorMessage(error)}</p>
      ) : !connections?.length ? (
        <EmptyState
          icon={<Plug />}
          title="No connections yet"
          description="A connection points at one Cloud Foundry API endpoint (an SAP BTP region or any other foundation)."
          action={
            <Button size="sm" onClick={() => openEditor({ mode: 'create' })}>
              <Plus /> Add connection
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="Connections">
          {connections.map((c) => (
            <ConnectionCard key={c.id} connection={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectionCard({ connection }: { connection: ConnectionProfile }): React.JSX.Element {
  const { data: auth, isLoading } = useAuthStatus(connection.id);
  const openLogin = useUiStore((s) => s.openLogin);
  const openEditor = useUiStore((s) => s.openConnectionEditor);
  const logout = useLogout();
  const del = useDeleteConnection();
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  return (
    <li className="rounded-md border bg-background p-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{connection.name}</span>
            <Badge variant="muted" title={`Login mode: ${AUTH_MODE_LABEL[connection.authMode]}`}>
              {AUTH_MODE_LABEL[connection.authMode]}
            </Badge>
          </div>
          <p
            className="truncate font-mono text-[11px] text-muted-foreground"
            title={connection.apiUrl}
          >
            {hostOf(connection.apiUrl)}
            {connection.skipSslValidation ? ' · skip SSL' : ''}
          </p>
          <div className="mt-1 text-[11px]">
            {isLoading ? (
              <span className="text-muted-foreground">Checking session…</span>
            ) : auth?.loggedIn ? (
              <span className="text-success">
                Logged in{auth.username ? ` as ${auth.username}` : ''}
                {auth.canRefresh ? '' : ' (no refresh token)'}
              </span>
            ) : (
              <span className="text-muted-foreground">Not logged in</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {auth?.loggedIn ? (
            <Button
              size="sm"
              variant="outline"
              loading={logout.isPending}
              onClick={() =>
                logout.mutate(connection.id, {
                  onSuccess: () => toast.success(`Logged out of ${connection.name}`),
                  onError: (err) => toast.error(errorMessage(err)),
                })
              }
            >
              <LogOut /> Log out
            </Button>
          ) : (
            <Button size="sm" onClick={() => openLogin(connection.id)}>
              {connection.authMode === 'passcode' ? <KeyRound /> : <LogIn />} Log in
            </Button>
          )}
          <div className="flex gap-0.5">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Edit ${connection.name}`}
              title="Edit"
              onClick={() => openEditor({ mode: 'edit', id: connection.id })}
            >
              <Pencil />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Delete ${connection.name}`}
              title="Delete"
              onClick={() => setConfirmDelete((v) => !v)}
            >
              <Trash2 className="text-destructive" />
            </Button>
          </div>
        </div>
      </div>
      {confirmDelete ? (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
          <span>Delete this connection and its stored session?</span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="destructive"
              loading={del.isPending}
              onClick={() =>
                del.mutate(connection.id, {
                  onSuccess: () => toast.success(`Connection "${connection.name}" deleted`),
                  onError: (err) => toast.error(errorMessage(err)),
                })
              }
            >
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
