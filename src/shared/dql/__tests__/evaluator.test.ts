import { parseOrThrow } from '../parser';
import { compileMatcher, evaluate, collectHighlightTerms } from '../evaluator';

const rec = {
  message: 'Connection refused: db-host:5432',
  level: 'ERROR',
  logger: 'com.sap.Orders',
  status: 503,
  latency: '12.5',
  correlation_id: 'abc-123',
  tags: ['prod', 'eu10'],
  labels: { tenant: 'acme', region: 'eu' },
  'x.flat': 'flatvalue',
  empty: '',
  zero: 0,
  falsy: false,
  nil: null,
  timestamp: '2026-09-10T12:00:00.000Z',
  'a.b': { c: 'nested-under-flat' },
};

const m = (q: string, r: Record<string, unknown> = rec): boolean => evaluate(parseOrThrow(q), r);

describe('evaluate', () => {
  const truthy: string[] = [
    '',
    '*',
    'level:ERROR',
    'level:error',
    'level:(ERROR or WARN)',
    'not level:WARN',
    'message:refused',            // text field: substring
    'message:"connection refused"',
    'refused',                    // free text
    'refused db-host',            // implicit and
    '"db-host:5432"',
    'logger:com.sap.*',
    'logger:*Orders',
    'logger:*sap*',
    'logger:com.sap.Orders',
    'status:503',
    'status>500',
    'status>=503',
    'status<600',
    'status:(>500 and <600)',
    'latency>12',
    'latency<=12.5',
    'correlation_id:*',
    'not tenant_id:*',
    'tags:prod',
    'tags:eu*',
    'labels.tenant:acme',
    'labels.*:acme',
    'labels.*:eu',
    'x.flat:flatvalue',
    'empty:*',
    'zero:*',
    'zero:0',
    'falsy:*',
    'falsy:false',
    'timestamp>"2026-09-10"',
    'timestamp>=2026-09-10T12:00:00.000Z',
    'timestamp<2026-09-11',
    'a.b.c:nested-under-flat',
    'level:ERROR and status>500 and not logger:foo',
    '(level:WARN or level:ERROR) and refused',
    'unknown:x or level:ERROR',
  ];
  it.each(truthy)('matches: %s', (q) => expect(m(q)).toBe(true));

  const falsy: string[] = [
    'level:ERR',                 // keyword: exact, not substring
    'level:WARN',
    'not level:ERROR',
    'message:"refused connection"',
    'logger:com.sap',
    'logger:com.sap.*x',
    'status>503',
    'status<503',
    'status:5',
    'nil:*',
    'tenant_id:*',
    'tags:pro',
    'labels:acme',               // object never matches
    'labels.*:zzz',
    'timestamp>2026-09-11',
    'msg:a.b*',                  // regex meta escaped
    'unknown:x',
    'unknown>1',
  ];
  it.each(falsy)('does not match: %s', (q) => expect(m(q)).toBe(false));

  it('regex metacharacters in wildcards are literal', () => {
    expect(m('logger:com.sap.Orders', { logger: 'comXsapXOrders' })).toBe(false);
    expect(m('logger:com*Orders', { logger: 'comXsapXOrders' })).toBe(true);
    expect(m('logger:com.*', { logger: 'comXsap' })).toBe(false);
  });

  it('escaped wildcard is literal', () => {
    expect(m('f:2\\*3', { f: '2*3' })).toBe(true);
    expect(m('f:2\\*3', { f: '2x3' })).toBe(false);
  });

  it('non-numeric range falls back to lexicographic', () => {
    expect(m('name>b', { name: 'c' })).toBe(true);
    expect(m('name>b', { name: 'a' })).toBe(false);
  });

  it('respects custom textFields', () => {
    const ast = parseOrThrow('trace');
    expect(evaluate(ast, { message: 'x', stacktrace: 'stack trace' })).toBe(false);
    expect(evaluate(ast, { message: 'x', stacktrace: 'stack trace' }, { textFields: ['message', 'stacktrace'] })).toBe(true);
  });

  it('compileMatcher is reusable', () => {
    const matcher = compileMatcher(parseOrThrow('level:ERROR'));
    expect(matcher({ level: 'ERROR' })).toBe(true);
    expect(matcher({ level: 'INFO' })).toBe(false);
  });
});

describe('collectHighlightTerms', () => {
  it('collects only positive literals', () => {
    const terms = collectHighlightTerms(parseOrThrow('refused and level:ERROR and not logger:foo or not (x and y)'));
    expect(terms.map((t) => `${t.field ?? ''}=${t.literal.raw}`)).toEqual(['=refused', 'level=ERROR']);
  });
});
