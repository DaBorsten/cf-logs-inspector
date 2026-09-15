import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { ChevronDown } from 'lucide-react';
import type { EntryRow, PropInfo } from '@shared/model/query';
import { Badge } from '../../components/ui/badge';
import { appColor } from '../../lib/colors';
import { formatTimestamp, subMillisDigits, type TimeZoneMode } from '../../lib/time';
import { cn } from '../../lib/utils';
import { Highlighted } from './highlight';
import { previewLines, valueLines } from './multiline';
import './table-meta';

export const PROP_PREFIX = 'p:';

/** Column id -> DQL/sort field. Dynamic columns are `p:<key>`. */
export function sortKeyOf(columnId: string): string {
  return columnId.startsWith(PROP_PREFIX) ? columnId.slice(PROP_PREFIX.length) : columnId;
}

/** Columns whose cells may hold multi-line string values and get the preview/expand treatment. */
export function isMultilineColumn(columnId: string): boolean {
  return columnId === 'message' || columnId.startsWith(PROP_PREFIX);
}

export interface ColumnLayout {
  /** Visible columns in display order. */
  order: string[];
  /** Widths in px by column id. */
  sizes: Record<string, number>;
}

export const DEFAULT_LAYOUT: ColumnLayout = {
  order: ['timestamp', 'level', 'app', 'message'],
  sizes: {},
};

export interface FixedColumnMeta {
  id: string;
  label: string;
  defaultSize: number;
  sortable: boolean;
}

export const FIXED_COLUMNS: FixedColumnMeta[] = [
  { id: 'timestamp', label: 'Timestamp', defaultSize: 190, sortable: true },
  { id: 'level', label: 'Level', defaultSize: 70, sortable: true },
  { id: 'app', label: 'App', defaultSize: 130, sortable: true },
  { id: 'source_type', label: 'Source', defaultSize: 110, sortable: true },
  { id: 'instance', label: 'Inst', defaultSize: 50, sortable: true },
  { id: 'stream', label: 'Stream', defaultSize: 60, sortable: true },
  { id: 'session', label: 'Session', defaultSize: 70, sortable: true },
  { id: 'message', label: 'Message', defaultSize: 640, sortable: true },
];

export const DEFAULT_PROP_SIZE = 140;

export function levelClass(level: string | null): string {
  switch (level) {
    case 'FATAL':
    case 'ERROR':
      return 'text-destructive';
    case 'WARN':
      return 'text-warning';
    case 'DEBUG':
    case 'TRACE':
      return 'text-muted-foreground';
    default:
      return '';
  }
}

export function rowTintClass(level: string | null): string {
  switch (level) {
    case 'FATAL':
    case 'ERROR':
      return 'bg-destructive/8';
    case 'WARN':
      return 'bg-warning/10';
    default:
      return '';
  }
}

export function JsonValue({ value }: { value: unknown }): React.JSX.Element | null {
  if (value === undefined) return null;
  if (value === null) return <span className="text-muted-foreground italic">null</span>;
  if (typeof value === 'string') return <>{value}</>;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="text-primary">{String(value)}</span>;
  }
  return <span className="text-muted-foreground">{JSON.stringify(value)}</span>;
}

/**
 * Expanding a multiline cell to show every line (via a "Show N more"/"Show less" toggle) is
 * implemented and wired end to end (see `isExpanded`/`toggleExpanded` in `table-meta.ts` and the
 * row-height math in `LogTable.tsx`), but shipped disabled for now: flip this to re-enable it.
 * While disabled, `MultilineCell` always previews at most `PREVIEW_LINES` and shows a static
 * indicator with the remaining line count instead of an interactive toggle.
 */
const MULTILINE_EXPAND_ENABLED = false;

/**
 * Previews up to `PREVIEW_LINES` of a multi-line value, mirroring the detail panel's `JsonTable`.
 * Each logical line is truncated (not wrapped) so the rendered height stays a deterministic
 * multiple of the line height for the row-height math in `LogTable.tsx`.
 */
function MultilineCell({
  lines,
  expanded,
  onToggle,
  renderLine,
  title,
}: {
  lines: string[];
  expanded: boolean;
  onToggle: () => void;
  renderLine: (line: string, index: number) => React.ReactNode;
  title?: string;
}): React.JSX.Element {
  const { visibleLines, hasMore, moreCount } = previewLines(
    lines,
    MULTILINE_EXPAND_ENABLED && expanded,
  );
  return (
    <div className="min-w-0" title={title}>
      {visibleLines.map((line, i) => (
        <div key={i} className="truncate">
          {renderLine(line, i)}
        </div>
      ))}
      {hasMore ? (
        MULTILINE_EXPAND_ENABLED ? (
          <button
            type="button"
            className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={onToggle}
          >
            <ChevronDown className={cn('size-3', expanded && 'rotate-180')} />
            {expanded ? 'Show less' : `Show ${moreCount} more`}
          </button>
        ) : (
          <span
            className="w-fit rounded bg-muted px-1 text-[10px] text-muted-foreground"
            title={`${moreCount} more ${moreCount === 1 ? 'line' : 'lines'}`}
          >
            ⏎ {moreCount} more
          </span>
        )
      ) : null}
    </div>
  );
}

