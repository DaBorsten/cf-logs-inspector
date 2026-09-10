import { app } from 'electron';
import { parse } from '@shared/dql';
import type { AppContext } from '../context';
import { registerAuthHandlers } from './auth.handlers';
import { registerCfHandlers } from './cf.handlers';
import { registerConnectionHandlers } from './connection.handlers';
import { registerEntryHandlers } from './entries.handlers';
import { registerExportHandlers } from './export.handlers';
import { registerFilterHandlers } from './filters.handlers';
import { handle } from './handle';
import { validateDqlSchema } from './schemas';
import { registerSessionHandlers } from './session.handlers';
import { registerWorkspaceHandlers } from './workspace.handlers';

/** Registers all invoke handlers. Domain handlers live in `*.handlers.ts` files. */
export function registerIpcHandlers(ctx: AppContext): void {
  handle('app:version', undefined, () => app.getVersion());
  handle('entries:validateDql', validateDqlSchema, ({ dql }) => {
    const result = parse(dql);
    return result.ok
      ? { ok: true }
      : {
          ok: false,
          error: {
            message: result.error.message,
            start: result.error.start,
            end: result.error.end,
          },
        };
  });
  registerConnectionHandlers(ctx);
  registerAuthHandlers(ctx);
  registerCfHandlers(ctx);
  registerWorkspaceHandlers(ctx);
  registerSessionHandlers(ctx);
  registerEntryHandlers(ctx);
  registerFilterHandlers(ctx);
  registerExportHandlers(ctx);
}
