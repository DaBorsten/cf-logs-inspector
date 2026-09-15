import * as React from 'react';
import { ArrowDown, ArrowUp, Columns3, GripVertical, RotateCcw } from 'lucide-react';
import type { PropInfo } from '@shared/model/query';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import {
  columnLabel,
  DEFAULT_LAYOUT,
  FIXED_COLUMNS,
  PROP_PREFIX,
  type ColumnLayout,
} from './columns';

export interface ColumnPickerProps {
  layout: ColumnLayout;
  props: PropInfo[];
  onChange: (update: (prev: ColumnLayout) => ColumnLayout) => void;
}

/** Toggle panel listing visible columns (reorderable) and available fixed/dynamic columns. */
export function ColumnPicker({ layout, props, onChange }: ColumnPickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState('');
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [dragOverId, setDragOverId] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const visible = new Set(layout.order);
  const toggle = (id: string): void =>
    onChange((prev) =>
      prev.order.includes(id)
        ? { ...prev, order: prev.order.filter((c) => c !== id) }
        : { ...prev, order: [...prev.order, id] },
    );
  const move = (id: string, delta: -1 | 1): void =>
    onChange((prev) => {
      const idx = prev.order.indexOf(id);
      const target = idx + delta;
      if (idx < 0 || target < 0 || target >= prev.order.length) return prev;
      const order = [...prev.order];
      [order[idx], order[target]] = [order[target]!, order[idx]!];
      return { ...prev, order };
    });
  const moveBefore = (id: string, targetId: string): void =>
    onChange((prev) => {
      if (id === targetId) return prev;
      const from = prev.order.indexOf(id);
      const to = prev.order.indexOf(targetId);
      if (from < 0 || to < 0) return prev;
      const order = [...prev.order];
      order.splice(from, 1);
      order.splice(from < to ? to - 1 : to, 0, id);
      return { ...prev, order };
    });

  const endDrag = (): void => {
    setDragId(null);
    setDragOverId(null);
  };
  const dragHandlers = (id: string): React.HTMLAttributes<HTMLLIElement> => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      setDragId(id);
    },
    onDragOver: (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragId && dragId !== id) setDragOverId(id);
    },
    onDrop: (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/plain') || dragId;
      if (draggedId) moveBefore(draggedId, id);
      endDrag();
    },
    onDragEnd: endDrag,
  });

  const q = filter.trim().toLowerCase();
  const available = [
    ...FIXED_COLUMNS.map((c) => ({ id: c.id, label: c.label, hint: '' })),
    ...props.map((p) => ({
      id: `${PROP_PREFIX}${p.key}`,
      label: p.key,
      hint: `${p.type} · ${p.count}`,
    })),
  ].filter((c) => !visible.has(c.id) && (!q || c.label.toLowerCase().includes(q)));

  return (
    <div className="relative" ref={ref}>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Columns3 /> Columns
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-label="Columns"
          className="absolute top-full right-0 z-30 mt-1 flex w-72 flex-col gap-2 rounded-md border bg-popover p-2 text-xs shadow-lg"
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">Visible</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[11px]"
              onClick={() => onChange(() => DEFAULT_LAYOUT)}
              title="Reset to default columns"
            >
              <RotateCcw /> Reset
            </Button>
          </div>
          <ul className="flex flex-col" aria-label="Visible columns">
            {layout.order.map((id, i) => (
              <li
                key={id}
                {...dragHandlers(id)}
                className={cn(
                  'flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent/60',
                  dragId === id && 'opacity-40',
                  dragOverId === id && dragId !== id && 'border-t-2 border-primary',
                )}
              >
                <GripVertical
                  className="size-3.5 shrink-0 cursor-grab text-muted-foreground"
                  aria-hidden="true"
                />
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked
                    readOnly
                    onChange={() => toggle(id)}
                    className="accent-primary"
                  />
                  <span className="truncate">{columnLabel(id)}</span>
                </label>
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={`Move ${columnLabel(id)} up`}
                  disabled={i === 0}
                  onClick={() => move(id, -1)}
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={`Move ${columnLabel(id)} down`}
                  disabled={i === layout.order.length - 1}
                  onClick={() => move(id, 1)}
                >
                  <ArrowDown className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t pt-2">
            <span className="font-medium">Available</span>
          </div>
          <Input
            className="h-7 text-xs"
            placeholder="Filter columns…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter available columns"
          />
          <ul className={cn('flex max-h-52 flex-col overflow-auto')} aria-label="Available columns">
            {available.length === 0 ? (
              <li className="px-1 py-1 text-muted-foreground">No more columns.</li>
            ) : (
              available.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-accent/60"
                >
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => toggle(c.id)}
                      className="accent-primary"
                    />
                    <span className="truncate">{c.label}</span>
                  </label>
                  {c.hint ? (
                    <span className="text-[10px] text-muted-foreground">{c.hint}</span>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