export function buildColumns(props: PropInfo[], tz: TimeZoneMode): ColumnDef<EntryRow>[] {
  const fixed: ColumnDef<EntryRow>[] = [
    {
      id: 'timestamp',
      accessorFn: (r) => r.tsNs,
      header: 'Timestamp',
      size: 190,
      cell: ({ row }) => (
        <span
          className="font-mono text-[12px] tabular-nums"
          title={`${formatTimestamp(row.original.tsNs, tz)} +${subMillisDigits(row.original.tsNs)} ns`}
        >
          {formatTimestamp(row.original.tsNs, tz)}
        </span>
      ),
    },
    {
      id: 'level',
      accessorFn: (r) => r.level,
      header: 'Level',
      size: 70,
      cell: ({ row }) => (
        <span className={cn('text-[11px] font-semibold', levelClass(row.original.level))}>
          {row.original.level ?? ''}
        </span>
      ),
    },
    {
      id: 'app',
      accessorFn: (r) => r.appName,
      header: 'App',
      size: 130,
      cell: ({ row }) => (
        <Badge
          variant="outline"
          className="max-w-full truncate border-transparent text-white"
          style={{ backgroundColor: appColor(row.original.appName) }}
          title={row.original.appName}
        >
          {row.original.appName}
        </Badge>
      ),
    },
    {
      id: 'source_type',
      accessorFn: (r) => r.sourceType,
      header: 'Source',
      size: 110,
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.sourceType}</span>,
    },
    {
      id: 'instance',
      accessorFn: (r) => r.instance,
      header: 'Inst',
      size: 50,
      cell: ({ row }) => <span className="tabular-nums">{row.original.instance ?? ''}</span>,
    },
    {
      id: 'stream',
      accessorFn: (r) => r.stream,
      header: 'Stream',
      size: 60,
      cell: ({ row }) => (
        <span className={cn(row.original.stream === 'ERR' && 'text-destructive')}>
          {row.original.stream}
        </span>
      ),
    },
    {
      id: 'session',
      accessorFn: (r) => r.sessionId,
      header: 'Session',
      size: 70,
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">#{row.original.sessionId}</span>
      ),
    },
    {
      id: 'message',
      accessorFn: (r) => r.message,
      header: 'Message',
      size: 640,
      cell: ({ row, table }) => {
        const message = row.original.message;
        const terms = table.options.meta?.highlightTerms ?? [];
        const lines = valueLines(message);
        if (!lines) {
          return (
            <span className="font-mono text-[12px]" title={message}>
              <Highlighted text={message} terms={terms} />
            </span>
          );
        }
        return (
          <span className="font-mono text-[12px]">
            <MultilineCell
              lines={lines}
              expanded={table.options.meta?.isExpanded?.(row.id, 'message') ?? false}
              onToggle={() => table.options.meta?.toggleExpanded?.(row.id, 'message')}
              renderLine={(line) => <Highlighted text={line} terms={terms} />}
              title={message}
            />
          </span>
        );
      },
    },
  ];
  const dynamic: ColumnDef<EntryRow>[] = props.map((p) => ({
    id: `${PROP_PREFIX}${p.key}`,
    accessorFn: (r) => r.props?.[p.key],
    header: p.key,
    size: DEFAULT_PROP_SIZE,
    cell: ({ row, table, column }) => {
      const value = row.original.props?.[p.key];
      const lines = typeof value === 'string' ? valueLines(value) : null;
      if (!lines) {
        return (
          <span className="font-mono text-[12px]">
            <JsonValue value={value} />
          </span>
        );
      }
      return (
        <span className="font-mono text-[12px]">
          <MultilineCell
            lines={lines}
            expanded={table.options.meta?.isExpanded?.(row.id, column.id) ?? false}
            onToggle={() => table.options.meta?.toggleExpanded?.(row.id, column.id)}
            renderLine={(line) => <>{line}</>}
          />
        </span>
      );
    },
  }));
  return [...fixed, ...dynamic];
}

/** Human label for a column id (fixed label or the property key). */
export function columnLabel(id: string): string {
  return FIXED_COLUMNS.find((c) => c.id === id)?.label ?? sortKeyOf(id);
}
