import { parseOrThrow } from '@shared/dql';
import { compileDql, jsonPaths, QueryCompileError, sortExpression } from '../query-compiler';

const compile = (q: string) => compileDql(parseOrThrow(q));

describe('compileDql', () => {
  it('compiles match_all to a constant', () => {
    expect(compile('')).toEqual({ sql: '1', params: [] });
    expect(compile('*')).toEqual({ sql: '1', params: [] });
  });

  it('searches text fields for free terms with escaped LIKE patterns', () => {
    const c = compile('50%_off');
    expect(c.sql).toBe(`(message LIKE ? ESCAPE '\\' OR raw LIKE ? ESCAPE '\\')`);
    expect(c.params).toEqual(['%50\\%\\_off%', '%50\\%\\_off%']);
    expect(compile('err*').params).toEqual(['err%', 'err%']);
  });

  it('maps fixed fields and aliases to columns', () => {
    expect(compile('level:error')).toEqual({
      sql: `CAST(level AS TEXT) LIKE ? ESCAPE '\\'`,
      params: ['error'],
    });
    expect(compile('severity:ERR*').params).toEqual(['ERR%']);
    expect(compile('msg:cache').sql).toBe(`message LIKE ? ESCAPE '\\'`);
    expect(compile('app_name:api').sql).toContain('app_name');
    expect(compile('session:3').sql).toContain('session_id');
    expect(compile('ts:2026*').sql).toContain(`strftime('%Y-%m-%dT%H:%M:%fZ'`);
  });

  it('compiles boolean structure with NOT guarding NULLs', () => {
    const c = compile('level:error and not (app:api or stream:ERR)');
    expect(c.sql).toBe(
      `(CAST(level AS TEXT) LIKE ? ESCAPE '\\' AND (NOT COALESCE((CAST(app_name AS TEXT) LIKE ? ESCAPE '\\' OR CAST(stream AS TEXT) LIKE ? ESCAPE '\\'), 0)))`,
    );
    expect(c.params).toEqual(['error', 'api', 'ERR']);
  });

  it('compiles timestamp ranges to ts_ns with BigInt bounds', () => {
    const c = compile('ts>=2026-01-01T00:00:00Z and timestamp<2026-01-02');
    expect(c.sql).toBe('(ts_ns >= ? AND ts_ns < ?)');
    expect(c.params).toEqual([1_767_225_600_000n * 1_000_000n, 1_767_312_000_000n * 1_000_000n]);
    expect(compile('ts>1700000000000').params).toEqual([1_700_000_000_000n * 1_000_000n]);
    expect(() => compile('ts>yesterday')).toThrow(QueryCompileError);
  });

  it('compiles numeric fixed ranges numerically and text ranges with type dispatch', () => {
    expect(compile('instance>1')).toEqual({ sql: 'instance > ?', params: [1] });
    expect(compile('instance>a')).toEqual({ sql: 'CAST(instance AS TEXT) > ?', params: ['a'] });
    const c = compile('level>e');
    expect(c.sql).toBe('level > ?');
    const n = compile('app>=10');
    expect(n.sql).toContain('CAST(app_name AS REAL) >= ?');
    expect(n.params).toEqual([10, '10']);
  });

  it('compiles dynamic properties through json_type dispatch with path variants', () => {
    const c = compile('meta.region:eu');
    expect(c.sql).toContain(`json_type(props, '$."meta.region"')`);
    expect(c.sql).toContain(`json_each(props, '$."meta"."region"')`);
    expect(c.params).toEqual(['eu', 'eu', 'eu', 'eu']); // array-element and scalar branch per variant
    expect(compile('tenant:*').sql).toBe(
      `((json_type(props, '$."tenant"') IS NOT NULL AND json_type(props, '$."tenant"') <> 'null'))`,
    );
  });

  it('compiles wildcard field names via json_tree', () => {
    const c = compile('labels.*:prod');
    expect(c.sql).toContain('json_tree(props)');
    expect(c.params).toEqual(['labels.%', 'prod']);
    expect(compile('*_id:*').params).toEqual(['%\\_id']);
  });

  it('rejects invalid dynamic field names', () => {
    expect(() => compile('bad$name:1')).toThrow(QueryCompileError);
    expect(() => compile('1abc:1')).toThrow(QueryCompileError);
    expect(() => compile('a..b:1')).toThrow(QueryCompileError);
  });
});

describe('jsonPaths', () => {
  const ref = (name: string) => ({ name, path: name.split('.'), hasWildcard: false });
  it.each<[string, string[]]>([
    ['a', ['$."a"']],
    ['a.b', ['$."a.b"', '$."a"."b"']],
    ['a.b.c', ['$."a.b.c"', '$."a.b"."c"', '$."a"."b.c"', '$."a"."b"."c"']],
    ['a.b.c.d.e', ['$."a"."b"."c"."d"."e"']],
    ['x-y.@z_w', ['$."x-y.@z_w"', '$."x-y"."@z_w"']],
  ])('%s', (name, expected) => {
    expect(jsonPaths(ref(name))).toEqual(expected);
  });
});

describe('sortExpression', () => {
  it.each<[string, string | undefined]>([
    ['timestamp', 'ts_ns'],
    ['ts', 'ts_ns'],
    ['app', 'app_name'],
    ['id', 'id'],
    ['tenant', `json_extract(props, '$."tenant"')`],
    ['meta.region', `json_extract(props, '$."meta"."region"')`],
    ['bad name', undefined],
    ["x'y", undefined],
  ])('%s', (key, expected) => {
    expect(sortExpression(key)).toBe(expected);
  });
});
