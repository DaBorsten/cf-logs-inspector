import type { AppContext } from '../context';
import { handle } from './handle';
import {
  idSchema,
  kvGetSchema,
  kvSetSchema,
  workspaceNameSchema,
  workspacePathSchema,
} from './schemas';

export function registerWorkspaceHandlers(ctx: AppContext): void {
  handle('workspace:list', undefined, () => ctx.workspaces.list());
  handle('workspace:create', workspaceNameSchema, ({ name }) => ctx.workspaces.create(name));
  handle('workspace:open', idSchema, ({ id }) => ctx.workspaces.openById(id));
  handle('workspace:openFile', workspacePathSchema, ({ path }) => ctx.workspaces.openFile(path));
  handle('workspace:delete', idSchema, ({ id }) => ctx.workspaces.delete(id));
  handle('workspace:current', undefined, () => ctx.workspaces.current() ?? null);
  handle('workspace:stats', undefined, () => ctx.workspaces.stats());
  handle('workspace:kvGet', kvGetSchema, ({ key }) => ctx.workspaces.kvGet(key));
  handle('workspace:kvSet', kvSetSchema, ({ key, value }) => ctx.workspaces.kvSet(key, value));
}
