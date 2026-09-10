import { parseOrThrow, stripSpans } from '../parser';
import { stringify } from '../stringify';

const roundTrip = (q: string): void => {
  const ast = stripSpans(parseOrThrow(q));
  const text = stringify(ast);
  expect(stripSpans(parseOrThrow(text))).toEqual(ast);
};

describe('stringify', () => {
  it.each([
    ['', ''],
    ['level:ERROR', 'level:ERROR'],
    ['a b', 'a and b'],
    ['a AND (b OR c)', 'a and (b or c)'],
    ['(a and b) or c', 'a and b or c'],
    ['not (a or b)', 'not (a or b)'],
    ['not a and b', 'not a and b'],
    ['level:(ERROR or WARN)', 'level:ERROR or level:WARN'],
    ['msg:"connection refused"', 'msg:"connection refused"'],
    ['msg:"say \\"hi\\""', 'msg:"say \\"hi\\""'],
    ['logger:com.sap.*', 'logger:com.sap.*'],
    ['f:2\\*3', 'f:2\\*3'],
    ['level:and', 'level:and'],
    ['"and"', '"and"'],
    ['\\and', '\\and'],
    ['x:*', 'x:*'],
    ['status>=500', 'status>=500'],
    ['status:>=500', 'status>=500'],
    ['url:http\\://x', 'url:http\\://x'],
    ['url:http://x', 'url:http\\://x'],
    ['my\\ field:x', 'my\\ field:x'],
  ])('%s → %s', (input, expected) => {
    expect(stringify(stripSpans(parseOrThrow(input)))).toBe(expected);
  });

  it.each([
    'level:(ERROR or WARN) and not logger:com.sap.*',
    'message:"connection refused" and status>=500 and status<600',
    'a or b and c',
    'not not a',
    '(a or b) and (c or d)',
    'not (a and b) or c',
    'labels.*:prod',
    'f:"a*b"',
    'f:2\\*3',
    'x\\ y',
    'url:http\\://x/y',
    '"quoted keyword and"',
    'level:and',
  ])('round-trips %s', roundTrip);
});
