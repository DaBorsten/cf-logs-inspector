import * as React from 'react';
import { Search, X } from 'lucide-react';
import { invoke } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import { useQueryStore } from '../../store/query';

/**
 * Plain-text DQL input (CodeMirror editor comes in M9). Validates while typing via
 * `entries:validateDql`; Enter commits the query to the store, Escape reverts to the committed one.
 */
export function QueryInput(): React.JSX.Element {
  const committed = useQueryStore((s) => s.dql);
  const setDql = useQueryStore((s) => s.setDql);
  const [draft, setDraft] = React.useState(committed);
  const [error, setError] = React.useState<{ message: string; start: number; end: number } | null>(
    null,
  );
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => setDraft(committed), [committed]);

  React.useEffect(() => {
    if (!draft.trim()) {
      setError(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void invoke('entries:validateDql', { dql: draft })
        .then((r) => {
          if (!cancelled) setError(r.ok ? null : (r.error ?? null));
        })
        .catch(() => {
          if (!cancelled) setError(null);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [draft]);

  const submit = (): void => {
    if (error) return;
    setDql(draft.trim());
  };

  return (
    <div className="flex shrink-0 flex-col gap-1 border-b bg-card px-2 py-1.5">
      <div className="relative flex items-center gap-1">
        <Search className="pointer-events-none absolute left-2 size-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') setDraft(committed);
          }}
          placeholder="Filter with DQL, e.g. level:ERROR and not app:worker  (Enter to apply)"
          aria-label="Query"
          aria-invalid={Boolean(error)}
          className={cn('pl-7 font-mono text-[12px]', draft && 'pr-8')}
          spellCheck={false}
          autoComplete="off"
        />
        {draft ? (
          <button
            type="button"
            className="absolute right-2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Clear query"
            onClick={() => {
              setDraft('');
              setDql('');
              inputRef.current?.focus();
            }}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          onClick={submit}
          disabled={Boolean(error) || draft.trim() === committed}
        >
          Apply
        </Button>
      </div>
      {error ? (
        <p className="pl-7 text-[11px] text-destructive" role="alert">
          {error.message}
          {error.start !== error.end ? ` (position ${error.start + 1})` : ''}
        </p>
      ) : null}
    </div>
  );
}
