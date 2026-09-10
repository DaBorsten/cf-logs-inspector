import type { ConnectionManager } from './cf/connection-manager';
import type { Logger } from './log';

/** Long-lived services shared by IPC handlers. Created once in `index.ts` after `app.whenReady()`. */
export interface AppContext {
  connections: ConnectionManager;
  logger: Logger;
}
