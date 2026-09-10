import type { PreloadApi } from '../shared/ipc/bridge';

declare global {
  interface Window {
    api: PreloadApi;
  }
}
export {};
