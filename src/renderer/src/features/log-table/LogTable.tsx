import * as React from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnSizingState,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown, Globe, Pause, Radio, RefreshCw } from 'lucide-react';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { NativeSelect } from '../../components/ui/input';
import { EmptyState, Spinner } from '../../components/ui/misc';
import { cn, formatCount } from '../../lib/utils';
import { REFRESH_INTERVALS_MS, useQueryStore } from '../../store/query';
import { ColumnPicker } from './ColumnPicker';
import { buildColumns, DEFAULT_PROP_SIZE, FIXED_COLUMNS, rowTintClass, sortKeyOf } from './columns';
import { useColumnLayout } from './useColumnLayout';
import { useEntryPages, useEntrySnapshot, useProps, type EntryScope } from './useEntries';

export const ROW_HEIGHT = 28;

export function LogTable(): React.JSX.Element {
  const dql = useQueryStore((s) => s.dql);
  const sort = useQueryStore((s) => s.sort);
  const toggleSort = useQueryStore((s) => s.toggleSort);
  const sessionIds = useQueryStore((s) => s.sessionIds);
  const time = useQueryStore((s) => s.time);
  const tz = useQueryStore((s) => s.tz);
  const setTz = useQueryStore((s) => s.setTz);
  const refreshIntervalMs = useQueryStore((s) => s.refreshIntervalMs);
  const setRefreshIntervalMs = useQueryStore((s) => s.setRefreshIntervalMs);
  const tail = useQueryStore((s) => s.tail);
  const setTail = useQueryStore((s) => s.setTail);

  const scope = React.useMemo<EntryScope>(() => {
    const s: EntryScope = { sort };
    if (dql) s.dql = dql;
    if (sessionIds) s.sessionIds = sessionIds;
    if (time) s.time = time;
    return s;
  }, [dql, sessionIds, time, sort]);

  const snapshot = useEntrySnapshot(scope);
  const pages = useEntryPages(scope, snapshot.snapshotId);
  const { data: propInfos } = useProps(sessionIds);
  const { layout, setLayout } = useColumnLayout();

  const columns = React.useMemo(() => buildColumns(propInfos ?? [], tz), [propInfos, tz]);
  const columnVisibility = React.useMemo(() => {
    const vis: Record<string, boolean> = {};
    for (const c of columns) vis[c.id!] = layout.order.includes(c.id!);
    return vis;
  }, [columns, layout.order]);
  const sorting = React.useMemo<SortingState>(
    () =>
      sort.map((s) => ({
        id: columnIdForKey(
          s.key,
          columns.map((c) => c.id!),
        ),
        desc: s.dir === 'desc',
      })),
    [sort, columns],
  );
  const columnSizing = React.useMemo<ColumnSizingState>(() => layout.sizes, [layout.sizes]);

  const table = useReactTable({
    data: pages.rows,
    columns,
    state: { columnVisibility, columnOrder: layout.order, sorting, columnSizing },
    manualSorting: true,
    manualPagination: true,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    onColumnSizingChange: (updater) =>
      setLayout((prev) => ({
        ...prev,
        sizes: typeof updater === 'function' ? updater(prev.sizes) : updater,
      })),
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => String(r.id),
  });

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const rows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: rows.length + (pages.hasNextPage ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
    initialRect: { width: 1200, height: 600 },
  });
  const items = virtualizer.getVirtualItems();

  // Load the next page when the placeholder row scrolls into view.
  React.useEffect(() => {
    const last = items[items.length - 1];
    if (last && last.index >= rows.length && pages.hasNextPage && !pages.isFetchingNextPage) {
      void pages.fetchNextPage();
    }
  }, [items, rows.length, pages]);

  // Scroll to top on refresh / scope change.
  const snapshotId = snapshot.snapshotId;
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [snapshotId]);

  // ---- auto refresh & tail ----
  // Tail applies new entries as soon as they are counted, but pauses while the user is reading:
  // scrolled away from the top, pointer over the rows, or dragging a column edge.
  const [scrolledAway, setScrolledAway] = React.useState(false);
  const [hovering, setHovering] = React.useState(false);
  const resizing = Boolean(table.getState().columnSizingInfo.isResizingColumn);
  const tailPaused = scrolledAway || hovering || resizing;
  const latest = React.useRef({ refresh: snapshot.refresh, newCount: snapshot.newCount, time });
  latest.current = { refresh: snapshot.refresh, newCount: snapshot.newCount, time };

  React.useEffect(() => {
    if (tail && !tailPaused && snapshot.newCount > 0) void snapshot.refresh();
  }, [tail, tailPaused, snapshot.newCount, snapshot.refresh]);

  React.useEffect(() => {
    if (!refreshIntervalMs) return;
    const id = setInterval(() => {
      const { refresh, newCount, time: t } = latest.current;
      // Relative windows move with the clock, so they refresh even without new rows.
      if (newCount > 0 || t?.kind === 'relative') void refresh();
    }, refreshIntervalMs);
    return () => clearInterval(id);
  }, [refreshIntervalMs]);

  const headerGroups = table.getHeaderGroups();
  const visibleLeaf = table.getVisibleLeafColumns();
  const gridTemplate = visibleLeaf.map((c) => `${c.getSize()}px`).join(' ');
  const totalWidth = visibleLeaf.reduce((w, c) => w + c.getSize(), 0);

  const error = snapshot.error ?? pages.error;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2 text-xs">
        <span className="text-muted-foreground">
          {snapshot.isLoading ? 'Counting…' : `${formatCount(snapshot.total)} entries`}
        </span>
        {snapshot.newCount > 0 ? (
          <button
            type="button"
            className="rounded-full bg-primary/10 px-2.5 py-0.5 font-medium text-primary hover:bg-primary/20"
            onClick={() => void snapshot.refresh()}
          >
            {formatCount(snapshot.newCount)} new {snapshot.newCount === 1 ? 'entry' : 'entries'} ·
            show
          </button>
        ) : null}
        {tail ? (
          <Badge
            variant={tailPaused ? 'warning' : 'success'}
            title={tailPaused ? 'Tail paused while you read' : 'Following new entries'}
          >
            {tailPaused ? 'Tail paused' : 'Live'}
          </Badge>
        ) : null}
        <span className="flex-1" />
        <Button
          size="sm"
          variant={tail ? 'secondary' : 'ghost'}
          onClick={() => setTail(!tail)}
          aria-pressed={tail}
          aria-label={tail ? 'Stop tailing' : 'Tail new entries'}
          title={tail ? 'Stop tailing' : 'Tail: apply new entries automatically while at the top'}
        >
          {tail ? <Pause /> : <Radio />} Tail
        </Button>
        <NativeSelect
          aria-label="Auto refresh"
          title="Auto refresh interval"
          className="h-7 w-auto py-0 pr-6 text-[11px]"
          value={String(refreshIntervalMs)}
          onChange={(e) => setRefreshIntervalMs(Number(e.target.value))}
        >
          {REFRESH_INTERVALS_MS.map((ms) => (
            <option key={ms} value={ms}>
              {ms === 0 ? 'Refresh: off' : `Refresh: ${ms / 1000} s`}
            </option>
          ))}
        </NativeSelect>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setTz(tz === 'local' ? 'utc' : 'local')}
          title="Toggle time zone"
          aria-label={`Time zone: ${tz === 'local' ? 'local' : 'UTC'}`}
        >
          <Globe /> {tz === 'local' ? 'Local' : 'UTC'}
        </Button>
        <ColumnPicker layout={layout} props={propInfos ?? []} onChange={setLayout} />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void snapshot.refresh()}
          aria-label="Refresh"
          title="Refresh"
          loading={pages.isFetching && !pages.isFetchingNextPage}
        >
          <RefreshCw />
        </Button>
      </div>

      {error ? (
        <EmptyState className="flex-1" title="Query failed" description={errorMessage(error)} />
      ) : (
        <div
          ref={scrollRef}
          data-virtual-scroll
          className="min-h-0 flex-1 overflow-auto"
          role="table"
          aria-rowcount={snapshot.total}
          onScroll={(e) => setScrolledAway(e.currentTarget.scrollTop > 4)}
        >
          <div style={{ minWidth: totalWidth }}>
            {headerGroups.map((hg) => (
              <div
                key={hg.id}
                role="row"
                className="sticky top-0 z-10 grid border-b bg-card text-[11px] font-medium text-muted-foreground select-none"
                style={{ gridTemplateColumns: gridTemplate, height: ROW_HEIGHT }}
              >
                {hg.headers.map((header) => {
                  const key = sortKeyOf(header.column.id);
                  const active = sort[0]?.key === key ? sort[0] : undefined;
                  return (
                    <div
                      key={header.id}
                      role="columnheader"
                      aria-sort={
                        active ? (active.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                      }
                      className="relative flex items-center gap-1 overflow-hidden px-2"
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1 truncate text-left hover:text-foreground"
                        onClick={() => toggleSort(key)}
                        title={`Sort by ${String(header.column.columnDef.header)}`}
                        aria-label={`Sort by ${String(header.column.columnDef.header)}`}
                      >
                        <span className="truncate">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                        {active ? (
                          active.dir === 'asc' ? (
                            <ArrowUp className="size-3 shrink-0" />
                          ) : (
                            <ArrowDown className="size-3 shrink-0" />
                          )
                        ) : (
                          <ArrowUpDown className="size-3 shrink-0 opacity-0 group-hover:opacity-60" />
                        )}
                      </button>
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${String(header.column.columnDef.header)}`}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={() =>
                          setLayout((prev) => {
                            const sizes = { ...prev.sizes };
                            delete sizes[header.column.id];
                            return { ...prev, sizes };
                          })
                        }
                        className={cn(
                          'absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/40',
                          header.column.getIsResizing() && 'bg-primary/60',
                        )}
                      />
                    </div>
                  );
                })}
              </div>
            ))}

            {rows.length === 0 && !pages.isLoading && !snapshot.isLoading ? (
              <EmptyState
                className="py-16"
                title={dql ? 'No entries match the query' : 'No entries yet'}
                description={
                  dql
                    ? 'Adjust the query or the time range.'
                    : 'Start a stream from the Streams tab; entries appear here as they arrive.'
                }
              />
            ) : (
              <div
                style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
                onMouseEnter={() => setHovering(true)}
                onMouseLeave={() => setHovering(false)}
              >
                {items.map((item) => {
                  const row = rows[item.index];
                  if (!row) {
                    return (
                      <div
                        key="loader"
                        className="absolute left-0 flex w-full items-center justify-center text-xs text-muted-foreground"
                        style={{ transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }}
                      >
                        <Spinner className="size-3" /> Loading more…
                      </div>
                    );
                  }
                  return (
                    <div
                      key={row.id}
                      role="row"
                      data-entry-id={row.original.id}
                      className={cn(
                        'absolute left-0 grid w-full items-center border-b border-border/60 text-[12px] hover:bg-accent/40',
                        rowTintClass(row.original.level),
                      )}
                      style={{
                        transform: `translateY(${item.start}px)`,
                        height: ROW_HEIGHT,
                        gridTemplateColumns: gridTemplate,
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <div key={cell.id} role="cell" className="truncate px-2">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function columnIdForKey(key: string, ids: string[]): string {
  if (FIXED_COLUMNS.some((c) => c.id === key)) return key;
  const dyn = `p:${key}`;
  return ids.includes(dyn) ? dyn : key;
}

export { DEFAULT_PROP_SIZE };
