import type { AppContext } from '../context';
import { handle } from './handle';
import {
  sessionCreateSchema,
  sessionIdSchema,
  sessionIntervalSchema,
  sessionStartSchema,
} from './schemas';

export function registerSessionHandlers(ctx: AppContext): void {
  handle('session:list', undefined, () => ctx.streams.list());
  handle('session:create', sessionCreateSchema, (req) => ctx.streams.create(req));
  handle('session:start', sessionStartSchema, ({ sessionId, recent }) =>
    ctx.streams.start(sessionId, recent ?? false),
  );
  handle('session:stop', sessionIdSchema, ({ sessionId }) => ctx.streams.stop(sessionId));
  handle('session:setInterval', sessionIntervalSchema, ({ sessionId, pollIntervalMs }) =>
    ctx.streams.setInterval(sessionId, pollIntervalMs),
  );
  handle('session:clear', sessionIdSchema, ({ sessionId }) => ctx.streams.clear(sessionId));
  handle('session:delete', sessionIdSchema, ({ sessionId }) => ctx.streams.delete(sessionId));
}
