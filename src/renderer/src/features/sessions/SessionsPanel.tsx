import * as React from 'react';
import { CalendarRange, History } from 'lucide-react';
import { toast } from 'sonner';
import type { LogSession, SessionStatus } from '@shared/model/session';
import { errorMessage, invoke } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { EmptyState, Spinner } from '../../components/ui/misc';
import { appColor } from '../../lib/colors';
import { tsNsToDate } from '../../lib/time';
import { cn, formatCount } from '../../lib/utils';
import { useSessions } from '../../queries/sessions';
import { useCurrentWorkspace } from '../../queries/workspaces';
import { useQueryStore } from '../../store/query';

const STATUS_VARIANT: Record<SessionStatus, 'success' | 'muted' | 'warning' | 'destructive'> = {
  running: 'success',
  stopped: 'muted',
  backoff: 'warning',
  'paused-auth': 'destructive',
};

/**
 * Browse past and current sessions. Click scopes the log table to the session (Ctrl-click adds/removes
 * sessions from the scope); the calendar button sets the time range to the session's stored span.
 */
export function SessionsPanel(): React.JSX.Element {
  const { data: workspace } = useCurrentWorkspace();
  const { data: sessions, isLoading } = useSessions(Boolean(workspace));
  const sessionIds = useQueryStore((s) => s.sessionIds);
  const setSessionIds = useQueryStore((s) => s.setSessionIds);

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

  const scoped = new Set(sessionIds ?? []);
  const toggle = (id: number, additive: boolean): void => {
    if (additive) {
      const next = scoped.has(id) ? [...scoped].filter((x) => x !== id) : [...scoped, id];
      setSessionIds(next.length ? next : undefined);
    } else {
      setSessionIds(scoped.has(id) && scoped.size === 1 ? undefined : [id]);
    }
  };

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Sessions
        </h2>
        {sessionIds ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px]"
            onClick={() => setSessionIds(undefined)}
          >
            Show all
          </Button>
        ) : null}
      </div>
      <ul className="flex flex-col gap-1.5" aria-label="Sessions">
        {sessions.map((s) => (
          <SessionRow key={s.id} session={s} scoped={scoped.has(s.id)} onToggle={toggle} />
        ))}
      </ul>
    </div>
  );
}

function SessionRow({
  session: s,
  scoped,
  onToggle,
}: {
  session: LogSession;
  scoped: boolean;
  onToggle: (id: number, additive: boolean) => void;
}): React.JSX.Element {
  const setTime = useQueryStore((s) => s.setTime);
  const [busy, setBusy] = React.useState(false);

  const setRange = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    setBusy(true);
    try {
      const range = await invoke('session:range', { sessionId: s.id });
      if (!range) {
        toast.info('This session has no stored entries yet');
        return;
      }
      setTime({
        kind: 'absolute',
        fromMs: tsNsToDate(range.minTsNs).getTime(),
        toMs: tsNsToDate(range.maxTsNs).getTime() + 1,
      });
      toast.success(`Time range set to ${formatCount(range.count)} entries of ${s.name}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={scoped}
        onClick={(e) => onToggle(s.id, e.ctrlKey || e.metaKey)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle(s.id, e.ctrlKey || e.metaKey);
          }
        }}
        className={cn(
          'flex cursor-pointer items-start gap-2 rounded-md border bg-background p-2.5 text-left hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          scoped && 'border-primary/60 bg-primary/10 hover:bg-primary/15',
        )}
      >
        <span
          className="mt-1 size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: appColor(s.appName) }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{s.name}</span>
            <Badge variant={STATUS_VARIANT[s.status]}>{s.status}</Badge>
            {scoped ? <Badge variant="default">scoped</Badge> : null}
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
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Set time range to ${s.name}`}
          title="Set the time range to this session's entries"
          loading={busy}
          onClick={(e) => void setRange(e)}
        >
          <CalendarRange />
        </Button>
      </div>
    </li>
  );
}
