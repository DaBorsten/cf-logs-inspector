import type { DqlNode } from '../ast';
import { parse, parseOrThrow, stripSpans, astKey } from '../parser';

const f = (name: string): { name: string; path: string[]; hasWildcard: boolean } => ({
  name,
  path: name.split('.'),
  hasWildcard: name.includes('*'),
});
const lit = (raw: string, quoted = false): { raw: string; quoted: boolean; hasWildcard: boolean } => ({ raw, quoted, hasWildcard: false });
const wild = (raw: string): { raw: string; quoted: boolean; hasWildcard: boolean; segments: string[] } => ({
  raw,
  quoted: false,
  hasWildcard: true,
  segments: raw.split('*'),
});
const term = (raw: string, quoted = false): DqlNode => ({ type: 'term', value: lit(raw, quoted) });
const match = (field: string, raw: string, quoted = false): DqlNode => ({ type: 'match', field: f(field), value: lit(raw, quoted) });
const and = (...children: DqlNode[]): DqlNode => ({ type: 'and', children });
const or = (...children: DqlNode[]): DqlNode => ({ type: 'or', children });
const not = (child: DqlNode): DqlNode => ({ type: 'not', child });

const p = (s: string): DqlNode => stripSpans(parseOrThrow(s));

describe('parse – valid queries', () => {
  const cases: [string, DqlNode][] = [
    ['', { type: 'match_all' }],
    ['   ', { type: 'match_all' }],
    ['*', { type: 'match_all' }],
    ['level:ERROR', match('level', 'ERROR')],
    ['level: ERROR', match('level', 'ERROR')],
    ['level:"and"', match('level', 'and', true)],
    ['error', term('error')],
    ['"connection refused"', term('connection refused', true)],
    ['error timeout', and(term('error'), term('timeout'))],
    ['a or b and c', or(term('a'), and(term('b'), term('c')))],
    ['not a and b', and(not(term('a')), term('b'))],
    ['not (a or b)', not(or(term('a'), term('b')))],
    ['(a or b) and c', and(or(term('a'), term('b')), term('c'))],
    ['a b or c', or(and(term('a'), term('b')), term('c'))],
    ['a AND b OR NOT c', or(and(term('a'), term('b')), not(term('c')))],
    ['((a))', term('a')],
    ['a and b and c', and(term('a'), term('b'), term('c'))],
    ['a or b or c', or(term('a'), term('b'), term('c'))],
    ['not not a', not(not(term('a')))],
    ['correlation_id:*', { type: 'exists', field: f('correlation_id') }],
    ['correlation_id:* and not tenant_id:*', and({ type: 'exists', field: f('correlation_id') }, not({ type: 'exists', field: f('tenant_id') }))],
    ['status>=500', { type: 'range', field: f('status'), op: '>=', value: lit('500') }],
    ['status:>=500', { type: 'range', field: f('status'), op: '>=', value: lit('500') }],
    ['status<600', { type: 'range', field: f('status'), op: '<', value: lit('600') }],
    ['ts>"2026-01-01"', { type: 'range', field: f('ts'), op: '>', value: lit('2026-01-01', true) }],
    ['logger:com.sap.*', { type: 'match', field: f('logger'), value: wild('com.sap.*') }],
    ['labels.*:prod', { type: 'match', field: f('labels.*'), value: lit('prod') }],
    ['a.b.c:x', match('a.b.c', 'x')],
    ['level:(ERROR or WARN)', or(match('level', 'ERROR'), match('level', 'WARN'))],
    ['level:(ERROR WARN)', and(match('level', 'ERROR'), match('level', 'WARN'))],
    ['level:(a and not b)', and(match('level', 'a'), not(match('level', 'b')))],
    ['level:((a or b) and c)', and(or(match('level', 'a'), match('level', 'b')), match('level', 'c'))],
    ['bytes:(>100 and <200)', and({ type: 'range', field: f('bytes'), op: '>', value: lit('100') }, { type: 'range', field: f('bytes'), op: '<', value: lit('200') })],
    ['tags:(* or x)', or({ type: 'exists', field: f('tags') }, match('tags', 'x'))],
    [
      'level:(ERROR or WARN) and not logger:com.sap.*',
      and(or(match('level', 'ERROR'), match('level', 'WARN')), not({ type: 'match', field: f('logger'), value: wild('com.sap.*') })),
    ],
    [
      'message:"connection refused" and status>=500 and status<600',
      and(match('message', 'connection refused', true), { type: 'range', field: f('status'), op: '>=', value: lit('500') }, { type: 'range', field: f('status'), op: '<', value: lit('600') }),
    ],
    ['url:http\\://x/y', match('url', 'http://x/y')],
    ['url:http://x/y', match('url', 'http://x/y')],
    ['ts>=2026-01-01T00:00:00Z', { type: 'range', field: f('ts'), op: '>=', value: lit('2026-01-01T00:00:00Z') }],
    ['a:b:c', match('a', 'b:c')],
    ['a:b:c d', and(match('a', 'b:c'), term('d'))],
    ['g:com.*:x*', { type: 'match', field: f('g'), value: wild('com.*:x*') }],
    ['and:x', match('and', 'x')],
    ['level:and', match('level', 'and')],
    ['@timestamp:x x-corr-id:y', and(match('@timestamp', 'x'), match('x-corr-id', 'y'))],
    ['format:2\\*3', match('format', '2*3')],
    ['msg:foo*', { type: 'match', field: f('msg'), value: wild('foo*') }],
    ['  level:ERROR  ', match('level', 'ERROR')],
  ];

  it.each(cases)('%s', (input, expected) => {
    expect(p(input)).toEqual(expected);
  });
});

