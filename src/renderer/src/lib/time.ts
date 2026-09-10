import type { TimeFilter, TimeUnit } from '@shared/model/query';

export type TimeZoneMode = 'local' | 'utc';

const MS = 1_000_000n;

export function tsNsToDate(tsNs: string): Date {
  return new Date(Number(BigInt(tsNs) / MS));
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** `YYYY-MM-DD HH:mm:ss.SSS` in local time, or with a trailing ` Z` in UTC. */
export function formatTimestamp(tsNs: string, tz: TimeZoneMode): string {
  const d = tsNsToDate(tsNs);
  if (Number.isNaN(d.getTime())) return tsNs;
  if (tz === 'utc') return d.toISOString().replace('T', ' ').replace('Z', ' Z');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Sub-millisecond digits of a nanosecond timestamp, e.g. `123456` for the tooltip. */
export function subMillisDigits(tsNs: string): string {
  return (BigInt(tsNs) % MS).toString().padStart(6, '0');
}

/** `YYYY-MM-DD HH:mm` for chips and summaries. */
export function formatMinute(ms: number, tz: TimeZoneMode): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  if (tz === 'utc') return d.toISOString().slice(0, 16).replace('T', ' ');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Value for an `<input type="datetime-local">` (seconds precision) in the given zone. */
export function msToDateTimeInput(ms: number, tz: TimeZoneMode): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  if (tz === 'utc') return d.toISOString().slice(0, 19);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
}

/** Parses `YYYY-MM-DDTHH:mm[:ss]` from a datetime-local input, interpreting it in the given zone. */
export function dateTimeInputToMs(value: string, tz: TimeZoneMode): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number) as number[];
  const ms =
    tz === 'utc'
      ? Date.UTC(y!, mo! - 1, d!, h!, mi!, s!)
      : new Date(y!, mo! - 1, d!, h!, mi!, s!).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

export const UNIT_LABEL: Record<TimeUnit, string> = { m: 'min', h: 'h', d: 'd' };

/** Human label of a time filter for the chip: "All time", "Last 15 min", "2026-09-10 10:00 → now". */
export function describeTimeFilter(filter: TimeFilter | undefined, tz: TimeZoneMode): string {
  if (!filter) return 'All time';
  if (filter.kind === 'relative') return `Last ${filter.amount} ${UNIT_LABEL[filter.unit]}`;
  const from = filter.fromMs !== undefined ? formatMinute(filter.fromMs, tz) : 'start';
  const to = filter.toMs !== undefined ? formatMinute(filter.toMs, tz) : 'now';
  return `${from} → ${to}${tz === 'utc' ? ' (UTC)' : ''}`;
}
