import { ipcMain } from 'electron';
import { parse } from '@shared/dql';
import type { IpcContracts } from '@shared/ipc/contracts';

type Handler<K extends keyof IpcContracts> = (
  req: IpcContracts[K]['req'],
) => Promise<IpcContracts[K]['res']> | IpcContracts[K]['res'];

function handle<K extends keyof IpcContracts>(channel: K, handler: Handler<K>): void {
  ipcMain.handle(channel, async (_event, req: IpcContracts[K]['req']) => {
    try {
      return { ok: true, value: await handler(req) };
    } catch (err) {
      const e = err as { code?: string; message?: string; details?: unknown };
      return {
        ok: false,
        error: { code: e.code ?? 'INTERNAL', message: e.message ?? String(err), details: e.details },
      };
    }
  });
}

/** Registers all invoke handlers. Domain handlers are added milestone by milestone. */
export function registerIpcHandlers(): void {
  handle('app:version', () => process.env['npm_package_version'] ?? '0.0.0');
  handle('entries:validateDql', ({ dql }) => {
    const result = parse(dql);
    return result.ok
      ? { ok: true }
      : { ok: false, error: { message: result.error.message, start: result.error.start, end: result.error.end } };
  });
}
