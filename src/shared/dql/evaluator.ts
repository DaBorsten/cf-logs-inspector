import type { DqlNode, FieldRef, Literal } from './ast';
import { globToRegExp, segmentsToRegExp } from './wildcard';

export type FieldKind = 'text' | 'keyword' | 'number' | 'date' | 'unknown';

export interface EvalOptions {
  /** Fields searched by free-text terms and treated as substring-match for `field:value`. */
  textFields?: string[];
  /** Field kind resolver; defaults: `textFields` → text, `timestamp`/`ts`/`@timestamp` → date, else unknown. */
  fieldKind?: (field: string) => FieldKind;
  /** Custom field access; default: flat key first, then walk the dotted path. */
  getField?: (record: Record<string, unknown>, path: string[]) => unknown;
  /** Enumerate field names of a record for wildcard field matching; default: dotted flatten. */
  listFields?: (record: Record<string, unknown>) => string[];
}

export type Matcher = (record: Record<string, unknown>) => boolean;

const DEFAULT_TEXT_FIELDS = ['message'];
const DATE_FIELDS = new Set(['timestamp', 'ts', '@timestamp', 'time']);

export function evaluate(
  ast: DqlNode,
  record: Record<string, unknown>,
  opts?: EvalOptions,
): boolean {
  return compileMatcher(ast, opts)(record);
}

/** Pre-compiles an AST into a predicate (regexes built once). */
export function compileMatcher(ast: DqlNode, opts: EvalOptions = {}): Matcher {
  const textFields = opts.textFields ?? DEFAULT_TEXT_FIELDS;
  const textSet = new Set(textFields);
  const fieldKind =
    opts.fieldKind ??
    ((f: string): FieldKind => (textSet.has(f) ? 'text' : DATE_FIELDS.has(f) ? 'date' : 'unknown'));
  const getField = opts.getField ?? defaultGetField;
  const listFields = opts.listFields ?? defaultListFields;

  const resolveValues = (record: Record<string, unknown>, field: FieldRef): unknown[] => {
    if (!field.hasWildcard) return [getField(record, field.path)];
    const re = globToRegExp(field.name);
    return listFields(record)
      .filter((name) => re.test(name))
      .map((name) => getField(record, name.split('.')));
  };

  const compile = (node: DqlNode): Matcher => {
    switch (node.type) {
      case 'match_all':
        return () => true;
      case 'and': {
        const cs = node.children.map(compile);
        return (r) => cs.every((c) => c(r));
      }
      case 'or': {
        const cs = node.children.map(compile);
        return (r) => cs.some((c) => c(r));
      }
      case 'not': {
        const c = compile(node.child);
        return (r) => !c(r);
      }
      case 'term': {
        const test = literalTester(node.value, 'text');
        return (r) => textFields.some((f) => anyValue(getField(r, f.split('.')), test));
      }
      case 'match': {
        const kind = node.field.hasWildcard ? 'unknown' : fieldKind(node.field.name);
        const test = literalTester(node.value, kind);
        return (r) => resolveValues(r, node.field).some((v) => anyValue(v, test));
      }
      case 'exists':
        return (r) => resolveValues(r, node.field).some((v) => v !== undefined && v !== null);
      case 'range': {
        const cmp = rangeTester(node.op, node.value, fieldKind(node.field.name));
        return (r) => resolveValues(r, node.field).some((v) => anyValue(v, cmp));
      }
    }
  };

  return compile(ast);
}

/** Positive (non-negated) literals, useful for highlighting matches in the UI. */
export function collectHighlightTerms(ast: DqlNode): { field?: string; literal: Literal }[] {
  const out: { field?: string; literal: Literal }[] = [];
  const walk = (node: DqlNode, negated: boolean): void => {
    switch (node.type) {
      case 'and':
      case 'or':
        node.children.forEach((c) => walk(c, negated));
        break;
      case 'not':
        walk(node.child, !negated);
        break;
      case 'term':
        if (!negated) out.push({ literal: node.value });
        break;
      case 'match':
        if (!negated) out.push({ field: node.field.name, literal: node.value });
        break;
      default:
        break;
    }
  };
  walk(ast, false);
  return out;
}

// ---- internals ---------------------------------------------------------------

/** Looks up a dotted path, trying the longest flattened key prefix first (`a.b` then `a`). */
function defaultGetField(record: Record<string, unknown>, path: string[]): unknown {
  if (path.length === 0) return undefined;
  for (let i = path.length; i >= 1; i--) {
    const key = path.slice(0, i).join('.');
    if (key in record) {
      const rest = path.slice(i);
      const v = record[key];
      if (rest.length === 0) return v;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        const nested = defaultGetField(v as Record<string, unknown>, rest);
        if (nested !== undefined) return nested;
      }
    }
  }
  return undefined;
}

function defaultListFields(record: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (obj: Record<string, unknown>, prefix: string, depth: number): void => {
    for (const [k, v] of Object.entries(obj)) {
      const name = prefix ? `${prefix}.${k}` : k;
      out.push(name);
      if (v && typeof v === 'object' && !Array.isArray(v) && depth < 5) {
        walk(v as Record<string, unknown>, name, depth + 1);
      }
    }
  };
  walk(record, '', 0);
  return out;
}

/** Applies `test` to a scalar, or to each element of an array. Objects never match. */
function anyValue(v: unknown, test: (s: unknown) => boolean): boolean {
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.some((e) => e !== null && typeof e !== 'object' && test(e));
  if (typeof v === 'object') return false;
  return test(v);
}

function toText(v: unknown): string {
  return typeof v === 'string' ? v : String(v);
}

function literalTester(lit: Literal, kind: FieldKind): (v: unknown) => boolean {
  if (lit.hasWildcard && lit.segments) {
    const re = segmentsToRegExp(lit.segments);
    return (v) => re.test(toText(v));
  }
  const needle = lit.raw.toLowerCase();
  if (kind === 'text') return (v) => toText(v).toLowerCase().includes(needle);
  return (v) => toText(v).toLowerCase() === needle;
}

function rangeTester(
  op: '>' | '>=' | '<' | '<=',
  lit: Literal,
  kind: FieldKind,
): (v: unknown) => boolean {
  const cmp = (a: number | string, b: number | string): boolean =>
    op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : a <= b;

  const litNum = toNumber(lit.raw);
  const litDate = kind === 'date' || litNum === undefined ? toDateMs(lit.raw) : undefined;

  return (v) => {
    if (litNum !== undefined) {
      const n = toNumber(v);
      if (n !== undefined) return cmp(n, litNum);
    }
    if (litDate !== undefined) {
      const d = toDateMs(v);
      if (d !== undefined) return cmp(d, litDate);
    }
    return cmp(toText(v), lit.raw);
  };
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toDateMs(v: unknown): number | undefined {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}
