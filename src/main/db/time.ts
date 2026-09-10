import type { TimeFilter } from '@shared/model/query';
import { InvalidInputError } from '../cf/errors';

const UNIT_MS: Record<'m' | 'h' | 'd', number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };
const MS = 1_000_000n;

export interface TimeRangeNs {
  /** Inclusive. */
  fromNs?: bigint;
  /** Exclusive. */
  toNs?: bigint;
}

export function msToNs(ms: number): bigint {
  return BigInt(Math.trunc(ms)) * MS;
}

/** Resolves a renderer time filter to nanosecond bounds (relative filters use `nowMs`). */
export function resolveTimeFilter(filter: TimeFilter | undefined, nowMs: number): TimeRangeNs {
  if (!filter) return {};
  if (filter.kind === 'relative') {
    if (!Number.isFinite(filter.amount) || filter.amount <= 0) {
      throw new InvalidInputError('Relative time filter needs a positive amount');
    }
    return { fromNs: msToNs(nowMs - filter.amount * UNIT_MS[filter.unit]) };
  }
  const range: TimeRangeNs = {};
  if (filter.fromMs !== undefined) range.fromNs = msToNs(filter.fromMs);
  if (filter.toMs !== undefined) range.toNs = msToNs(filter.toMs);
  if (range.fromNs !== undefined && range.toNs !== undefined && range.fromNs >= range.toNs) {
    throw new InvalidInputError('Time filter start must be before its end');
  }
  return range;
}

/** Parses an ISO-8601-ish literal (date or date-time) to nanoseconds; undefined when not a date. */
export function isoToNs(text: string): bigint | undefined {
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return undefined;
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return undefined;
  // Keep sub-millisecond digits when the literal has them (e.g. 2026-01-01T00:00:00.123456789Z).
  const frac = /\.(\d{4,9})(?:Z|[+-]\d{2}:?\d{2})?$/.exec(text)?.[1];
  let ns = msToNs(ms);
  if (frac) {
    const extra = frac.slice(3).padEnd(6, '0');
    ns += BigInt(extra);
  }
  return ns;
}
