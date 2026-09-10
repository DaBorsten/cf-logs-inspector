/**
 * Compiles a DQL AST into a SQLite boolean expression over `log_entries`. The semantics mirror
 * `src/shared/dql/evaluator.ts` (see `entry-query.test.ts` for the equivalence suite):
 * - free text terms search the text fields (message, raw) as case-insensitive substrings;
 * - `field:value` is a case-insensitive exact match on keyword/number/dynamic fields and a substring
 *   match on text fields; `*` wildcards become LIKE patterns; arrays match if any element matches,
 *   objects never match, JSON booleans compare as `true`/`false`;
 * - ranges compare numerically when both sides are numeric, as dates when the literal is an ISO
 *   date and the value looks like one, else lexicographically;
 * - `field:*` is "present and not JSON null"; wildcard field names walk `json_tree(props)`.
 * Known divergences: SQLite folds case ASCII-only; `1.0`/`1e21` style numbers print differently.
 */
import type { DqlNode, FieldRef, Literal, RangeOp } from '@shared/dql/ast';
import { containsToLike, escapeLike, segmentsToLike } from '@shared/dql/wildcard';
import {
  DYNAMIC_FIELD_RE,
  resolveFixedField,
  TEXT_FIELDS,
  type FixedField,
} from '@shared/model/fields';
import { InvalidInputError } from '../cf/errors';
import { isoToNs } from './time';

export interface CompiledExpr {
  sql: string;
  params: unknown[];
}

export class QueryCompileError extends InvalidInputError {}

interface Ctx {
  params: unknown[];
}

const ESC = `ESCAPE '\\'`;
/** ISO-8601 with milliseconds, same shape as `Date#toISOString()`. */
export const TS_ISO_EXPR = `strftime('%Y-%m-%dT%H:%M:%fZ', ts_ns / 1000000000.0, 'unixepoch')`;
const BOOL_TEXT = (typeExpr: string, valueExpr: string): string =>
  `CASE ${typeExpr} WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE ${valueExpr} END`;
const DATE_LIKE_GLOB = `'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'`;

export function compileDql(ast: DqlNode): CompiledExpr {
  const ctx: Ctx = { params: [] };
  const sql = compileNode(ast, ctx);
  return { sql, params: ctx.params };
}

function bind(ctx: Ctx, value: unknown): string {
  ctx.params.push(value);
  return '?';
}

function compileNode(node: DqlNode, ctx: Ctx): string {
  switch (node.type) {
    case 'match_all':
      return '1';
    case 'and':
      return `(${node.children.map((c) => compileNode(c, ctx)).join(' AND ')})`;
    case 'or':
      return `(${node.children.map((c) => compileNode(c, ctx)).join(' OR ')})`;
    case 'not':
      return `(NOT COALESCE(${compileNode(node.child, ctx)}, 0))`;
    case 'term':
      return `(${TEXT_FIELDS.map((f) => matchText(resolveFixedField(f)!.column, node.value, ctx)).join(' OR ')})`;
    case 'match':
      return compileMatch(node.field, node.value, ctx);
    case 'exists':
      return compileExists(node.field, ctx);
    case 'range':
      return compileRange(node.field, node.op, node.value, ctx);
  }
}

// ---- match ----------------------------------------------------------------------------------------

function matchText(column: string, lit: Literal, ctx: Ctx): string {
  const pattern =
    lit.hasWildcard && lit.segments ? segmentsToLike(lit.segments) : containsToLike(lit.raw);
  return `${column} LIKE ${bind(ctx, pattern)} ${ESC}`;
}

/** Case-insensitive exact (or wildcard) comparison of a scalar rendered as text. */
function matchExact(valueExpr: string, lit: Literal, ctx: Ctx): string {
  const pattern =
    lit.hasWildcard && lit.segments ? segmentsToLike(lit.segments) : escapeLike(lit.raw);
  return `CAST(${valueExpr} AS TEXT) LIKE ${bind(ctx, pattern)} ${ESC}`;
}

function compileMatch(field: FieldRef, lit: Literal, ctx: Ctx): string {
  if (field.hasWildcard) {
    return wildcardField(field, ctx, 'atoms', (v) => matchExact(v, lit, ctx));
  }
  const fixed = resolveFixedField(field.name);
  if (fixed) {
    if (fixed.kind === 'text') return matchText(fixed.column, lit, ctx);
    if (fixed.kind === 'date') return matchExact(TS_ISO_EXPR, lit, ctx);
    return matchExact(fixed.column, lit, ctx);
  }
  return dynamicField(field, ctx, (v) => matchExact(v, lit, ctx));
}

