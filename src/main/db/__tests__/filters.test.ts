import Database from 'better-sqlite3';
import { deleteFilter, getFilter, listFilters, saveFilter } from '../repos/filters';
import { migrate } from '../schema';

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
});
afterEach(() => db.close());

describe('saved filters repo', () => {
  it('creates, lists (case-insensitive by name), updates by id and by name, deletes', () => {
    const a = saveFilter(db, { name: 'Zeta errors', dql: 'level:error' }, 1);
    const b = saveFilter(
      db,
      { name: 'alpha', dql: 'app:api', timeFilter: { kind: 'relative', amount: 1, unit: 'h' } },
      2,
    );
    expect(listFilters(db).map((f) => f.name)).toEqual(['alpha', 'Zeta errors']);
    expect(b.timeFilter).toEqual({ kind: 'relative', amount: 1, unit: 'h' });
    expect(a.timeFilter).toBeUndefined();

    const renamed = saveFilter(db, { id: a.id, name: 'errors', dql: 'level:(error or fatal)' }, 3);
    expect(renamed).toMatchObject({ id: a.id, name: 'errors', createdAt: 1, updatedAt: 3 });

    const overwritten = saveFilter(db, { name: 'ALPHA', dql: 'app:worker' }, 4);
    expect(overwritten.id).toBe(b.id);
    expect(overwritten).toMatchObject({ name: 'ALPHA', dql: 'app:worker', createdAt: 2 });
    expect(overwritten.timeFilter).toBeUndefined(); // saving without a time filter clears it
    expect(listFilters(db)).toHaveLength(2);

    deleteFilter(db, a.id);
    expect(listFilters(db).map((f) => f.id)).toEqual([b.id]);
    expect(() => deleteFilter(db, a.id)).toThrow(/Unknown filter/);
    expect(() => getFilter(db, 999)).toThrow(/Unknown filter/);
  });

  it('validates the name and trims input', () => {
    expect(() => saveFilter(db, { name: '   ', dql: 'x' }, 1)).toThrow(/name is required/i);
    expect(saveFilter(db, { name: '  spaced  ', dql: '  level:info  ' }, 1)).toMatchObject({
      name: 'spaced',
      dql: 'level:info',
    });
    expect(() => saveFilter(db, { id: 42, name: 'x', dql: 'y' }, 1)).toThrow(/Unknown filter 42/);
  });
});
