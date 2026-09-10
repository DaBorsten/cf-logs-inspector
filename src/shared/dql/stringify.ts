import { KEYWORDS, type DqlNode, type Literal } from './ast';

const UNQUOTED_SPECIAL = /[\\():<>"*\s]/;

/** Canonical text form of an AST; `parse(stringify(ast))` yields an equivalent AST. */
export function stringify(node: DqlNode): string {
  return emit(node, 0);
}

// precedence: or=1, and=2, not=3, primary=4
function precedence(node: DqlNode): number {
  switch (node.type) {
    case 'or':
      return 1;
    case 'and':
      return 2;
    case 'not':
      return 3;
    default:
      return 4;
  }
}

function emit(node: DqlNode, parentPrec: number): string {
  const wrap = (s: string): string => (precedence(node) < parentPrec ? `(${s})` : s);
  switch (node.type) {
    case 'match_all':
      return '';
    case 'and':
      return wrap(node.children.map((c) => emit(c, 2)).join(' and '));
    case 'or':
      return wrap(node.children.map((c) => emit(c, 1)).join(' or '));
    case 'not':
      return wrap(`not ${emit(node.child, 3)}`);
    case 'term':
      return literal(node.value, true);
    case 'match':
      return `${field(node.field.name)}:${literal(node.value)}`;
    case 'exists':
      return `${field(node.field.name)}:*`;
    case 'range':
      return `${field(node.field.name)}${node.op}${literal(node.value)}`;
  }
}

function field(name: string): string {
  return escapeUnquoted(name, /[\\():<>"\s]/);
}

function literal(lit: Literal, freeText = false): string {
  if (lit.quoted || lit.raw === '') return `"${lit.raw.replace(/[\\"]/g, '\\$&')}"`;
  if (lit.hasWildcard && lit.segments) {
    return lit.segments.map((s) => escapeUnquoted(s, UNQUOTED_SPECIAL)).join('*');
  }
  const text = escapeUnquoted(lit.raw, UNQUOTED_SPECIAL);
  // An unquoted keyword would be read as an operator; a leading escape keeps it a literal.
  return freeText && KEYWORDS.has(lit.raw.toLowerCase()) ? `\\${text}` : text;
}

function escapeUnquoted(s: string, special: RegExp): string {
  let out = '';
  for (const ch of s) out += special.test(ch) ? `\\${ch}` : ch;
  return out;
}
