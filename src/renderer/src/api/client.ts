import type { IpcContracts, IpcError, PushEvents } from '@shared/ipc/contracts';

/** Error thrown by `invoke` when main returned `{ok:false}`; `code` is a stable CfError/IPC code. */
export class ApiError extends Error {
  readonly code: string;
  readonly details: unknown;
  constructor(err: IpcError) {
    super(err.message);
    this.name = 'ApiError';
    this.code = err.code;
    this.details = err.details;
  }
}

export function isApiError(err: unknown, code?: string): err is ApiError {
  return err instanceof ApiError && (code === undefined || err.code === code);
}

/** Message for toasts/inline errors. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function bridge(): Window['api'] {
  if (typeof window === 'undefined' || !window.api) {
    throw new Error('window.api is not available (preload missing?)');
  }
  return window.api;
}

/** Typed IPC call that unwraps `IpcResult` and throws `ApiError` on failure. */
export async function invoke<K extends keyof IpcContracts>(
  channel: K,
  req: IpcContracts[K]['req'],
): Promise<IpcContracts[K]['res']> {
  const result = await bridge().invoke(channel, req);
  if (!result.ok) throw new ApiError(result.error);
  return result.value;
}

/** Subscribes to a push event; returns the unsubscribe function. */
export function onEvent<E extends keyof PushEvents>(
  event: E,
  cb: (payload: PushEvents[E]) => void,
): () => void {
  return bridge().on(event, cb);
}
