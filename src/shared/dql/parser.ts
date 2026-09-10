import {
  DEFAULT_OPERATOR,
  KEYWORDS,
  type DqlNode,
  type FieldRef,
  type Literal,
  type RangeOp,
  type Span,
} from './ast';
import { DqlSyntaxError, type DqlError } from './errors';
import { tokenize, type Token, type TokenType } from './tokenizer';

export type ParseResult =
  { ok: true; ast: DqlNode; tokens: Token[] } | { ok: false; error: DqlError; tokens: Token[] };

const RANGE_TYPES: ReadonlySet<TokenType> = new Set(['gt', 'gte', 'lt', 'lte']);
const RANGE_OPS: Record<string, RangeOp> = { gt: '>', gte: '>=', lt: '<', lte: '<=' };

/** Parses DQL text. Never throws; syntax errors are returned with positions. */
export function parse(input: string): ParseResult {
  const tokens = tokenize(input);
  try {
    return { ok: true, ast: new Parser(tokens).parseQuery(), tokens };
  } catch (err) {
    if (err instanceof DqlSyntaxError) return { ok: false, error: err.toJSON(), tokens };
    throw err;
  }
}

export function parseOrThrow(input: string): DqlNode {
  const tokens = tokenize(input);
  return new Parser(tokens).parseQuery();
}

/** Removes `span` properties recursively (before hashing or sending over IPC). */
export function stripSpans(node: DqlNode): DqlNode {
  switch (node.type) {
    case 'match_all':
      return node;
    case 'and':
    case 'or':
      return { type: node.type, children: node.children.map(stripSpans) };
    case 'not':
      return { type: 'not', child: stripSpans(node.child) };
    case 'term':
      return { type: 'term', value: stripLiteral(node.value) };
    case 'match':
      return { type: 'match', field: stripField(node.field), value: stripLiteral(node.value) };
    case 'exists':
      return { type: 'exists', field: stripField(node.field) };
    case 'range':
      return {
        type: 'range',
        field: stripField(node.field),
        op: node.op,
        value: stripLiteral(node.value),
      };
  }
}

/** Stable string key of a query, independent of formatting/whitespace. */
export function astKey(node: DqlNode): string {
  return JSON.stringify(stripSpans(node));
}

function stripField(f: FieldRef): FieldRef {
  return { name: f.name, path: f.path, hasWildcard: f.hasWildcard };
}

