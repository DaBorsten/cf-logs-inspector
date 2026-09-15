import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Filter, FilterX, X } from 'lucide-react';
import { toast } from 'sonner';
import type { EntryDetail } from '@shared/model/query';
import { errorMessage, invoke } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/ui/misc';
import { appColor } from '../../lib/colors';
import { appendClause, isFilterableField, scalarToDql } from '../../lib/dql-edit';
import { formatTimestamp, subMillisDigits } from '../../lib/time';
import { cn } from '../../lib/utils';
import { useKvJson } from '../../queries/kv';
import { qk } from '../../queries/keys';
import { useQueryStore } from '../../store/query';
import { useSelectionStore } from '../../store/selection';
import { useUiStore } from '../../store/ui';
import { Highlighted, buildHighlightTerms } from '../log-table/highlight';
import { levelClass } from '../log-table/columns';
import { JsonPlain } from './JsonPlain';
import { JsonTable } from './JsonTable';

export const DETAIL_KV_KEY = 'layout.detail';
const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 280;

const DETAIL_TAB_LABELS: Record<'message' | 'table' | 'json' | 'raw', string> = {
  message: 'Message',
  table: 'Table',
  json: 'JSON',
  raw: 'Raw',
};

export async function copyText(text: string, what = 'Copied'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(what);
  } catch (err) {
    toast.error(`Copy failed: ${errorMessage(err)}`);
  }
}

/** Bottom panel with the focused entry: message, fields, JSON tree and raw line. Height persists in kv. */
export function RowDetailPanel(): React.JSX.Element | null {
  const focusId = useSelectionStore((s) => s.selection.focus);
  const open = useSelectionStore((s) => s.detailOpen);
  const setOpen = useSelectionStore((s) => s.setDetailOpen);
  const layout = useKvJson<{ height: number }>(DETAIL_KV_KEY, { height: DEFAULT_HEIGHT });
  const [dragHeight, setDragHeight] = React.useState<number | null>(null);
  const height = dragHeight ?? Math.max(MIN_HEIGHT, layout.value.height || DEFAULT_HEIGHT);

  React.useEffect(() => {
    if (dragHeight !== null && layout.value.height === dragHeight) {
      setDragHeight(null);
    }
  }, [dragHeight, layout.value.height]);

  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;
    let next = startHeight;
    const onMove = (ev: MouseEvent): void => {
      next = Math.max(MIN_HEIGHT, startHeight + (startY - ev.clientY));
      setDragHeight(next);
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      layout.set({ height: next });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  if (!open || focusId === null) return null;
  return (
    <section
      aria-label="Entry details"
      className="flex shrink-0 flex-col border-t bg-card"
      style={{ height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize details"
        onMouseDown={startDrag}
        className="h-1.5 shrink-0 cursor-row-resize bg-border/40 hover:bg-primary/40"
      />
      <DetailBody id={focusId} onClose={() => setOpen(false)} />
    </section>
  );
}

function DetailBody({ id, onClose }: { id: number; onClose: () => void }): React.JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: [...qk.entries, 'detail', id],
    queryFn: () => invoke('entries:get', { id }),
    staleTime: Infinity,
  });
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
        <Spinner /> Loading entry {id}…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex items-center justify-between p-3 text-xs text-destructive">
        <span>{error ? errorMessage(error) : `Entry ${id} not found`}</span>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close details">
          <X />
        </Button>
      </div>
    );
  }
  return <DetailContent key={data.id} entry={data} onClose={onClose} />;
}

const FIXED_ROWS: { label: string; field: string; get: (e: EntryDetail) => unknown }[] = [
  { label: 'app', field: 'app', get: (e) => e.appName },
  { label: 'app_guid', field: 'app_guid', get: (e) => e.appGuid },
  { label: 'source_type', field: 'source_type', get: (e) => e.sourceType },
  { label: 'instance', field: 'instance', get: (e) => e.instance },
  { label: 'stream', field: 'stream', get: (e) => e.stream },
  { label: 'level', field: 'level', get: (e) => e.level },
  { label: 'session', field: 'session', get: (e) => e.sessionId },
];

