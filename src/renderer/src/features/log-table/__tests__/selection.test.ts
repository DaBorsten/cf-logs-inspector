import { EMPTY_SELECTION, moveSelection, selectByClick, type Selection } from '../selection';
import { appendClause, quoteDqlValue, scalarToDql } from '../../../lib/dql-edit';
import { buildHighlightTerms, highlightSegments } from '../highlight';

const rows = [10, 20, 30, 40, 50];

describe('selectByClick', () => {
  it('selects a single row, toggles with ctrl and ranges with shift', () => {
    let s: Selection = selectByClick(EMPTY_SELECTION, rows, 20);
    expect(s).toEqual({ ids: [20], anchor: 20, focus: 20 });
    s = selectByClick(s, rows, 40, { ctrl: true });
    expect(s).toEqual({ ids: [20, 40], anchor: 40, focus: 40 });
    s = selectByClick(s, rows, 20, { ctrl: true });
    expect(s).toEqual({ ids: [40], anchor: 20, focus: 40 });
    s = selectByClick(s, rows, 50, { shift: true });
    expect(s).toEqual({ ids: [20, 30, 40, 50], anchor: 20, focus: 50 });
    s = selectByClick(s, rows, 10, { shift: true, ctrl: true });
    expect(s.ids).toEqual([20, 30, 40, 50, 10]);
    expect(selectByClick(s, rows, 30)).toEqual({ ids: [30], anchor: 30, focus: 30 });
  });

  it('falls back to the clicked row when the anchor is gone', () => {
    const s = selectByClick({ ids: [99], anchor: 99, focus: 99 }, rows, 30, { shift: true });
    expect(s).toEqual({ ids: [30], anchor: 99, focus: 30 });
  });
});

describe('moveSelection', () => {
  it('moves the focus and clamps at the ends', () => {
    let s = moveSelection(EMPTY_SELECTION, rows, 'down');
    expect(s).toEqual({ ids: [10], anchor: 10, focus: 10 });
    s = moveSelection(s, rows, 'down');
    expect(s.focus).toBe(20);
    s = moveSelection(s, rows, 'up');
    s = moveSelection(s, rows, 'up');
    expect(s.focus).toBe(10);
    s = moveSelection(s, rows, 'end');
    expect(s.focus).toBe(50);
    s = moveSelection(s, rows, 'pageUp', false, 2);
    expect(s.focus).toBe(30);
    s = moveSelection(s, rows, 'pageDown', false, 10);
    expect(s.focus).toBe(50);
    s = moveSelection(s, rows, 'home');
    expect(s).toEqual({ ids: [10], anchor: 10, focus: 10 });
  });

  it('extends the range from the anchor with shift', () => {
    let s = selectByClick(EMPTY_SELECTION, rows, 30);
    s = moveSelection(s, rows, 'down', true);
    s = moveSelection(s, rows, 'down', true);
    expect(s).toEqual({ ids: [30, 40, 50], anchor: 30, focus: 50 });
    s = moveSelection(s, rows, 'home', true);
    expect(s).toEqual({ ids: [10, 20, 30], anchor: 30, focus: 10 });
  });

  it('does nothing without rows', () => {
    expect(moveSelection(EMPTY_SELECTION, [], 'down')).toBe(EMPTY_SELECTION);
  });
});

describe('dql-edit', () => {
  it.each([
    ['plain', 'plain'],
    ['has space', '"has space"'],
    ['a:b', '"a:b"'],
    ['q"uote', '"q\\"uote"'],
    ['', '""'],
  ])('quotes %j', (input, expected) => {
    expect(quoteDqlValue(input)).toBe(expected);
  });

  it('renders scalars and rejects containers', () => {
    expect(scalarToDql(3)).toBe('3');
    expect(scalarToDql(true)).toBe('true');
    expect(scalarToDql('x y')).toBe('"x y"');
    expect(scalarToDql(null)).toBeUndefined();
    expect(scalarToDql({ a: 1 })).toBeUndefined();
    expect(scalarToDql([1])).toBeUndefined();
  });

  it('appends clauses with an explicit and, negation and quoting', () => {
    expect(appendClause('', 'level', 'ERROR')).toBe('level:ERROR');
    expect(appendClause('level:ERROR', 'tenant', 't 1')).toBe('level:ERROR and tenant:"t 1"');
    expect(appendClause('a', 'meta.region', 'eu', true)).toBe('a and not meta.region:eu');
    expect(appendClause('a', 'instance', 0)).toBe('a and instance:0');
    expect(appendClause('a', 'bad name', 'x')).toBe('a');
    expect(appendClause('a', 'meta', { x: 1 })).toBe('a');
  });
});

describe('highlight', () => {
  it('builds terms from positive message literals only', () => {
    const terms = buildHighlightTerms(
      'cache and level:ERROR and not miss and message:hit* or app:api',
    );
    expect(terms.map((r) => r.source)).toEqual(['cache', 'hit']);
    expect(buildHighlightTerms('level:')).toEqual([]);
    expect(buildHighlightTerms('')).toEqual([]);
    expect(buildHighlightTerms('*ab*cd*').map((r) => r.source)).toEqual(['ab.*?cd']);
  });

  it('splits text into merged segments', () => {
    const terms = buildHighlightTerms('cache "Cache miss"');
    const segs = highlightSegments('A cache miss for CACHE key', terms);
    expect(segs).toEqual([
      { text: 'A ', hit: false },
      { text: 'cache miss', hit: true },
      { text: ' for ', hit: false },
      { text: 'CACHE', hit: true },
      { text: ' key', hit: false },
    ]);
    expect(highlightSegments('nothing', terms)).toEqual([{ text: 'nothing', hit: false }]);
    expect(highlightSegments('x', [])).toEqual([{ text: 'x', hit: false }]);
  });
});
