import * as React from 'react';
import { ChevronDown, Copy, Filter, FilterX } from 'lucide-react';
import { isFilterableField, scalarToDql } from '../../lib/dql-edit';
import { cn } from '../../lib/utils';

export interface JsonTableProps {
  value: unknown;
  onFilter?: (field: string, value: unknown, negate: boolean) => void;
  onCopy?: (text: string) => void;
}

const PREVIEW_LINES = 3;

/** Flattened key/value table: one row per JSON leaf, with filter/copy actions per row. */
export function JsonTable({ value, onFilter, onCopy }: JsonTableProps): React.JSX.Element {
  const leaves = React.useMemo(() => {
    const acc: Leaf[] = [];
    collectLeaves(value, '', acc);
    return acc;
  }, [value]);

  return (
    <table className="w-full border-collapse font-mono text-[12px] leading-5">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="w-px border-b py-1 pr-2 font-medium whitespace-nowrap">Key</th>
          <th className="border-b py-1 pr-2 font-medium">Value</th>
        </tr>
      </thead>
      <tbody>
        {leaves.map((leaf, i) => (
          <JsonTableRow
            key={i}
            path={leaf.path}
            value={leaf.value}
            onFilter={onFilter}
            onCopy={onCopy}
          />
        ))}
      </tbody>
    </table>
  );
}

function isContainer(v: unknown): v is Record<string, unknown> | unknown[] {
  return v !== null && typeof v === 'object';
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

interface Leaf {
  path: string;
  value: unknown;
}

/**
 * Walks containers (array children keep the parent path since DQL matches any element; object children
 * append `.key`), pushing a leaf for every scalar and every empty container instead of recursing into a
 * nested list. String arrays are kept intact as a single leaf rather than flattened element by element.
 */
function collectLeaves(value: unknown, path: string, acc: Leaf[]): void {
  if (isContainer(value) && !isStringArray(value)) {
    const entries: [string, unknown][] = Array.isArray(value)
      ? value.map((v, i) => [String(i), v] as [string, unknown])
      : Object.entries(value);
    if (entries.length === 0) {
      acc.push({ path, value });
      return;
    }
    for (const [k, v] of entries) {
      const childPath = Array.isArray(value) ? path : path ? `${path}.${k}` : k;
      collectLeaves(v, childPath, acc);
    }
    return;
  }
  acc.push({ path, value });
}

/** Lines to preview for a multi-line value, or `null` when the value renders on a single line. */
function valueLines(value: unknown): string[] | null {
  if (isStringArray(value) && value.length > 0) return value;
  if (typeof value === 'string' && value.includes('\n')) return value.split('\n');
  return null;
}

function JsonTableRow({
  path,
  value,
  onFilter,
  onCopy,
}: {
  path: string;
  value: unknown;
  onFilter: JsonTableProps['onFilter'];
  onCopy: JsonTableProps['onCopy'];
}): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(false);
  const container = isContainer(value);
  const lines = valueLines(value);
  const isArrayValue = isStringArray(value);
  const filterValue = scalarToDql(value);
  const canFilter = Boolean(
    onFilter && path && filterValue !== undefined && isFilterableField(path),
  );
  const hasMore = lines !== null && lines.length > PREVIEW_LINES;
  const visibleLines = lines === null ? null : expanded ? lines : lines.slice(0, PREVIEW_LINES);

  return (
    <tr className="group align-top hover:bg-accent/50">
      <td className="w-px border-b py-0.5 pr-2 align-top whitespace-nowrap text-primary">{path}</td>
      <td className="border-b py-0.5 align-top">
        <div className="flex items-start gap-1">
          <span className="flex shrink-0 items-center gap-0.5">
            <IconButton
              label={`Filter for ${path}`}
              onClick={() => onFilter?.(path, value, false)}
              hidden={!canFilter}
            >
              <Filter />
            </IconButton>
            <IconButton
              label={`Filter out ${path}`}
              onClick={() => onFilter?.(path, value, true)}
              hidden={!canFilter}
            >
              <FilterX />
            </IconButton>
            <IconButton
              label={`Copy ${path}`}
              onClick={() =>
                onCopy?.(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
              }
              hidden={!onCopy}
            >
              <Copy />
            </IconButton>
          </span>
          <div className="min-w-0 flex-1 break-all">
            {visibleLines !== null ? (
              <>
                {visibleLines.map((line, i) =>
                  isArrayValue ? (
                    <div key={i}>
                      <Scalar value={line} />
                    </div>
                  ) : (
                    <div key={i} className="whitespace-pre-wrap">
                      {line}
                    </div>
                  ),
                )}
                {hasMore ? (
                  <button
                    type="button"
                    className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => setExpanded((e) => !e)}
                  >
                    <ChevronDown className={cn('size-3', expanded && 'rotate-180')} />
                    {expanded ? 'Show less' : `Show ${lines!.length - PREVIEW_LINES} more`}
                  </button>
                ) : null}
              </>
            ) : container ? (
              <span className="text-muted-foreground">{Array.isArray(value) ? '[0]' : '{0}'}</span>
            ) : (
              <Scalar value={value} />
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

export function Scalar({ value }: { value: unknown }): React.JSX.Element {
  if (value === null) return <span className="text-muted-foreground italic">null</span>;
  if (typeof value === 'string') return <span className="text-success">{value}</span>;
  if (typeof value === 'number') return <span className="text-warning">{String(value)}</span>;
  if (typeof value === 'boolean') return <span className="text-destructive">{String(value)}</span>;
  return <span className="text-muted-foreground">{JSON.stringify(value)}</span>;
}

function IconButton({
  label,
  onClick,
  hidden = false,
  children,
}: {
  label: string;
  onClick: () => void;
  hidden?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5',
        hidden ? 'invisible pointer-events-none' : 'invisible group-hover:visible',
      )}
      aria-label={label}
      title={label}
      onClick={onClick}
      tabIndex={hidden ? -1 : undefined}
    >
      {children}
    </button>
  );
}
