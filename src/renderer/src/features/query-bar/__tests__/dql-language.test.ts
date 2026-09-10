import { EditorState } from '@codemirror/state';
import { completionContextAt } from '@shared/dql';
import {
  classifyTokens,
  completionOptions,
  dqlDiagnostics,
  quoteValue,
  singleLine,
  type CompletionDeps,
} from '../dql-language';

const classes = (input: string): string[] =>
  classifyTokens(input).map((r) => `${input.slice(r.from, r.to)}=${r.cls}`);

describe('classifyTokens', () => {
  it.each<[string, string[]]>([
    ['level:ERROR', ['level=field', ':=operator', 'ERROR=value']],
    ['error', ['error=term']],
    ['a and not b', ['a=term', 'and=keyword', 'not=keyword', 'b=term']],
    ['and:x', ['and=field', ':=operator', 'x=value']],
    ['\\and', ['\\and=term']],
    [
      'level:(a or b)',
      ['level=field', ':=operator', '(=paren', 'a=term', 'or=keyword', 'b=term', ')=paren'],
    ],
    ['count>=3', ['count=field', '>==operator', '3=value']],
    ['"a phrase"', ['"a phrase"=quoted']],
    ['"unterminated', ['"unterminated=error']],
    ['url:http://x/y', ['url=field', ':=operator', 'http=value', ':=operator', '//x/y=value']],
    ['', []],
  ])('%s', (input, expected) => {
    expect(classes(input)).toEqual(expected);
  });
});

describe('dqlDiagnostics', () => {
  it.each<[string, string | undefined]>([
    ['', undefined],
    ['   ', undefined],
    ['level:ERROR and app:api', undefined],
    ['level:', 'Expected a value'],
    ['(a or b', "Expected ')'"],
    ['a or', 'Unexpected end of query'],
    ['"open', 'Unterminated quoted string'],
    [':x', 'A field name must directly precede'],
  ])('%s', (input, message) => {
    const d = dqlDiagnostics(input);
    if (message === undefined) expect(d).toEqual([]);
    else {
      expect(d).toHaveLength(1);
      expect(d[0]!.message).toContain(message);
      expect(d[0]!.severity).toBe('error');
      expect(d[0]!.to).toBeGreaterThan(d[0]!.from);
      expect(d[0]!.to).toBeLessThanOrEqual(Math.max(input.length, d[0]!.from + 1));
    }
  });
});

describe('quoteValue', () => {
  it.each([
    ['simple', 'simple'],
    ['has space', '"has space"'],
    ['a:b', '"a:b"'],
    ['say "hi"', '"say \\"hi\\""'],
    ['', '""'],
    ['star*', '"star*"'],
  ])('%s -> %s', (input, expected) => {
    expect(quoteValue(input)).toBe(expected);
  });
});

describe('completionOptions', () => {
  const deps: CompletionDeps = {
    fields: () => ['level', 'message', 'tenant'],
    values: async (field, prefix) =>
      field === 'level'
        ? ['ERROR', 'INFO', 'WARN'].filter((v) => v.toLowerCase().startsWith(prefix.toLowerCase()))
        : field === 'tenant'
          ? ['t 1', 'plain']
          : [],
  };
  const at = (text: string, pos = text.length) => completionContextAt(text, pos);

  it('offers fields (inserting a colon) and `not` at the start', async () => {
    const opts = await completionOptions(at(''), deps);
    expect(opts.map((o) => o.label)).toEqual(['level', 'message', 'tenant', 'not']);
    expect(opts[0]).toMatchObject({ apply: 'level:', type: 'property' });
  });

  it('offers values after a colon, quoting when needed, plus the exists wildcard', async () => {
    const opts = await completionOptions(at('level:'), deps);
    expect(opts.map((o) => o.apply)).toEqual(['ERROR', 'INFO', 'WARN', undefined]);
    expect(opts.at(-1)).toMatchObject({ label: '*', detail: 'exists' });
    const tenant = await completionOptions(at('tenant:'), deps);
    expect(tenant.map((o) => o.apply)).toEqual(['"t 1"', 'plain', undefined]);
  });

  it('keeps quoted context quoted', async () => {
    const ctx = at('tenant:"t');
    expect(ctx.kind).toBe('value');
    const opts = await completionOptions(ctx, deps, true);
    expect(opts.map((o) => o.label)).toEqual(['"t 1"', '"plain"']);
  });

  it('offers operators after a complete clause', async () => {
    const opts = await completionOptions(at('level:ERROR '), deps);
    expect(opts.map((o) => o.label)).toEqual(['and', 'or', 'not']);
    expect(opts[0]).toMatchObject({ apply: 'and ' });
  });

  it('returns nothing for none contexts and swallows value fetch errors', async () => {
    expect(await completionOptions({ kind: 'none' }, deps)).toEqual([]);
    const failing: CompletionDeps = {
      fields: () => [],
      values: () => Promise.reject(new Error('x')),
    };
    const opts = await completionOptions(at('level:'), failing);
    expect(opts.map((o) => o.label)).toEqual(['*']);
  });
});

describe('singleLine', () => {
  it('flattens pasted newlines into spaces', () => {
    const state = EditorState.create({ doc: 'a', extensions: [singleLine] });
    const next = state.update({ changes: { from: 1, insert: '\nb\r\nc' } }).state;
    expect(next.doc.toString()).toBe('a b c');
    expect(next.doc.lines).toBe(1);
  });
});
