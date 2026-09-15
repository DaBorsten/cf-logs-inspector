import { describe, expect, it, vi } from 'vitest';
import { noopLogger } from '../../log';
import { UpdateManager, type AutoUpdaterLike } from '../update-manager';

function fakeAutoUpdater(): AutoUpdaterLike & {
  emit(event: string, payload?: unknown): void;
  checkForUpdates: ReturnType<typeof vi.fn>;
  downloadUpdate: ReturnType<typeof vi.fn>;
  quitAndInstall: ReturnType<typeof vi.fn>;
} {
  const listeners = new Map<string, ((payload?: unknown) => void)[]>();
  return {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn(),
    on(event: string, listener: (payload?: unknown) => void) {
      const arr = listeners.get(event) ?? [];
      arr.push(listener);
      listeners.set(event, arr);
    },
    emit(event: string, payload?: unknown) {
      for (const l of listeners.get(event) ?? []) l(payload);
    },
  } as unknown as AutoUpdaterLike & {
    emit(event: string, payload?: unknown): void;
    checkForUpdates: ReturnType<typeof vi.fn>;
    downloadUpdate: ReturnType<typeof vi.fn>;
    quitAndInstall: ReturnType<typeof vi.fn>;
  };
}

describe('UpdateManager', () => {
  it('disables autoDownload/autoInstallOnAppQuit so the renderer drives the flow', () => {
    const autoUpdater = fakeAutoUpdater();
    new UpdateManager({ autoUpdater, logger: noopLogger, supported: true, onStatus: () => {} });
    expect(autoUpdater.autoDownload).toBe(false);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it('reports unsupported status without calling the updater when not packaged', async () => {
    const autoUpdater = fakeAutoUpdater();
    const onStatus = vi.fn();
    const mgr = new UpdateManager({ autoUpdater, logger: noopLogger, supported: false, onStatus });
    const status = await mgr.check();
    expect(status).toEqual({ state: 'idle', supported: false });
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('walks through checking -> available -> downloading -> downloaded', async () => {
    const autoUpdater = fakeAutoUpdater();
    const statuses: unknown[] = [];
    const mgr = new UpdateManager({
      autoUpdater,
      logger: noopLogger,
      supported: true,
      onStatus: (s) => statuses.push(s),
    });

    autoUpdater.checkForUpdates.mockImplementation(async () => {
      autoUpdater.emit('checking-for-update');
      autoUpdater.emit('update-available', { version: '1.2.3' });
    });
    await mgr.check();
    expect(mgr.getStatus()).toEqual({ state: 'available', version: '1.2.3', supported: true });

    autoUpdater.downloadUpdate.mockImplementation(async () => {
      autoUpdater.emit('download-progress', { percent: 42.6 });
      autoUpdater.emit('update-downloaded', { version: '1.2.3' });
    });
    await mgr.download();
    expect(mgr.getStatus()).toEqual({ state: 'downloaded', version: '1.2.3', supported: true });

    mgr.install();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledOnce();

    expect(statuses.map((s) => (s as { state: string }).state)).toEqual([
      'checking',
      'available',
      'downloading',
      'downloaded',
    ]);
  });

  it('does not install when no update was downloaded', () => {
    const autoUpdater = fakeAutoUpdater();
    const mgr = new UpdateManager({
      autoUpdater,
      logger: noopLogger,
      supported: true,
      onStatus: () => {},
    });
    mgr.install();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('turns a checkForUpdates rejection into an error status', async () => {
    const autoUpdater = fakeAutoUpdater();
    autoUpdater.checkForUpdates.mockRejectedValue(new Error('offline'));
    const mgr = new UpdateManager({
      autoUpdater,
      logger: noopLogger,
      supported: true,
      onStatus: () => {},
    });
    const status = await mgr.check();
    expect(status).toEqual({ state: 'error', message: 'offline', supported: true });
  });
});
