import * as React from 'react';
import { Eraser, Pause, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { POLL_INTERVALS_MS, type LogSession, type SessionStatus } from '@shared/model/session';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { NativeSelect } from '../../components/ui/input';
import { appColor } from '../../lib/colors';
import { formatCount } from '../../lib/utils';
import { useConnections } from '../../queries/connections';
import {
  useClearSession,
  useDeleteSession,
  useSessions,
  useSetSessionInterval,
  useStartSession,
  useStopSession,
} from '../../queries/sessions';
import { useUiStore } from '../../store/ui';

const STATUS_LABEL: Record<
  SessionStatus,
  { label: string; variant: 'success' | 'muted' | 'warning' | 'destructive' }
> = {
  running: { label: 'streaming', variant: 'success' },
  stopped: { label: 'stopped', variant: 'muted' },
  backoff: { label: 'retrying', variant: 'warning' },
  'paused-auth': { label: 'login required', variant: 'destructive' },
};

function intervalLabel(ms: number): string {
  return ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`;
}

/** Sessions of the open workspace with start/stop, poll interval and clear/delete controls. */
export function StreamList(): React.JSX.Element {
  const { data: sessions } = useSessions();
  if (!sessions?.length) return <></>;
  const running = sessions.filter((s) => s.status !== 'stopped');
  const stopped = sessions.filter((s) => s.status === 'stopped');
  return (
    <div className="flex flex-col gap-2 border-t p-3">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Streams{' '}
        <span className="font-normal normal-case">
          · {running.length} running, {stopped.length} stopped
        </span>
      </h3>
      <ul className="flex flex-col gap-1.5" aria-label="Streams">
        {[...running, ...stopped].map((s) => (
          <StreamRow key={s.id} session={s} />
        ))}
      </ul>
    </div>
  );
}

function StreamRow({ session }: { session: LogSession }): React.JSX.Element {
  const { data: connections } = useConnections();
  const connectionName = connections?.find((c) => c.id === session.connectionId)?.name;
  const openLogin = useUiStore((s) => s.openLogin);
  const start = useStartSession();
  const stop = useStopSession();
  const changeInterval = useSetSessionInterval();
  const clear = useClearSession();
  const del = useDeleteSession();
  const [confirm, setConfirm] = React.useState<'clear' | 'delete' | null>(null);
  const isRunning = session.status !== 'stopped';
  const status = STATUS_LABEL[session.status];
  const busy = start.isPending || stop.isPending;
  const knownInterval = (POLL_INTERVALS_MS as readonly number[]).includes(session.pollIntervalMs);

  const onError = (err: unknown): void => {
    toast.error(errorMessage(err));
  };

  return (
    <li className="rounded-md border bg-background p-2.5">
      <div className="flex items-start gap-2">
        <span
          className="mt-1 size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: appColor(session.appName) }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium" title={session.name}>
              {session.name}
            </span>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {[connectionName, session.orgName, session.spaceName].filter(Boolean).join(' / ')}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {formatCount(session.entryCount)} entries
            {session.lastError ? (
              <span className="text-destructive"> · {session.lastError.message}</span>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {session.status === 'paused-auth' ? (
            <Button size="sm" variant="outline" onClick={() => openLogin(session.connectionId)}>
              Log in
            </Button>
          ) : null}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={isRunning ? `Stop ${session.name}` : `Start ${session.name}`}
            title={isRunning ? 'Stop streaming' : 'Resume streaming'}
            disabled={busy}
            onClick={() =>
              isRunning
                ? stop.mutate(session.id, { onError })
                : start.mutate({ sessionId: session.id }, { onError })
            }
          >
            {isRunning ? <Pause /> : <Play />}
          </Button>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <NativeSelect
          aria-label={`Poll interval for ${session.name}`}
          title="Poll interval"
          className="h-6 w-auto py-0 pr-6 text-[11px]"
          value={String(session.pollIntervalMs)}
          onChange={(e) =>
            changeInterval.mutate(
              { sessionId: session.id, pollIntervalMs: Number(e.target.value) },
              { onError },
            )
          }
        >
          {knownInterval ? null : (
            <option value={session.pollIntervalMs}>{intervalLabel(session.pollIntervalMs)}</option>
          )}
          {POLL_INTERVALS_MS.map((ms) => (
            <option key={ms} value={ms}>
              every {intervalLabel(ms)}
            </option>
          ))}
        </NativeSelect>
        <span className="flex-1" />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Clear entries of ${session.name}`}
          title="Clear stored entries"
          onClick={() => setConfirm(confirm === 'clear' ? null : 'clear')}
        >
          <Eraser />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Delete ${session.name}`}
          title="Delete session"
          onClick={() => setConfirm(confirm === 'delete' ? null : 'delete')}
        >
          <Trash2 className="text-destructive" />
        </Button>
      </div>
      {confirm ? (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
          <span>
            {confirm === 'clear'
              ? `Delete all ${formatCount(session.entryCount)} stored entries of this session?`
              : 'Delete this session and all its entries?'}
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="destructive"
              loading={clear.isPending || del.isPending}
              onClick={() =>
                confirm === 'clear'
                  ? clear.mutate(session.id, {
                      onSuccess: () => {
                        setConfirm(null);
                        toast.success(`Cleared ${session.name}`);
                      },
                      onError,
                    })
                  : del.mutate(session.id, {
                      onSuccess: () => toast.success(`Deleted session ${session.name}`),
                      onError,
                    })
              }
            >
              {confirm === 'clear' ? 'Clear' : 'Delete'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
