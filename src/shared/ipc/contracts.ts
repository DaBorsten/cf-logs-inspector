/**
 * Single source of truth for the renderer <-> main IPC boundary.
 * Channels are added per milestone; keep request/response shapes JSON-serialisable
 * (BigInt timestamps travel as decimal strings).
 */

export interface IpcError {
  code: string;
  message: string;
  details?: unknown;
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError };

export interface DqlValidation {
  ok: boolean;
  error?: { message: string; start: number; end: number };
}

export interface IpcContracts {
  'app:version': { req: void; res: string };
  'entries:validateDql': { req: { dql: string }; res: DqlValidation };
}

export const INVOKE_CHANNELS = ['app:version', 'entries:validateDql'] as const satisfies readonly (keyof IpcContracts)[];

export interface PushEvents {
  'workspace:changed': { id: string };
}

export const PUSH_EVENTS = ['workspace:changed'] as const satisfies readonly (keyof PushEvents)[];
