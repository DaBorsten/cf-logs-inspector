import {
  countEntriesFor,
  distinctValues,
  getEntry,
  listPropInfos,
  queryEntries,
} from '../db/entry-query';
import type { AppContext } from '../context';
import { handle } from './handle';
import {
  entryCountSchema,
  entryIdSchema,
  entryQuerySchema,
  propsListSchema,
  valuesQuerySchema,
} from './schemas';

export function registerEntryHandlers(ctx: AppContext): void {
  handle('entries:query', entryQuerySchema, (req) => queryEntries(ctx.workspaces.db(), req));
  handle('entries:count', entryCountSchema, (req) => countEntriesFor(ctx.workspaces.db(), req));
  handle('entries:get', entryIdSchema, ({ id }) => getEntry(ctx.workspaces.db(), id));
  handle('entries:values', valuesQuerySchema, (req) => distinctValues(ctx.workspaces.db(), req));
  handle('props:list', propsListSchema, ({ sessionIds }) =>
    listPropInfos(ctx.workspaces.db(), sessionIds),
  );
}
