import * as React from 'react';
import { Bookmark, BookmarkPlus, Clock, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { QUERY_HISTORY_KV_KEY, QUERY_HISTORY_LIMIT, type SavedFilter } from '@shared/model/filters';
import { fixedFieldNames } from '@shared/model/fields';
import { errorMessage, invoke } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import { useDeleteFilter, useSavedFilters, useSaveFilter } from '../../queries/filters';
import { useKvJson } from '../../queries/kv';
import { useQueryStore } from '../../store/query';
import { useProps } from '../log-table/useEntries';
import { dqlDiagnostics, type CompletionDeps } from './dql-language';
import { QueryEditor } from './QueryEditor';

/**
 * Query bar: CodeMirror DQL editor with Apply, query history (kv `query.history`) and saved filters
 * (`saved_filters`). Enter/Apply commit the draft to the query store; Escape reverts to the committed query.
 */
export function QueryBar(): React.JSX.Element {
  const committed = useQueryStore((s) => s.dql);
  const setDql = useQueryStore((s) => s.setDql);
  const time = useQueryStore((s) => s.time);
  const setTime = useQueryStore((s) => s.setTime);
  const sessionIds = useQueryStore((s) => s.sessionIds);
  const [draft, setDraft] = React.useState(committed);
  const [panel, setPanel] = React.useState<'history' | 'filters' | null>(null);
  const { data: propInfos } = useProps(sessionIds);
  const history = useKvJson<string[]>(QUERY_HISTORY_KV_KEY, []);

  React.useEffect(() => setDraft(committed), [committed]);

  const diagnostic = React.useMemo(() => dqlDiagnostics(draft)[0], [draft]);
  const dirty = draft.trim() !== committed;

  const completion = React.useMemo<CompletionDeps>(
    () => ({
      fields: () => [...fixedFieldNames(), ...(propInfos ?? []).map((p) => p.key)],
      values: (field, prefix) =>
        invoke('entries:values', {
          field,
          limit: 30,
          ...(prefix ? { prefix } : {}),
          ...(sessionIds ? { sessionIds } : {}),
        }).catch(() => []),
    }),
    [propInfos, sessionIds],
  );

  const apply = React.useCallback(
    (text: string) => {
      const q = text.trim();
      if (dqlDiagnostics(q).length > 0) return;
      setDql(q);
      if (q) {
        const next = [q, ...history.value.filter((h) => h !== q)].slice(0, QUERY_HISTORY_LIMIT);
        if (next[0] !== history.value[0] || next.length !== history.value.length) history.set(next);
      }
      setPanel(null);
    },
    [setDql, history],
  );

  const applyFilter = (f: SavedFilter): void => {
    setDraft(f.dql);
    apply(f.dql);
    setTime(f.timeFilter);
  };

  return (
    <div className="relative shrink-0 border-b bg-card">
      <div className="flex items-center gap-1 px-2 py-1">
        <div
          className={cn(
            'flex min-w-0 flex-1 items-center rounded-md border border-input bg-background px-2 focus-within:ring-2 focus-within:ring-ring',
            diagnostic && 'border-destructive/60',
          )}
        >
          <QueryEditor
            value={draft}
            onChange={setDraft}
            onSubmit={() => apply(draft)}
            onCancel={() => {
              setDraft(committed);
              setPanel(null);
            }}
            completion={completion}
            placeholder="Filter with DQL, e.g. level:ERROR and not app:worker   (Enter applies, Ctrl+Space completes)"
          />
          {draft ? (
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear query"
              onClick={() => {
                setDraft('');
                setDql('');
              }}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => apply(draft)}
          disabled={Boolean(diagnostic) || !dirty}
        >
          Apply
        </Button>
        <Button
          size="icon-sm"
          variant={panel === 'history' ? 'secondary' : 'ghost'}
          aria-label="Query history"
          title="Query history"
          aria-expanded={panel === 'history'}
          onClick={() => setPanel(panel === 'history' ? null : 'history')}
        >
          <Clock />
        </Button>
        <Button
          size="icon-sm"
          variant={panel === 'filters' ? 'secondary' : 'ghost'}
          aria-label="Saved filters"
          title="Saved filters"
          aria-expanded={panel === 'filters'}
          onClick={() => setPanel(panel === 'filters' ? null : 'filters')}
        >
          <Bookmark />
        </Button>
      </div>
      {diagnostic ? (
        <p className="px-3 pb-1 text-[11px] text-destructive" role="alert">
          {diagnostic.message}
          {diagnostic.from < draft.length ? ` (position ${diagnostic.from + 1})` : ''}
        </p>
      ) : null}
      {panel === 'history' ? (
        <HistoryPanel
          items={history.value}
          onPick={(q) => {
            setDraft(q);
            apply(q);
          }}
          onClear={() => history.set([])}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel === 'filters' ? (
        <FiltersPanel
          currentDql={draft.trim()}
          currentTime={time}
          canSave={!diagnostic && draft.trim().length > 0}
          onApply={applyFilter}
          onClose={() => setPanel(null)}
        />
      ) : null}
    </div>
  );
}

function PanelFrame({
  title,
  onClose,
  children,
  action,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      role="dialog"
      aria-label={title}
      className="absolute top-full right-2 z-30 mt-1 flex w-[28rem] max-w-[calc(100%-1rem)] flex-col gap-2 rounded-md border bg-popover p-2 text-xs shadow-lg"
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">{title}</span>
        <div className="flex items-center gap-1">
          {action}
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={`Close ${title.toLowerCase()}`}
            onClick={onClose}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

function HistoryPanel({
  items,
  onPick,
  onClear,
  onClose,
}: {
  items: string[];
  onPick: (q: string) => void;
  onClear: () => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <PanelFrame
      title="Query history"
      onClose={onClose}
      action={
        items.length > 0 ? (
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground"
            onClick={onClear}
          >
            Clear
          </button>
        ) : null
      }
    >
      {items.length === 0 ? (
        <p className="text-muted-foreground">Applied queries show up here.</p>
      ) : (
        <ul className="flex max-h-64 flex-col overflow-auto" aria-label="Recent queries">
          {items.map((q) => (
            <li key={q}>
              <button
                type="button"
                className="w-full truncate rounded px-1.5 py-1 text-left font-mono hover:bg-accent"
                onClick={() => onPick(q)}
                title={q}
              >
                {q}
              </button>
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
  );
}

function FiltersPanel({
  currentDql,
  currentTime,
  canSave,
  onApply,
  onClose,
}: {
  currentDql: string;
  currentTime: ReturnType<typeof useQueryStore.getState>['time'];
  canSave: boolean;
  onApply: (f: SavedFilter) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { data: filters, isLoading } = useSavedFilters();
  const save = useSaveFilter();
  const del = useDeleteFilter();
  const [name, setName] = React.useState('');
  const [confirmDelete, setConfirmDelete] = React.useState<number | null>(null);

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!name.trim() || !canSave) return;
    save.mutate(
      { name: name.trim(), dql: currentDql, ...(currentTime ? { timeFilter: currentTime } : {}) },
      {
        onSuccess: (f) => {
          toast.success(`Saved filter "${f.name}"`);
          setName('');
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <PanelFrame title="Saved filters" onClose={onClose}>
      <form onSubmit={submit} className="flex items-center gap-1">
        <Input
          className="h-7 text-xs"
          placeholder={canSave ? 'Name for the current query…' : 'Enter a valid query to save it'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canSave}
          aria-label="Filter name"
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={!canSave || !name.trim()}
          loading={save.isPending}
        >
          <BookmarkPlus /> Save
        </Button>
      </form>
      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !filters?.length ? (
        <p className="text-muted-foreground">No saved filters in this workspace yet.</p>
      ) : (
        <ul className="flex max-h-64 flex-col overflow-auto" aria-label="Saved filters">
          {filters.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent/60"
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate py-0.5 text-left"
                onClick={() => onApply(f)}
                title={f.dql}
              >
                <span className="font-medium">{f.name}</span>
                <span className="ml-2 font-mono text-muted-foreground">{f.dql}</span>
              </button>
              {confirmDelete === f.id ? (
                <>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-6 px-1.5 text-[11px]"
                    loading={del.isPending}
                    onClick={() =>
                      del.mutate(f.id, {
                        onSuccess: () => setConfirmDelete(null),
                        onError: (err) => toast.error(errorMessage(err)),
                      })
                    }
                  >
                    Delete
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[11px]"
                    onClick={() => setConfirmDelete(null)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete filter ${f.name}`}
                  onClick={() => setConfirmDelete(f.id)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
  );
}
