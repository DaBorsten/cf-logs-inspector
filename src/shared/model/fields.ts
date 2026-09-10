/**
 * Fixed (column-backed) fields of a log entry and how DQL names map to them. Shared by the SQL
 * compiler (main), the evaluator configuration used in tests, and the renderer's autocomplete.
 * Any other field name is a dynamic property looked up in the JSON payload (`props`).
 */
import type { FieldKind } from '../dql/evaluator';

export type FixedFieldKind = 'text' | 'keyword' | 'number' | 'date';

export interface FixedField {
  /** Canonical DQL name. */
  id: string;
  aliases: readonly string[];
  kind: FixedFieldKind;
  /** `log_entries` column. */
  column: string;
  description: string;
}

export const FIXED_FIELDS: readonly FixedField[] = [
  {
    id: 'timestamp',
    aliases: ['ts', '@timestamp', 'time'],
    kind: 'date',
    column: 'ts_ns',
    description: 'Log timestamp (ISO 8601 in queries)',
  },
  {
    id: 'app',
    aliases: ['app_name', 'appName'],
    kind: 'keyword',
    column: 'app_name',
    description: 'Application name',
  },
  {
    id: 'app_guid',
    aliases: ['appGuid'],
    kind: 'keyword',
    column: 'app_guid',
    description: 'Application GUID',
  },
  {
    id: 'source_type',
    aliases: ['sourceType', 'source'],
    kind: 'keyword',
    column: 'source_type',
    description: 'APP/PROC/WEB, RTR, CELL, STG, ...',
  },
  {
    id: 'instance',
    aliases: [],
    kind: 'number',
    column: 'instance',
    description: 'Instance index',
  },
  { id: 'stream', aliases: [], kind: 'keyword', column: 'stream', description: 'OUT or ERR' },
  {
    id: 'level',
    aliases: ['severity'],
    kind: 'keyword',
    column: 'level',
    description: 'Normalised level (TRACE..FATAL)',
  },
  {
    id: 'message',
    aliases: ['msg'],
    kind: 'text',
    column: 'message',
    description: 'Message text (substring match)',
  },
  {
    id: 'raw',
    aliases: [],
    kind: 'text',
    column: 'raw',
    description: 'Full raw line (substring match)',
  },
  {
    id: 'session',
    aliases: ['session_id'],
    kind: 'number',
    column: 'session_id',
    description: 'Log session id',
  },
  { id: 'id', aliases: [], kind: 'number', column: 'id', description: 'Entry id' },
];

/** Fields searched by free-text terms. */
export const TEXT_FIELDS: readonly string[] = ['message', 'raw'];

const byName = new Map<string, FixedField>();
for (const f of FIXED_FIELDS) {
  byName.set(f.id, f);
  for (const a of f.aliases) byName.set(a, f);
}

export function resolveFixedField(name: string): FixedField | undefined {
  return byName.get(name);
}

/** Dynamic property names: identifiers with `-`, `@` and dotted paths. */
export const DYNAMIC_FIELD_RE = /^[A-Za-z_@][\w-]*(\.[A-Za-z_@][\w-]*)*$/;

/** Evaluator field-kind resolver matching the SQL compiler's treatment of fixed fields. */
export function entryFieldKind(name: string): FieldKind {
  const f = resolveFixedField(name);
  if (!f) return 'unknown';
  return f.kind === 'text' ? 'text' : f.kind === 'date' ? 'date' : 'unknown';
}

/** All names (canonical + aliases) for autocomplete. */
export function fixedFieldNames(): string[] {
  return FIXED_FIELDS.flatMap((f) => [f.id, ...f.aliases]);
}
