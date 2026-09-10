import type { IpcContracts, IpcResult, PushEvents } from './contracts';

/** Shape of `window.api` exposed by the preload script (and implemented by the renderer test mock). */
export interface PreloadApi {
  invoke<K extends keyof IpcContracts>(
    channel: K,
    req: IpcContracts[K]['req'],
  ): Promise<IpcResult<IpcContracts[K]['res']>>;
  on<E extends keyof PushEvents>(event: E, cb: (payload: PushEvents[E]) => void): () => void;
}
