import { app } from 'electron';
import type { AppContext } from '../context';
import { handle } from './handle';

export function registerUpdateHandlers(ctx: AppContext): void {
  handle('app:info', undefined, () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
  }));
  handle('update:status', undefined, () => ctx.updates.getStatus());
  handle('update:check', undefined, () => ctx.updates.check());
  handle('update:download', undefined, () => ctx.updates.download());
  handle('update:install', undefined, () => ctx.updates.install());
}
