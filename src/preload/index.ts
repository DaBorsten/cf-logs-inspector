import { contextBridge, ipcRenderer } from 'electron';
import type { PreloadApi } from '@shared/ipc/bridge';
import {
  INVOKE_CHANNELS,
  PUSH_EVENTS,
  type IpcContracts,
  type IpcResult,
  type PushEvents,
} from '@shared/ipc/contracts';

const invokeSet = new Set<string>(INVOKE_CHANNELS);
const eventSet = new Set<string>(PUSH_EVENTS);

const api: PreloadApi = {
  invoke<K extends keyof IpcContracts>(
    channel: K,
    req: IpcContracts[K]['req'],
  ): Promise<IpcResult<IpcContracts[K]['res']>> {
    if (!invokeSet.has(channel))
      return Promise.reject(new Error(`Unknown IPC channel: ${channel}`));
    return ipcRenderer.invoke(channel, req) as Promise<IpcResult<IpcContracts[K]['res']>>;
  },
  on<E extends keyof PushEvents>(event: E, cb: (payload: PushEvents[E]) => void): () => void {
    if (!eventSet.has(event)) throw new Error(`Unknown IPC event: ${event}`);
    const listener = (_e: unknown, payload: PushEvents[E]): void => cb(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
};

export type { PreloadApi };
contextBridge.exposeInMainWorld('api', api);
