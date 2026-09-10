import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { EntryRow, PropInfo } from '@shared/model/query';
import { Badge } from '../../components/ui/badge';
import { appColor } from '../../lib/colors';
import { formatTimestamp, subMillisDigits, type TimeZoneMode } from '../../lib/time';
import { cn } from '../../lib/utils';
import { Highlighted } from './highlight';
import './table-meta';

export const PROP_PREFIX = 'p:';

/** Column id -> DQL/sort field. Dynamic columns are `p:<key>`. */
export function sortKeyOf(columnId: string): string {
  return columnId.startsWith(PROP_PREFIX) ? columnId.slice(PROP_PREFIX.length) : columnId;
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
        const nl = message.indexOf('\n');
        const firstLine = nl >= 0 ? message.slice(0, nl) : message;
        const lines = nl >= 0 ? message.split('\n').length : 1;
        return (
          <span className="font-mono text-[12px]" title={message}>
            <Highlighted text={firstLine} terms={table.options.meta?.highlightTerms ?? []} />
            {lines > 1 ? (
              <span
                className="ml-1.5 rounded bg-muted px-1 text-[10px] text-muted-foreground"
                title={`${lines} lines`}
              >
                ⏎ {lines}
              </span>
            ) : null}
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
    cell: ({ row }) => (
      <span className="font-mono text-[12px]">
        <JsonValue value={row.original.props?.[p.key]} />
      </span>
    ),
  }));
  return [...fixed, ...dynamic];
}

/** Human label for a column id (fixed label or the property key). */
export function columnLabel(id: string): string {
  return FIXED_COLUMNS.find((c) => c.id === id)?.label ?? sortKeyOf(id);
}
