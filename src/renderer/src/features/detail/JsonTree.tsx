import * as React from 'react';
import { ChevronDown, ChevronRight, Copy, Filter, FilterX } from 'lucide-react';
import { isFilterableField, scalarToDql } from '../../lib/dql-edit';
import { cn } from '../../lib/utils';

export interface JsonTreeProps {
  value: unknown;
  /** Dotted DQL path of `value` (empty for the root). */
  path?: string;
  onFilter?: (field: string, value: unknown, negate: boolean) => void;
  onCopy?: (text: string) => void;
  /** Levels expanded by default. */
  expandDepth?: number;
}

/** Collapsible JSON view with per-leaf filter for / filter out / copy actions. */
export function JsonTree({ value, path = '', onFilter, onCopy, expandDepth = 2 }: JsonTreeProps) {
  return (
    <ul className="font-mono text-[12px] leading-5" role="tree">
      <Node
        keyLabel={null}
        value={value}
        path={path}
        depth={0}
        {...{ onFilter, onCopy, expandDepth }}
      />
    </ul>
  );
}

function isContainer(v: unknown): v is Record<string, unknown> | unknown[] {
  return v !== null && typeof v === 'object';
}

function Node({
  keyLabel,
  value,
  path,
  depth,
  onFilter,
  onCopy,
  expandDepth,
}: {
  keyLabel: string | null;
  value: unknown;
  path: string;
  depth: number;
  onFilter: JsonTreeProps['onFilter'];
  onCopy: JsonTreeProps['onCopy'];
  expandDepth: number;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(depth < expandDepth);
  const container = isContainer(value);
  const entries: [string, unknown][] = container
    ? Array.isArray(value)
      ? value.map((v, i) => [String(i), v] as [string, unknown])
      : Object.entries(value)
    : [];
  const filterValue = scalarToDql(value);
  const canFilter = Boolean(
    onFilter && path && filterValue !== undefined && isFilterableField(path),
  );

  return (
    <li role="treeitem" aria-expanded={container ? open : undefined}>
      <div className="group flex items-start gap-1 rounded px-1 hover:bg-accent/50">
        {container ? (
          <button
            type="button"
            className="mt-0.5 shrink-0 rounded text-muted-foreground hover:text-foreground"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? `Collapse ${keyLabel ?? 'root'}` : `Expand ${keyLabel ?? 'root'}`}
          >
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 break-all">
          {keyLabel !== null ? <span className="text-primary">{keyLabel}</span> : null}
          {keyLabel !== null ? <span className="text-muted-foreground">: </span> : null}
          {container ? (
            <span className="text-muted-foreground">
              {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
              {!open && entries.length > 0 ? ' …' : ''}
            </span>
          ) : (
            <Scalar value={value} />
          )}
        </span>
        <span className="invisible flex shrink-0 items-center gap-0.5 group-hover:visible">
          {canFilter ? (
            <>
              <IconButton
                label={`Filter for ${path}`}
                onClick={() => onFilter!(path, value, false)}
              >
                <Filter />
              </IconButton>
              <IconButton label={`Filter out ${path}`} onClick={() => onFilter!(path, value, true)}>
                <FilterX />
              </IconButton>
            </>
          ) : null}
          {onCopy ? (
            <IconButton
              label={`Copy ${keyLabel ?? 'value'}`}
              onClick={() =>
                onCopy(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
              }
            >
              <Copy />
            </IconButton>
          ) : null}
        </span>
      </div>
      {container && open && entries.length > 0 ? (
        <ul className="ml-3 border-l border-border/60 pl-1" role="group">
          {entries.map(([k, v]) => (
            <Node
              key={k}
              keyLabel={k}
              value={v}
              // Array elements keep the parent path: DQL matches any element of an array.
              path={Array.isArray(value) ? path : path ? `${path}.${k}` : k}
              depth={depth + 1}
              onFilter={onFilter}
              onCopy={onCopy}
              expandDepth={expandDepth}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function Scalar({ value }: { value: unknown }): React.JSX.Element {
  if (value === null) return <span className="text-muted-foreground italic">null</span>;
  if (typeof value === 'string') return <span className="text-success">&quot;{value}&quot;</span>;
  if (typeof value === 'number') return <span className="text-warning">{String(value)}</span>;
  if (typeof value === 'boolean') return <span className="text-destructive">{String(value)}</span>;
  return <span className="text-muted-foreground">{JSON.stringify(value)}</span>;
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5',
      )}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
