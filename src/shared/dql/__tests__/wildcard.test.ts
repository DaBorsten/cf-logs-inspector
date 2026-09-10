import { segmentsToRegExp, segmentsToLike, containsToLike, escapeLike, globToRegExp } from '../wildcard';

/** Minimal LIKE emulation (ESCAPE '\', case-insensitive) to prove regex and LIKE agree. */
function like(value: string, pattern: string): boolean {
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '\\') {
      re += pattern[++i]!.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    } else if (c === '%') re += '.*';
    else if (c === '_') re += '.';
    else re += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return new RegExp(re + '$', 'is').test(value);
}

const table: [string[], string, boolean][] = [
  [['com.sap.', ''], 'com.sap.Orders', true],
  [['com.sap.', ''], 'comXsapXOrders', false],
  [['', 'Orders'], 'com.sap.Orders', true],
  [['', 'sap', ''], 'com.sap.Orders', true],
  [['a_b'], 'a_b', true],
  [['a_b'], 'axb', false],
  [['100%'], '100%', true],
  [['100%'], '1000', false],
  [['', '%', ''], 'x%y', true],
  [['', '%', ''], 'xy', false],
  [['back\\slash'], 'back\\slash', true],
  [['ERR'], 'err', true],
  [['ERR'], 'error', false],
  [['a', 'b', 'c'], 'aXbYc', true],
  [['a', 'b', 'c'], 'acb', false],
  [[''], '', true],
  [['', ''], 'anything', true],
];

describe('wildcard: regex and LIKE agree', () => {
  it.each(table)('%j vs %s', (segments, value, expected) => {
    expect(segmentsToRegExp(segments).test(value)).toBe(expected);
    expect(like(value, segmentsToLike(segments))).toBe(expected);
  });

  it('containsToLike / escapeLike', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
    expect(like('xx a%b yy', containsToLike('a%b'))).toBe(true);
    expect(like('xx aXb yy', containsToLike('a%b'))).toBe(false);
  });

  it('globToRegExp treats every * as wildcard', () => {
    expect(globToRegExp('labels.*').test('labels.tenant')).toBe(true);
    expect(globToRegExp('labels.*').test('labelsXtenant')).toBe(false);
  });
});
