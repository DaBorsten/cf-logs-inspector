import { ipcMain, type WebContents } from 'electron';
import { ZodError, type ZodType } from 'zod';
import type { IpcContracts, IpcError, IpcResult } from '@shared/ipc/contracts';
import { isCfError } from '../cf/errors';

export interface HandlerContext {
  sender: WebContents;
}

export type Handler<K extends keyof IpcContracts> = (
  req: IpcContracts[K]['req'],
  ctx: HandlerContext,
) => Promise<IpcContracts[K]['res']> | IpcContracts[K]['res'];

/**
 * Registers an invoke handler that validates the request with `schema` (when given), and converts
 * every outcome into an `IpcResult` so the renderer never sees a rejected promise.
 */
export function handle<K extends keyof IpcContracts>(
  channel: K,
  schema: ZodType | undefined,
  handler: Handler<K>,
): void {
  ipcMain.handle(
    channel,
    async (event, raw: unknown): Promise<IpcResult<IpcContracts[K]['res']>> => {
      try {
        const req = (schema ? schema.parse(raw) : raw) as IpcContracts[K]['req'];
        return { ok: true, value: await handler(req, { sender: event.sender }) };
      } catch (err) {
        return { ok: false, error: toIpcError(err) };
      }
    },
  );
}

export function toIpcError(err: unknown): IpcError {
  if (err instanceof ZodError) {
    return {
      code: 'INVALID_INPUT',
      message: err.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; '),
      details: err.issues,
    };
  }
  if (isCfError(err)) {
    const details: Record<string, unknown> = {};
    if (err.status !== undefined) details['status'] = err.status;
    if (err.details !== undefined) details['details'] = err.details;
    if (err.retryAfterMs !== undefined) details['retryAfterMs'] = err.retryAfterMs;
    return { code: err.code, message: err.message, details };
  }
  const e = err as { code?: unknown; message?: unknown; details?: unknown };
  return {
    code: typeof e?.code === 'string' ? e.code : 'INTERNAL',
    message: typeof e?.message === 'string' ? e.message : String(err),
    details: e?.details,
  };
}
