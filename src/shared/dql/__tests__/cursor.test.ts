import { completionContextAt, type CompletionContext } from '../cursor';

/** `|` marks the cursor. */
function ctx(s: string): CompletionContext {
  const cursor = s.indexOf('|');
  return completionContextAt(s.replace('|', ''), cursor);
}

describe('completionContextAt', () => {
  it.each<[string, Partial<CompletionContext>]>([
    ['|', { kind: 'field-or-term', prefix: '' }],
    ['lev|', { kind: 'field-or-term', prefix: 'lev' }],
    ['level:|', { kind: 'value', field: 'level', prefix: '' }],
    ['level: |', { kind: 'value', field: 'level', prefix: '' }],
    ['level:ER|', { kind: 'value', field: 'level', prefix: 'ER' }],
    ['level:ERROR|', { kind: 'value', field: 'level', prefix: 'ERROR' }],
    ['level:"ER|', { kind: 'value', field: 'level', prefix: 'ER' }],
    ['status>=|', { kind: 'value', field: 'status', prefix: '' }],
    ['status:>=5|', { kind: 'value', field: 'status', prefix: '5' }],
    ['level:(ERR|', { kind: 'value', field: 'level', prefix: 'ERR', inGroup: true }],
    ['level:(ERROR or |', { kind: 'value', field: 'level', prefix: '', inGroup: true }],
    ['level:(ERROR or WA|', { kind: 'value', field: 'level', prefix: 'WA', inGroup: true }],
    ['level:ERROR |', { kind: 'operator', prefix: '' }],
    ['level:ERROR an|', { kind: 'operator', prefix: 'an' }],
    ['level:ERROR and |', { kind: 'field-or-term', prefix: '' }],
    ['level:ERROR and lo|', { kind: 'field-or-term', prefix: 'lo' }],
    ['not |', { kind: 'field-or-term', prefix: '' }],
    ['(|', { kind: 'field-or-term', prefix: '' }],
    ['(a or b) |', { kind: 'operator', prefix: '' }],
    ['"free text" |', { kind: 'operator', prefix: '' }],
    ['level:ERROR| and x', { kind: 'value', field: 'level', prefix: 'ERROR' }],
  ])('%s', (input, expected) => {
    expect(ctx(input)).toMatchObject(expected);
  });

  it('value context outside a group has inGroup false', () => {
    expect(ctx('level:ER|')).toMatchObject({ inGroup: false });
  });

  it('replace range covers the whole token being edited', () => {
    const c = ctx('level:ERR|OR');
    expect(c).toMatchObject({ kind: 'value', replace: { start: 6, end: 11 } });
  });
});