describe('parse – errors', () => {
  const cases: [string, string, number][] = [
    ['level:', "Expected a value after ':'", 5],
    ['and level:x', 'Unexpected operator', 0],
    ['level:x and', "Unexpected end of query after 'and'", 11],
    ['level:x or', "Unexpected end of query after 'or'", 10],
    ['(level:x', "Expected ')'", 8],
    ['level:x)', "Unexpected ')'", 7],
    ['level:"open', 'Unterminated quoted string', 6],
    ['"open', 'Unterminated quoted string', 0],
    ['level:(a or)', "Expected a value after 'or'", 11],
    ['level>', "Range operator '>' requires a value", 5],
    ['level:()', 'Empty group', 6],
    ['()', 'Empty group', 0],
    [':x', "Unexpected ':'", 0],
    ['a :x', "Unexpected ':'", 2],
    ['not', "Unexpected end of query after 'not'", 3],
    ['a and and b', "Unexpected operator 'and'", 6],
    ['level:(and)', 'Unexpected operator', 7],
  ];

  it.each(cases)('%s', (input, message, start) => {
    const r = parse(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain(message);
      expect(r.error.start).toBe(start);
      expect(r.tokens.length).toBeGreaterThan(0);
    }
  });

  it('unterminated quote is a syntax error at the quote', () => {
    const r = parse('level:"open');
    expect(r.ok).toBe(false);
  });
});

describe('spans', () => {
  it('records spans on nodes', () => {
    const r = parseOrThrow('a and level:ERROR');
    expect(r.type).toBe('and');
    if (r.type === 'and') {
      expect(r.span).toEqual({ start: 0, end: 17 });
      const child = r.children[1]!;
      expect(child.type === 'match' && child.span).toEqual({ start: 6, end: 17 });
    }
  });

  it('astKey ignores whitespace and operator case', () => {
    expect(astKey(parseOrThrow('a  AND   b'))).toBe(astKey(parseOrThrow('a and b')));
    expect(astKey(parseOrThrow('a b'))).toBe(astKey(parseOrThrow('a and b')));
  });
});

describe('performance', () => {
  it('parses a 10k character query quickly', () => {
    const q = Array.from({ length: 700 }, (_, i) => `field${i}:value${i}`).join(' or ');
    const t0 = performance.now();
    const r = parse(q);
    expect(r.ok).toBe(true);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