function stripLiteral(l: Literal): Literal {
  const out: Literal = { raw: l.raw, quoted: l.quoted, hasWildcard: l.hasWildcard };
  if (l.segments) out.segments = l.segments;
  return out;
}

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parseQuery(): DqlNode {
    if (this.peek().type === 'eof') return { type: 'match_all' };
    const node = this.parseOr();
    const t = this.peek();
    if (t.type !== 'eof') {
      if (t.type === 'rparen') throw new DqlSyntaxError("Unexpected ')'", t.start, t.end);
      throw new DqlSyntaxError(`Unexpected '${t.text}'`, t.start, t.end);
    }
    return node;
  }

  // ---- helpers -------------------------------------------------------------

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const t = this.peek();
    if (t.type !== 'eof') this.pos++;
    return t;
  }

  private isKeyword(t: Token, kw: 'and' | 'or' | 'not'): boolean {
    if (t.type !== 'term' || t.value.toLowerCase() !== kw || t.text.includes('\\')) return false;
    // `and:x` is a field named "and", not the keyword.
    const n = this.tokens[this.tokens.indexOf(t) + 1];
    return !(n && !n.precededBySpace && (n.type === 'colon' || RANGE_TYPES.has(n.type)));
  }

  /**
   * Reads a value literal. Consecutive tokens without whitespace between them are merged so that
   * `url:http://x/y` and `ts>=2026-01-01T00:00:00Z` work without escaping the colons.
   */
  private readValueLiteral(): Literal | undefined {
    const first = this.peek();
    if (first.type === 'quoted') {
      this.next();
      if (first.unterminated)
        throw new DqlSyntaxError('Unterminated quoted string', first.start, first.end);
      return literalOf(first);
    }
    if (first.type !== 'term') return undefined;
    this.next();
    let raw = first.value;
    let segments: string[] | undefined = first.wildcardSegments
      ? [...first.wildcardSegments]
      : undefined;
    let end = first.end;
    for (;;) {
      const t = this.peek();
      if (
        t.precededBySpace ||
        !(t.type === 'term' || t.type === 'colon' || RANGE_TYPES.has(t.type))
      )
        break;
      this.next();
      raw += t.value;
      end = t.end;
      if (t.wildcardSegments) {
        if (!segments) segments = [raw.slice(0, raw.length - t.value.length)];
        segments[segments.length - 1] += t.wildcardSegments[0]!;
        segments.push(...t.wildcardSegments.slice(1));
      } else if (segments) {
        segments[segments.length - 1] += t.value;
      }
    }
    const lit: Literal = {
      raw,
      quoted: false,
      hasWildcard: segments !== undefined,
      span: { start: first.start, end },
    };
    if (segments) lit.segments = segments;
    return lit;
  }

  private startsClause(t: Token): boolean {
    return t.type === 'term' || t.type === 'quoted' || t.type === 'lparen';
  }

  private spanFrom(start: number): Span {
    const prev = this.tokens[this.pos - 1] ?? this.peek();
    return { start, end: prev.end };
  }

  // ---- boolean expression --------------------------------------------------

  private parseOr(): DqlNode {
    const start = this.peek().start;
    const children = [this.parseAnd()];
    while (this.isKeyword(this.peek(), 'or')) {
      this.next();
      this.expectClauseStart('or');
      children.push(this.parseAnd());
    }
    return children.length === 1
      ? children[0]!
      : { type: 'or', children, span: this.spanFrom(start) };
  }

  private parseAnd(): DqlNode {
    const start = this.peek().start;
    const children = [this.parseNot()];
    for (;;) {
      const t = this.peek();
      if (this.isKeyword(t, 'and')) {
        this.next();
        this.expectClauseStart('and');
        children.push(this.parseNot());
        continue;
      }
      if (this.isKeyword(t, 'or') || !this.startsClause(t)) break;
      // Implicit operator between adjacent clauses.
      if (DEFAULT_OPERATOR === 'and') {
        children.push(this.parseNot());
      } else {
        break;
      }
    }
    return children.length === 1
      ? children[0]!
      : { type: 'and', children, span: this.spanFrom(start) };
  }

  private parseNot(): DqlNode {
    const t = this.peek();
    if (this.isKeyword(t, 'not')) {
      this.next();
      this.expectClauseStart('not');
      const child = this.parseNot();
      return { type: 'not', child, span: this.spanFrom(t.start) };
    }
    return this.parsePrimary();
  }

  private expectClauseStart(afterKeyword: string): void {
    const t = this.peek();
    if (t.type === 'eof') {
      throw new DqlSyntaxError(`Unexpected end of query after '${afterKeyword}'`, t.start, t.end);
    }
    if (!this.startsClause(t)) {
      throw new DqlSyntaxError(`Expected a term or field after '${afterKeyword}'`, t.start, t.end);
    }
    if (t.type === 'term' && (this.isKeyword(t, 'and') || this.isKeyword(t, 'or'))) {
      throw new DqlSyntaxError(`Unexpected operator '${t.text}'`, t.start, t.end);
    }
  }

  private parsePrimary(): DqlNode {
    const t = this.peek();

    if (t.type === 'lparen') {
      this.next();
      if (this.peek().type === 'rparen') {
        throw new DqlSyntaxError('Empty group', t.start, this.peek().end);
      }
      const inner = this.parseOr();
      this.expectRParen(t);
      return inner;
    }

    if (t.type === 'quoted') {
      this.next();
      if (t.unterminated) throw new DqlSyntaxError('Unterminated quoted string', t.start, t.end);
      return { type: 'term', value: literalOf(t), span: spanOf(t) };
    }

    if (t.type === 'term') {
      if (this.isKeyword(t, 'and') || this.isKeyword(t, 'or')) {
        throw new DqlSyntaxError(
          `Unexpected operator '${t.text}'; expected a term or field`,
          t.start,
          t.end,
        );
      }
      const n = this.peek(1);
      if (!n.precededBySpace && (n.type === 'colon' || RANGE_TYPES.has(n.type))) {
        return this.parseFieldClause();
      }
      this.next();
      if (t.value === '*' && !t.text.includes('\\')) return { type: 'match_all' };
      return { type: 'term', value: literalOf(t), span: spanOf(t) };
    }

    if (t.type === 'colon' || RANGE_TYPES.has(t.type)) {
      throw new DqlSyntaxError(
        `Unexpected '${t.text}'`,
        t.start,
        t.end,
        'A field name must directly precede the operator, e.g. level:ERROR',
      );
    }
    if (t.type === 'rparen') throw new DqlSyntaxError("Unexpected ')'", t.start, t.end);
    throw new DqlSyntaxError('Unexpected end of query', t.start, t.end);
  }

  private expectRParen(open: Token): void {
    const t = this.peek();
    if (t.type !== 'rparen') {
      throw new DqlSyntaxError(
        `Expected ')' to close group opened at column ${open.start + 1}`,
        t.start,
        t.end,
      );
    }
    this.next();
  }

  // ---- field clauses -------------------------------------------------------

  private parseFieldClause(): DqlNode {
    const fieldTok = this.next();
    const field = fieldOf(fieldTok);
    const op = this.next();

    if (RANGE_TYPES.has(op.type)) {
      return this.parseRange(field, op, fieldTok.start);
    }

    // op is ':'
    const v = this.peek();
    if (v.type === 'eof' || v.type === 'rparen') {
      throw new DqlSyntaxError(
        `Expected a value after ':' for field '${field.name}'`,
        op.start,
        Math.max(op.end, v.start),
      );
    }
    if (RANGE_TYPES.has(v.type)) {
      this.next();
      return this.parseRange(field, v, fieldTok.start);
    }
    if (v.type === 'lparen') {
      this.next();
      if (this.peek().type === 'rparen')
        throw new DqlSyntaxError('Empty group', v.start, this.peek().end);
      const node = this.parseValueOr(field);
      this.expectRParen(v);
      return withSpan(node, { start: fieldTok.start, end: this.tokens[this.pos - 1]!.end });
    }
    return this.parseSingleValue(field, fieldTok.start);
  }

  private parseRange(field: FieldRef, opTok: Token, start: number): DqlNode {
    const v = this.peek();
    const value = this.readValueLiteral();
    if (!value) {
      throw new DqlSyntaxError(
        `Range operator '${opTok.text}' requires a value`,
        opTok.start,
        Math.max(opTok.end, v.start),
      );
    }
    return {
      type: 'range',
      field,
      op: RANGE_OPS[opTok.type]!,
      value,
      span: { start, end: value.span!.end },
    };
  }

  private parseSingleValue(field: FieldRef, start: number): DqlNode {
    const v = this.peek();
    if (
      v.type === 'term' &&
      v.value === '*' &&
      !v.text.includes('\\') &&
      this.endsValueRun(this.peek(1))
    ) {
      this.next();
      return { type: 'exists', field, span: { start, end: v.end } };
    }
    const value = this.readValueLiteral();
    if (!value)
      throw new DqlSyntaxError(`Expected a value for field '${field.name}'`, v.start, v.end);
    return { type: 'match', field, value, span: { start, end: value.span!.end } };
  }

  // value group: field:(a or b and not c), field:(>1 and <10)
  private parseValueOr(field: FieldRef): DqlNode {
    const children = [this.parseValueAnd(field)];
    while (this.isKeyword(this.peek(), 'or')) {
      this.next();
      this.expectValueStart('or');
      children.push(this.parseValueAnd(field));
    }
    return children.length === 1 ? children[0]! : { type: 'or', children };
  }

  private parseValueAnd(field: FieldRef): DqlNode {
    const children = [this.parseValueNot(field)];
    for (;;) {
      const t = this.peek();
      if (this.isKeyword(t, 'and')) {
        this.next();
        this.expectValueStart('and');
        children.push(this.parseValueNot(field));
        continue;
      }
      if (this.isKeyword(t, 'or') || !this.startsValue(t)) break;
      if (DEFAULT_OPERATOR === 'and') {
        children.push(this.parseValueNot(field));
      } else {
        break;
      }
    }
    return children.length === 1 ? children[0]! : { type: 'and', children };
  }

  private parseValueNot(field: FieldRef): DqlNode {
    const t = this.peek();
    if (this.isKeyword(t, 'not')) {
      this.next();
      this.expectValueStart('not');
      return { type: 'not', child: this.parseValueNot(field) };
    }
    if (t.type === 'lparen') {
      this.next();
      if (this.peek().type === 'rparen')
        throw new DqlSyntaxError('Empty group', t.start, this.peek().end);
      const inner = this.parseValueOr(field);
      this.expectRParen(t);
      return inner;
    }
    if (RANGE_TYPES.has(t.type)) {
      this.next();
      return this.parseRange(field, t, t.start);
    }
    if (t.type === 'term' && (this.isKeyword(t, 'and') || this.isKeyword(t, 'or'))) {
      throw new DqlSyntaxError(`Unexpected operator '${t.text}' in value group`, t.start, t.end);
    }
    return this.parseSingleValue(field, t.start);
  }

  private endsValueRun(t: Token): boolean {
    return (
      t.type === 'eof' ||
      t.type === 'rparen' ||
      t.type === 'lparen' ||
      t.type === 'quoted' ||
      t.precededBySpace
    );
  }

  private startsValue(t: Token): boolean {
    return (
      t.type === 'term' || t.type === 'quoted' || t.type === 'lparen' || RANGE_TYPES.has(t.type)
    );
  }

  private expectValueStart(afterKeyword: string): void {
    const t = this.peek();
    if (t.type === 'eof' || t.type === 'rparen') {
      throw new DqlSyntaxError(`Expected a value after '${afterKeyword}'`, t.start, t.end);
    }
  }
}

// ---- node constructors -------------------------------------------------------

function spanOf(t: Token): Span {
  return { start: t.start, end: t.end };
}

function literalOf(t: Token): Literal {
  const lit: Literal = {
    raw: t.value,
    quoted: t.type === 'quoted',
    hasWildcard: t.type === 'term' && t.wildcardSegments !== undefined,
    span: spanOf(t),
  };
  if (t.wildcardSegments) lit.segments = t.wildcardSegments;
  return lit;
}

function fieldOf(t: Token): FieldRef {
  return {
    name: t.value,
    path: t.value.split('.').filter((s) => s.length > 0),
    hasWildcard: t.wildcardSegments !== undefined,
    span: spanOf(t),
  };
}

function withSpan(node: DqlNode, span: Span): DqlNode {
  return node.type === 'match_all' ? node : { ...node, span };
}

export { KEYWORDS };
