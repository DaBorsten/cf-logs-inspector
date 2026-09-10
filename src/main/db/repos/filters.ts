import type Database from 'better-sqlite3';
import type { SavedFilter, SavedFilterInput } from '@shared/model/filters';
import type { TimeFilter } from '@shared/model/query';
import { InvalidInputError, NotFoundError } from '../../cf/errors';

type Db = Database.Database;

interface Row {
  id: number;
  name: string;
  dql: string;
  time_filter: string | null;
  created_at: number;
  updated_at: number;
}

function toFilter(r: Row): SavedFilter {
  const f: SavedFilter = {
    id: r.id,
    name: r.name,
    dql: r.dql,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (r.time_filter) {
    try {
      f.timeFilter = JSON.parse(r.time_filter) as TimeFilter;
    } catch {
      /* ignore corrupt time filter */
    }
  }
  return f;
}

export function listFilters(db: Db): SavedFilter[] {
  return (
    db
      .prepare(
        `SELECT id, name, dql, time_filter, created_at, updated_at FROM saved_filters ORDER BY name COLLATE NOCASE`,
      )
      .all() as Row[]
  ).map(toFilter);
}

export function getFilter(db: Db, id: number): SavedFilter {
  const row = db
    .prepare(
      `SELECT id, name, dql, time_filter, created_at, updated_at FROM saved_filters WHERE id = ?`,
    )
    .get(id) as Row | undefined;
  if (!row) throw new NotFoundError(`Unknown filter ${id}`);
  return toFilter(row);
}

/** Insert or update. Without `id`, an existing filter with the same name (case-insensitive) is updated. */
export function saveFilter(db: Db, input: SavedFilterInput, now: number): SavedFilter {
  const name = input.name.trim();
  if (!name) throw new InvalidInputError('Filter name is required');
  const dql = input.dql.trim();
  const timeFilter = input.timeFilter ? JSON.stringify(input.timeFilter) : null;
  let id = input.id;
  if (id === undefined) {
    const existing = db
      .prepare(`SELECT id FROM saved_filters WHERE name = ? COLLATE NOCASE`)
      .get(name) as { id: number } | undefined;
    id = existing?.id;
  }
  if (id !== undefined) {
    const info = db
      .prepare(
        `UPDATE saved_filters SET name = @name, dql = @dql, time_filter = @timeFilter, updated_at = @now WHERE id = @id`,
      )
      .run({ id, name, dql, timeFilter, now });
    if (info.changes === 0) throw new NotFoundError(`Unknown filter ${id}`);
    return getFilter(db, id);
  }
  const result = db
    .prepare(
      `INSERT INTO saved_filters (name, dql, time_filter, created_at, updated_at) VALUES (@name, @dql, @timeFilter, @now, @now)`,
    )
    .run({ name, dql, timeFilter, now });
  return getFilter(db, Number(result.lastInsertRowid));
}

export function deleteFilter(db: Db, id: number): void {
  const info = db.prepare(`DELETE FROM saved_filters WHERE id = ?`).run(id);
  if (info.changes === 0) throw new NotFoundError(`Unknown filter ${id}`);
}
