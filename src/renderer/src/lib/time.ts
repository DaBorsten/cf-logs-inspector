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