// ---- exists ---------------------------------------------------------------------------------------

function compileExists(field: FieldRef, ctx: Ctx): string {
  if (field.hasWildcard) return wildcardField(field, ctx, 'any', () => '1');
  const fixed = resolveFixedField(field.name);
  if (fixed) return `${fixed.column} IS NOT NULL`;
  const paths = jsonPaths(field);
  return `(${paths
    .map((p) => {
      const t = `json_type(props, ${sqlString(p)})`;
      return `(${t} IS NOT NULL AND ${t} <> 'null')`;
    })
    .join(' OR ')})`;
}

/** SQL string literal (paths are validated against DYNAMIC_FIELD_RE, so this is belt and braces). */
function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

// ---- range ----------------------------------------------------------------------------------------

function compileRange(field: FieldRef, op: RangeOp, lit: Literal, ctx: Ctx): string {
  if (field.hasWildcard) {
    return wildcardField(field, ctx, 'atoms', (v) => rangeScalar(v, op, lit, ctx));
  }
  const fixed = resolveFixedField(field.name);
  if (fixed) return rangeFixed(fixed, op, lit, ctx);
  return dynamicField(field, ctx, (v) => rangeScalar(v, op, lit, ctx));
}

function rangeFixed(fixed: FixedField, op: RangeOp, lit: Literal, ctx: Ctx): string {
  if (fixed.kind === 'date') {
    const ns = isoToNs(lit.raw);
    if (ns === undefined) {
      const ms = toNumber(lit.raw);
      if (ms === undefined) {
        throw new QueryCompileError(
          `Range on '${fixed.id}' needs an ISO date (e.g. 2026-01-01T10:00:00Z) or epoch milliseconds`,
        );
      }
      return `ts_ns ${op} ${bind(ctx, BigInt(Math.trunc(ms)) * 1_000_000n)}`;
    }
    return `ts_ns ${op} ${bind(ctx, ns)}`;
  }
  if (fixed.kind === 'number') {
    const n = toNumber(lit.raw);
    if (n !== undefined) return `${fixed.column} ${op} ${bind(ctx, n)}`;
    return `CAST(${fixed.column} AS TEXT) ${op} ${bind(ctx, lit.raw)}`;
  }
  return rangeScalar(fixed.column, op, lit, ctx);
}

/**
 * Range test on a scalar expression following the evaluator: numeric when the literal is numeric and
 * the value is a number or numeric-looking text; date when the literal is a date and the value looks
 * like one; else plain text comparison.
 */
function rangeScalar(valueExpr: string, op: RangeOp, lit: Literal, ctx: Ctx): string {
  const num = toNumber(lit.raw);
  if (num !== undefined) {
    // Numeric-looking text = starts like a number and contains only number characters (so '12abc' is text,
    // matching JavaScript's Number() which yields NaN for it).
    const numeric = `(typeof(${valueExpr}) IN ('integer', 'real') OR ((${valueExpr} GLOB '[0-9]*' OR ${valueExpr} GLOB '[-+.][0-9]*') AND ${valueExpr} NOT GLOB '*[^0-9.eE+-]*'))`;
    return `(CASE WHEN ${numeric} THEN CAST(${valueExpr} AS REAL) ${op} ${bind(ctx, num)} ELSE ${valueExpr} ${op} ${bind(ctx, lit.raw)} END)`;
  }
  if (isoToNs(lit.raw) !== undefined) {
    const dateLike = `(${valueExpr} GLOB ${DATE_LIKE_GLOB} AND julianday(${valueExpr}) IS NOT NULL)`;
    return `(CASE WHEN ${dateLike} THEN julianday(${valueExpr}) ${op} julianday(${bind(ctx, lit.raw)}) ELSE ${valueExpr} ${op} ${bind(ctx, lit.raw)} END)`;
  }
  return `${valueExpr} ${op} ${bind(ctx, lit.raw)}`;
}

// ---- dynamic properties -----------------------------------------------------------------------

/**
 * JSON paths to try for a dotted name, mirroring the evaluator's lookup that prefers flattened keys
 * (`{"a.b": 1}`) over nested objects (`{"a": {"b": 1}}`). All compositions for up to 4 segments.
 */
