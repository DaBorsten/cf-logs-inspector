import { tokenize } from '../tokenizer';

const types = (s: string): string[] => tokenize(s).map((t) => t.type);
const values = (s: string): string[] => tokenize(s).filter((t) => t.type === 'term' || t.type === 'quoted').map((t) => t.value);

describe('tokenize', () => {
  it('splits punctuation and terms', () => {
    expect(types('level:ERROR and (a or b)')).toEqual([
      'term', 'colon', 'term', 'term', 'lparen', 'term', 'term', 'term', 'rparen', 'eof',
    ]);
  });

  it('distinguishes >= from > and <= from <', () => {
    expect(types('a>=1 b>2 c<=3 d<4')).toEqual([
      'term', 'gte', 'term', 'term', 'gt', 'term', 'term', 'lte', 'term', 'term', 'lt', 'term', 'eof',
    ]);
  });

  it('records precededBySpace', () => {
    const toks = tokenize('a:b c : d');
    expect(toks.map((t) => t.precededBySpace)).toEqual([true, false, false, true, true, true, false]);
  });

  it('unescapes quoted strings and flags unterminated ones', () => {
    expect(values('"a \\"b\\" \\\\c"')).toEqual(['a "b" \\c']);
    const [t] = tokenize('"open');
    expect(t!.type).toBe('quoted');
    expect(t!.unterminated).toBe(true);
    expect(t!.value).toBe('open');
  });

  it('handles backslash escapes in terms', () => {
    expect(values('url:http\\://x/y')).toEqual(['url', 'http://x/y']);
    expect(values('a\\ b')).toEqual(['a b']);
    expect(values('x\\(y\\)')).toEqual(['x(y)']);
  });

  it('records wildcard segments only for unescaped *', () => {
    const [t] = tokenize('com.sap.*Foo*');
    expect(t!.wildcardSegments).toEqual(['com.sap.', 'Foo', '']);
    const [u] = tokenize('2\\*3');
    expect(u!.value).toBe('2*3');
    expect(u!.wildcardSegments).toBeUndefined();
  });

  it('accepts unicode and special characters in terms', () => {
    expect(values('nachricht:über @timestamp x-correlation-id')).toEqual(['nachricht', 'über', '@timestamp', 'x-correlation-id']);
  });

  it('tabs and newlines are whitespace', () => {
    expect(types('a\tb\nc')).toEqual(['term', 'term', 'term', 'eof']);
  });

  it('handles a trailing lone backslash', () => {
    expect(values('abc\\')).toEqual(['abc\\']);
  });
});
