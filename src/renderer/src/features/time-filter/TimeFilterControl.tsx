import * as React from 'react';
import { CalendarClock, X } from 'lucide-react';
import type { TimeFilter, TimeUnit } from '@shared/model/query';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input, NativeSelect } from '../../components/ui/input';
import {
  dateTimeInputToMs,
  describeTimeFilter,
  msToDateTimeInput,
  UNIT_LABEL,
} from '../../lib/time';
import { cn } from '../../lib/utils';
import { useQueryStore } from '../../store/query';

export const QUICK_PICKS: { label: string; amount: number; unit: TimeUnit }[] = [
  { label: '5 min', amount: 5, unit: 'm' },
  { label: '15 min', amount: 15, unit: 'm' },
  { label: '1 h', amount: 1, unit: 'h' },
  { label: '6 h', amount: 6, unit: 'h' },
  { label: '24 h', amount: 24, unit: 'h' },
  { label: '7 d', amount: 7, unit: 'd' },
];

/** Chip + panel to set `useQueryStore.time`: quick picks, custom relative range, absolute range, all time. */
export function TimeFilterControl(): React.JSX.Element {
  const time = useQueryStore((s) => s.time);
  const setTime = useQueryStore((s) => s.setTime);
  const tz = useQueryStore((s) => s.tz);
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const apply = (next: TimeFilter | undefined): void => {
    setTime(next);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        size="sm"
        variant={time ? 'secondary' : 'outline'}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Time range"
        title="Time range"
        className={cn(time && 'font-medium')}
      >
        <CalendarClock /> {describeTimeFilter(time, tz)}
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-label="Time range"
          className="absolute top-full right-0 z-30 mt-1 flex w-80 flex-col gap-3 rounded-md border bg-popover p-3 text-xs shadow-lg"
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">Quick ranges</span>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Close time range"
              onClick={() => setOpen(false)}
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {QUICK_PICKS.map((q) => {
              const active =
                time?.kind === 'relative' && time.amount === q.amount && time.unit === q.unit;
              return (
                <Button
                  key={q.label}
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  onClick={() => apply({ kind: 'relative', amount: q.amount, unit: q.unit })}
                >
                  Last {q.label}
                </Button>
              );
            })}
          </div>
          <RelativeForm current={time} onApply={apply} />
          <AbsoluteForm current={time} tz={tz} onApply={apply} />
          <div className="flex justify-between border-t pt-2">
            <span className="text-muted-foreground">
              Times are {tz === 'utc' ? 'UTC' : 'local'}
            </span>
            <Button size="sm" variant="ghost" disabled={!time} onClick={() => apply(undefined)}>
              All time
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RelativeForm({
  current,
  onApply,
}: {
  current: TimeFilter | undefined;
  onApply: (t: TimeFilter) => void;
}): React.JSX.Element {
  const [amount, setAmount] = React.useState(
    current?.kind === 'relative' ? String(current.amount) : '30',
  );
  const [unit, setUnit] = React.useState<TimeUnit>(
    current?.kind === 'relative' ? current.unit : 'm',
  );
  const n = Number(amount);
  const valid = Number.isFinite(n) && n > 0 && Number.isInteger(n);
  return (
    <form
      className="flex items-end gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onApply({ kind: 'relative', amount: n, unit });
      }}
    >
      <Field id="tf-rel-amount" label="Last" className="w-20">
        <Input
          id="tf-rel-amount"
          type="number"
          min={1}
          step={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="h-7 text-xs"
          aria-invalid={!valid}
        />
      </Field>
      <Field id="tf-rel-unit" label="Unit" className="w-24">
        <NativeSelect
          id="tf-rel-unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value as TimeUnit)}
          className="h-7 text-xs"
        >
          {(Object.keys(UNIT_LABEL) as TimeUnit[]).map((u) => (
            <option key={u} value={u}>
              {u === 'm' ? 'minutes' : u === 'h' ? 'hours' : 'days'}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Button type="submit" size="sm" variant="secondary" disabled={!valid}>
        Apply
      </Button>
    </form>
  );
}

function AbsoluteForm({
  current,
  tz,
  onApply,
}: {
  current: TimeFilter | undefined;
  tz: 'local' | 'utc';
  onApply: (t: TimeFilter) => void;
}): React.JSX.Element {
  const abs = current?.kind === 'absolute' ? current : undefined;
  const [from, setFrom] = React.useState(
    abs?.fromMs !== undefined ? msToDateTimeInput(abs.fromMs, tz) : '',
  );
  const [to, setTo] = React.useState(
    abs?.toMs !== undefined ? msToDateTimeInput(abs.toMs, tz) : '',
  );
  const fromMs = from ? dateTimeInputToMs(from, tz) : undefined;
  const toMs = to ? dateTimeInputToMs(to, tz) : undefined;
  const invalid =
    (from !== '' && fromMs === undefined) ||
    (to !== '' && toMs === undefined) ||
    (fromMs !== undefined && toMs !== undefined && fromMs >= toMs) ||
    (from === '' && to === '');
  const error =
    fromMs !== undefined && toMs !== undefined && fromMs >= toMs
      ? 'Start must be before end'
      : undefined;
  return (
    <form
      className="flex flex-col gap-1 border-t pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid) return;
        const t: TimeFilter = { kind: 'absolute' };
        if (fromMs !== undefined) t.fromMs = fromMs;
        if (toMs !== undefined) t.toMs = toMs;
        onApply(t);
      }}
    >
      <span className="font-medium">Absolute range</span>
      <div className="flex items-end gap-1">
        <Field id="tf-abs-from" label="From" className="flex-1">
          <Input
            id="tf-abs-from"
            type="datetime-local"
            step={1}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-7 text-xs"
          />
        </Field>
        <Field id="tf-abs-to" label="To" className="flex-1" error={error}>
          <Input
            id="tf-abs-to"
            type="datetime-local"
            step={1}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-7 text-xs"
            aria-invalid={Boolean(error)}
          />
        </Field>
        <Button type="submit" size="sm" variant="secondary" disabled={invalid}>
          Apply
        </Button>
      </div>
    </form>
  );
}