export function jsonPaths(field: FieldRef): string[] {
  if (!DYNAMIC_FIELD_RE.test(field.name)) {
    throw new QueryCompileError(`Invalid field name '${field.name}'`);
  }
  const segs = field.path;
  const quote = (s: string): string => `"${s.replace(/"/g, '\\"')}"`;
  if (segs.length === 1 || segs.length > 4) return [`$.${segs.map(quote).join('.')}`];
  const n = segs.length;
  // Each bitmask decides whether the boundary between segment i and i+1 is a dot inside one key (1) or a
  // nesting step (0). The evaluator prefers the longest flattened prefix first, i.e. earlier boundaries
  // being dots outrank later ones: order masks by their bit-reversed value, descending.
  const masks = Array.from({ length: 1 << (n - 1) }, (_, m) => m).sort(
    (a, b) => rank(b, n) - rank(a, n),
  );
  return masks.map((mask) => {
    const keys: string[] = [];
    let cur = segs[0]!;
    for (let i = 0; i < n - 1; i++) {
      if (mask & (1 << i)) cur += `.${segs[i + 1]!}`;
      else {
        keys.push(cur);
        cur = segs[i + 1]!;
      }
    }
    keys.push(cur);
    return `$.${keys.map(quote).join('.')}`;
  });
}

function rank(mask: number, n: number): number {
  let r = 0;
  for (let i = 0; i < n - 1; i++) if (mask & (1 << i)) r |= 1 << (n - 2 - i);
  return r;
}

/** Applies `pred` to the scalar value(s) at a dynamic property, handling arrays, objects, booleans and null. */
function dynamicField(field: FieldRef, ctx: Ctx, pred: (valueExpr: string) => string): string {
  // The path is embedded as a literal (not bound) because it appears several times per variant and
  // positional parameters must be pushed exactly once per `?` in textual order.
  const variants = jsonPaths(field).map((path) => {
    const p = sqlString(path);
    const type = `json_type(props, ${p})`;
    const scalar = BOOL_TEXT(type, `json_extract(props, ${p})`);
    const each = `EXISTS (SELECT 1 FROM json_each(props, ${p}) AS je WHERE je.type NOT IN ('object', 'array', 'null') AND ${pred(BOOL_TEXT('je.type', 'je.value'))})`;
    return `(CASE ${type} WHEN 'object' THEN 0 WHEN 'array' THEN ${each} WHEN 'null' THEN 0 ELSE ${pred(scalar)} END)`;
  });
  return `(props IS NOT NULL AND (${variants.join(' OR ')}))`;
}

/**
 * Wildcard field names (`labels.*`, `*_id`) walk every node of the payload. `atoms` restricts to scalar
 * leaves (match/range); `any` accepts objects/arrays too (exists).
 */
function wildcardField(
  field: FieldRef,
  ctx: Ctx,
  mode: 'atoms' | 'any',
  pred: (valueExpr: string) => string,
): string {
  const namePattern = segmentsToLike(field.name.split('*'));
  const dotted = `replace(substr(jt.path, 3), '"', '')`;
  const name = `CASE WHEN typeof(jt.key) = 'integer' THEN ${dotted} ELSE ltrim(${dotted} || '.' || jt.key, '.') END`;
  const typeFilter =
    mode === 'atoms' ? `jt.type NOT IN ('object', 'array', 'null')` : `jt.type <> 'null'`;
  const value = BOOL_TEXT('jt.type', 'jt.value');
  return `(props IS NOT NULL AND EXISTS (SELECT 1 FROM json_tree(props) AS jt WHERE jt.key IS NOT NULL AND ${typeFilter} AND ${name} LIKE ${bind(ctx, namePattern)} ${ESC} AND ${pred(value)}))`;
}

// ---- helpers --------------------------------------------------------------------------------------

function toNumber(text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/** Sort key -> SQL expression, or undefined when the key is not allowed. */
export function sortExpression(key: string): string | undefined {
  const fixed = resolveFixedField(key);
  if (fixed) return fixed.column;
  if (!DYNAMIC_FIELD_RE.test(key)) return undefined;
  const path = `$.${key
    .split('.')
    .map((s) => `"${s}"`)
    .join('.')}`;
  return `json_extract(props, '${path.replace(/'/g, "''")}')`;
}
