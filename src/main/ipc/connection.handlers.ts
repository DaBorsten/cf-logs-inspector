import type { AppContext } from '../context';
import { handle } from './handle';
import { connectionInputSchema, connectionTestSchema, idSchema } from './schemas';

export function registerConnectionHandlers(ctx: AppContext): void {
  handle('connection:list', undefined, () => ctx.connections.list());
  handle('connection:save', connectionInputSchema, (req) => ctx.connections.save(req));
  handle('connection:delete', idSchema, ({ id }) => ctx.connections.delete(id));
  handle('connection:test', connectionTestSchema, (req) => ctx.connections.test(req));
}
