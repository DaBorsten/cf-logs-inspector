import * as React from 'react';
import { LogIn, Play, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { CfApp } from '@shared/model/cf';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Field, Label } from '../../components/ui/field';
import { Input, NativeSelect } from '../../components/ui/input';
import { Spinner } from '../../components/ui/misc';
import { Switch } from '../../components/ui/switch';
import { appColor } from '../../lib/colors';
import { useApps, useOrgs, useSpaces } from '../../queries/cf';
import { useAuthStatus, useConnections } from '../../queries/connections';
import { useSessions, useStartStreams } from '../../queries/sessions';
import { useUiStore } from '../../store/ui';

/** Connection -> org -> space -> apps picker that creates and starts one stream per selected app. */
export function StreamPicker(): React.JSX.Element {
  const { data: connections } = useConnections();
  const picker = useUiStore((s) => s.streamPicker);
  const setPicker = useUiStore((s) => s.setStreamPicker);
  const openLogin = useUiStore((s) => s.openLogin);

  // Fall back to the first connection when the remembered one is gone.
  const connectionId =
    picker.connectionId && connections?.some((c) => c.id === picker.connectionId)
      ? picker.connectionId
      : (connections?.[0]?.id ?? null);
  const connection = connections?.find((c) => c.id === connectionId);
  const { data: auth, isLoading: authLoading } = useAuthStatus(connectionId);
  const loggedIn = Boolean(auth?.loggedIn);

  const orgs = useOrgs(connectionId, loggedIn);
  const orgGuid =
    picker.orgGuid && orgs.data?.some((o) => o.guid === picker.orgGuid) ? picker.orgGuid : null;
  const spaces = useSpaces(connectionId, orgGuid, loggedIn);
  const spaceGuid =
    picker.spaceGuid && spaces.data?.some((s) => s.guid === picker.spaceGuid)
      ? picker.spaceGuid
      : null;
  const apps = useApps(connectionId, spaceGuid, loggedIn);
  const { data: sessions } = useSessions();

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [search, setSearch] = React.useState('');
  const start = useStartStreams();

  // Selection belongs to one space; reset when the space changes.
  React.useEffect(() => {
    setSelected(new Set());
    setSearch('');
  }, [spaceGuid, connectionId]);

  const filteredApps = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = apps.data ?? [];
    return q ? list.filter((a) => a.name.toLowerCase().includes(q)) : list;
  }, [apps.data, search]);

  const runningGuids = React.useMemo(
    () =>
      new Set(
        (sessions ?? [])
          .filter((s) => s.connectionId === connectionId && s.status !== 'stopped')
          .map((s) => s.appGuid),
      ),
    [sessions, connectionId],
  );

  const toggle = (guid: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(guid)) next.delete(guid);
      else next.add(guid);
      return next;
    });

  const selectAllVisible = (): void =>
    setSelected(new Set(filteredApps.filter((a) => !runningGuids.has(a.guid)).map((a) => a.guid)));

  const startSelected = (): void => {
    if (!connectionId) return;
    const chosen = (apps.data ?? []).filter((a) => selected.has(a.guid));
    start.mutate(
      {
        connectionId,
        org: orgs.data?.find((o) => o.guid === orgGuid) ?? null,
        space: spaces.data?.find((s) => s.guid === spaceGuid) ?? null,
        apps: chosen,
        recent: picker.recent,
      },
      {
        onSuccess: (started) => {
          toast.success(`Streaming ${started.length} app${started.length === 1 ? '' : 's'}`);
          setSelected(new Set());
        },
        onError: (err) => toast.error(`Could not start stream: ${errorMessage(err)}`),
      },
    );
  };

  if (!connections?.length) return <></>;

  return (
    <div className="flex flex-col gap-3 p-3">
      <Field id="sp-connection" label="Connection">
        <NativeSelect
          id="sp-connection"
          value={connectionId ?? ''}
          onChange={(e) =>
            setPicker({ connectionId: e.target.value, orgGuid: null, spaceGuid: null })
          }
        >
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </Field>

      {authLoading ? (
        <div className="flex justify-center p-2">
          <Spinner />
        </div>
      ) : !loggedIn ? (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 p-2.5 text-xs">
          <span>Not logged in to {connection?.name ?? 'this connection'}.</span>
          <Button size="sm" onClick={() => connectionId && openLogin(connectionId)}>
            <LogIn /> Log in
          </Button>
        </div>
      ) : (
        <>
          <Field
            id="sp-org"
            label="Organization"
            error={orgs.error ? errorMessage(orgs.error) : undefined}
          >
            <NativeSelect
              id="sp-org"
              value={orgGuid ?? ''}
              disabled={orgs.isLoading}
              onChange={(e) => setPicker({ orgGuid: e.target.value || null, spaceGuid: null })}
            >
              <option value="">
                {orgs.isLoading ? 'Loading organizations…' : 'Select an organization'}
              </option>
              {(orgs.data ?? []).map((o) => (
                <option key={o.guid} value={o.guid}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field
            id="sp-space"
            label="Space"
            error={spaces.error ? errorMessage(spaces.error) : undefined}
          >
            <NativeSelect
              id="sp-space"
              value={spaceGuid ?? ''}
              disabled={!orgGuid || spaces.isLoading}
              onChange={(e) => setPicker({ spaceGuid: e.target.value || null })}
            >
              <option value="">
                {!orgGuid
                  ? 'Select an organization first'
                  : spaces.isLoading
                    ? 'Loading spaces…'
                    : 'Select a space'}
              </option>
              {(spaces.data ?? []).map((s) => (
                <option key={s.guid} value={s.guid}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>

          {spaceGuid ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="sp-search">Applications</Label>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={selectAllVisible}
                  disabled={filteredApps.length === 0}
                >
                  Select all
                </button>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute top-2 left-2 size-4 text-muted-foreground" />
                <Input
                  id="sp-search"
                  className="pl-7"
                  placeholder="Filter apps…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {apps.isLoading ? (
                <div className="flex justify-center p-2">
                  <Spinner />
                </div>
              ) : apps.error ? (
                <p className="text-xs text-destructive">{errorMessage(apps.error)}</p>
              ) : filteredApps.length === 0 ? (
                <p className="p-2 text-center text-xs text-muted-foreground">
                  {apps.data?.length ? 'No apps match the filter.' : 'This space has no apps.'}
                </p>
              ) : (
                <ul className="max-h-56 overflow-auto rounded-md border" aria-label="Applications">
                  {filteredApps.map((app) => (
                    <AppRow
                      key={app.guid}
                      app={app}
                      checked={selected.has(app.guid)}
                      running={runningGuids.has(app.guid)}
                      onToggle={() => toggle(app.guid)}
                    />
                  ))}
                </ul>
              )}
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs" htmlFor="sp-recent">
                  <Switch
                    id="sp-recent"
                    checked={picker.recent}
                    onCheckedChange={(v) => setPicker({ recent: v })}
                  />
                  Include recent logs
                </label>
                <Button
                  size="sm"
                  disabled={selected.size === 0}
                  loading={start.isPending}
                  onClick={startSelected}
                >
                  <Play /> Start {selected.size > 0 ? `(${selected.size})` : ''}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function AppRow({
  app,
  checked,
  running,
  onToggle,
}: {
  app: CfApp;
  checked: boolean;
  running: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const id = `sp-app-${app.guid}`;
  return (
    <li className="flex items-center gap-2 border-b px-2 py-1.5 text-xs last:border-b-0 hover:bg-accent/50">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="size-3.5 accent-primary"
      />
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: appColor(app.name) }}
        aria-hidden
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate">
        {app.name}
      </label>
      {running ? (
        <Badge variant="success">streaming</Badge>
      ) : app.state !== 'STARTED' ? (
        <Badge variant="muted">{app.state.toLowerCase()}</Badge>
      ) : null}
    </li>
  );
}
