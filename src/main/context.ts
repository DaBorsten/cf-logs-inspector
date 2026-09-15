import type { ConnectionManager } from './cf/connection-manager';
import type { ExportManager } from './db/export-manager';
import type { WorkspaceManager } from './db/workspace-manager';
import type { StreamManager } from './ingest/stream-manager';
import type { Logger } from './log';
import type { UpdateManager } from './update/update-manager';

/** Long-lived services shared by IPC handlers. Created once in `index.ts` after `app.whenReady()`. */
export interface AppContext {
  connections: ConnectionManager;
  workspaces: WorkspaceManager;
  streams: StreamManager;
  exports: ExportManager;
  updates: UpdateManager;
  logger: Logger;
}
