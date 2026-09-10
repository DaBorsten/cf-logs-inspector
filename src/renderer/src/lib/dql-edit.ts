import { parse } from '@shared/dql';
import { DYNAMIC_FIELD_RE, resolveFixedField } from '@shared/model/fields';

const NEEDS_QUOTES = /[\s():<>"\\*]/;

/** Quotes a value for DQL when it contains whitespace or syntax characters. */
export function quoteDqlValue(v: string): string {
  return NEEDS_QUOTES.test(v) || v === '' ? `"${v.replace(/(["\\])/g, '\\$1')}"` : v;
}

/** Whether `field:value` filters can target this field name (fixed alias or valid dynamic path). */
export function isFilterableField(field: string): boolean {
  return Boolean(resolveFixedField(field)) || DYNAMIC_FIELD_RE.test(field);
}

/** Renders a scalar for use as a DQL value; objects/arrays and null are not filterable. */
export function scalarToDql(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return quoteDqlValue(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/**
 * Appends `field:value` (or `not field:value`) to a query with an explicit `and`. Returns the original
 * query when the result would not parse (defensive; should not happen with quoted values).
 */
export function appendClause(dql: string, field: string, value: unknown, negate = false): string {
  const v = scalarToDql(value);
  if (v === undefined || !isFilterableField(field)) return dql;
  const clause = `${negate ? 'not ' : ''}${field}:${v}`;
  const base = dql.trim();
  const next = base ? `${base} and ${clause}` : clause;
  return parse(next).ok ? next : dql;
}