function DetailContent({
  entry,
  onClose,
}: {
  entry: EntryDetail;
  onClose: () => void;
}): React.JSX.Element {
  const tz = useQueryStore((s) => s.tz);
  const dql = useQueryStore((s) => s.dql);
  const setDql = useQueryStore((s) => s.setDql);
  const terms = React.useMemo(() => buildHighlightTerms(dql), [dql]);
  const defaultDetailTab = useUiStore((s) => s.defaultDetailTab);
  const setDefaultDetailTab = useUiStore((s) => s.setDefaultDetailTab);
  const needsProps = defaultDetailTab === 'table' || defaultDetailTab === 'json';
  const tab = needsProps && !entry.props ? 'message' : defaultDetailTab;

  const filter = (field: string, value: unknown, negate: boolean): void => {
    const next = appendClause(dql, field, value, negate);
    if (next === dql) {
      toast.error('This value cannot be used as a filter');
      return;
    }
    setDql(next);
    toast.success(negate ? `Filtering out ${field}` : `Filtering for ${field}`);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs">
        <span className="font-mono tabular-nums" title={`+${subMillisDigits(entry.tsNs)} ns`}>
          {formatTimestamp(entry.tsNs, tz)}
        </span>
        <Badge
          variant="outline"
          className="border-transparent text-white"
          style={{ backgroundColor: appColor(entry.appName) }}
        >
          {entry.appName}
        </Badge>
        {entry.level ? (
          <span className={cn('font-semibold', levelClass(entry.level))}>{entry.level}</span>
        ) : null}
        <span className="text-muted-foreground">
          {entry.sourceType}
          {entry.instance !== null ? ` / ${entry.instance}` : ''} · {entry.stream} · #{entry.id}
        </span>
        <span className="flex-1" />
        <div
          className="flex items-center rounded-md border p-0.5"
          role="tablist"
          aria-label="Detail view"
        >
          {(['message', 'table', 'json', 'raw'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              disabled={(t === 'table' || t === 'json') && !entry.props}
              className={cn(
                'rounded px-2 py-0.5 text-[11px] disabled:opacity-40',
                tab === t
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setDefaultDetailTab(t)}
            >
              {DETAIL_TAB_LABELS[t]}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void copyText(entry.raw, 'Copied raw line')}
        >
          <Copy /> Raw
        </Button>
        {entry.props ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void copyText(JSON.stringify(entry.props, null, 2), 'Copied JSON')}
          >
            <Copy /> JSON
          </Button>
        ) : null}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onClose}
          aria-label="Close details"
          title="Close"
        >
          <X />
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-h-0 overflow-auto p-3" role="tabpanel">
          {tab === 'message' ? (
            <pre className="font-mono text-[12px] leading-5 break-words whitespace-pre-wrap">
              <Highlighted text={entry.message} terms={terms} />
            </pre>
          ) : tab === 'table' && entry.props ? (
            <JsonTable
              value={entry.props}
              onFilter={filter}
              onCopy={(text) => void copyText(text)}
            />
          ) : tab === 'json' && entry.props ? (
            <JsonPlain value={entry.props} />
          ) : (
            <pre className="font-mono text-[12px] leading-5 break-all whitespace-pre-wrap">
              <Highlighted text={entry.raw} terms={terms} />
            </pre>
          )}
        </div>
        <dl className="min-h-0 overflow-auto border-l p-2 text-[11px]" aria-label="Fields">
          {FIXED_ROWS.map(({ label, field, get }) => {
            const value = get(entry);
            const filterable = scalarToDql(value) !== undefined && isFilterableField(field);
            return (
              <div
                key={field}
                className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent/50"
              >
                <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
                <dd
                  className="min-w-0 flex-1 truncate font-mono"
                  title={value === null ? '' : String(value)}
                >
                  {value === null || value === undefined ? (
                    <span className="text-muted-foreground italic">null</span>
                  ) : (
                    String(value)
                  )}
                </dd>
                {filterable ? (
                  <span className="invisible flex shrink-0 gap-0.5 group-hover:visible">
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
                      aria-label={`Filter for ${field}`}
                      title="Filter for value"
                      onClick={() => filter(field, value, false)}
                    >
                      <Filter />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
                      aria-label={`Filter out ${field}`}
                      title="Filter out value"
                      onClick={() => filter(field, value, true)}
                    >
                      <FilterX />
                    </button>
                  </span>
                ) : null}
              </div>
            );
          })}
          <div className="mt-2 border-t pt-2 text-muted-foreground">
            {entry.isJson ? 'JSON payload' : 'Plain text payload'} · {entry.raw.length} chars
            {entry.message.includes('\n') ? ` · ${entry.message.split('\n').length} lines` : ''}
          </div>
        </dl>
      </div>
    </div>
  );
}
