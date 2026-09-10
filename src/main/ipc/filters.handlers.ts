import { deleteFilter, listFilters, saveFilter } from '../db/repos/filters';
import type { AppContext } from '../context';
import { handle } from './handle';
import { filterIdSchema, savedFilterSchema } from './schemas';

export function registerFilterHandlers(ctx: AppContext): void {
  handle('filters:list', undefined, () => listFilters(ctx.workspaces.db()));
  handle('filters:save', savedFilterSchema, (req) =>
    saveFilter(ctx.workspaces.db(), req, Date.now()),
  );
  handle('filters:delete', filterIdSchema, ({ id }) => deleteFilter(ctx.workspaces.db(), id));
}
