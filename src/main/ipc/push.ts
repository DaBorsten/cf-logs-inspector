import { BrowserWindow } from 'electron';
import type { PushEvents } from '@shared/ipc/contracts';

/** Sends a typed push event to every open renderer window. */
export function pushEvent<E extends keyof PushEvents>(event: E, payload: PushEvents[E]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(event, payload);
  }
}
