import { cellHeight, previewLines, valueLines } from '../multiline';

describe('valueLines', () => {
  it.each([
    ['no newline', 'plain text', null],
    ['single newline', 'a\nb', ['a', 'b']],
    ['multiple newlines', 'a\nb\nc', ['a', 'b', 'c']],
    ['empty string', '', null],
  ])('%s', (_label, input, expected) => {
    expect(valueLines(input)).toEqual(expected);
  });
});

describe('previewLines', () => {
  it('shows all lines with no toggle when at or under the preview threshold', () => {
    const result = previewLines(['a', 'b', 'c'], false);
    expect(result).toEqual({ visibleLines: ['a', 'b', 'c'], hasMore: false, moreCount: 0 });
  });

  it('shows only the first 3 lines and reports the remainder when collapsed', () => {
    const result = previewLines(['a', 'b', 'c', 'd', 'e'], false);
    expect(result).toEqual({ visibleLines: ['a', 'b', 'c'], hasMore: true, moreCount: 2 });
  });

  it('shows every line but keeps the toggle available when expanded', () => {
    const result = previewLines(['a', 'b', 'c', 'd', 'e'], true);
    expect(result).toEqual({
      visibleLines: ['a', 'b', 'c', 'd', 'e'],
      hasMore: true,
      moreCount: 2,
    });
  });
});

describe('cellHeight', () => {
  it.each([
    [1, false, 28],
    [3, false, 60],
    [4, false, 78],
    [10, false, 78],
    [4, true, 94],
    [10, true, 190],
  ])('cellHeight(%i, %s) === %i', (totalLines, expanded, expected) => {
    expect(cellHeight(totalLines, expanded)).toBe(expected);
  });
});
