import type { UpdateStatus } from '@shared/model/update';
import type { Logger } from '../log';

/** Minimal slice of `electron-updater`'s `autoUpdater` this module depends on. */
export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
  on(event: 'checking-for-update', listener: () => void): void;
  on(event: 'update-available', listener: (info: { version: string }) => void): void;
  on(event: 'update-not-available', listener: (info: { version: string }) => void): void;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): void;
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
}

export interface UpdateManagerOptions {
  autoUpdater: AutoUpdaterLike;
  logger: Logger;
  /** False in dev / unpackaged builds, where the update feed cannot be reached meaningfully. */
  supported: boolean;
  onStatus: (status: UpdateStatus) => void;
}

/**
 * Thin wrapper around `electron-updater`'s singleton `autoUpdater`, turning its event emitter into a
 * single `UpdateStatus` this app pushes to the renderer. One instance per process (main creates it once).
 */
export class UpdateManager {
  private readonly autoUpdater: AutoUpdaterLike;
  private readonly logger: Logger;
  private readonly supported: boolean;
  private readonly onStatus: (status: UpdateStatus) => void;
  private status: UpdateStatus;

  constructor(opts: UpdateManagerOptions) {
    this.autoUpdater = opts.autoUpdater;
    this.logger = opts.logger;
    this.supported = opts.supported;
    this.onStatus = opts.onStatus;
    this.status = { state: 'idle', supported: opts.supported };

    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = false;

    this.autoUpdater.on('checking-for-update', () => this.setStatus({ state: 'checking' }));
    this.autoUpdater.on('update-available', (info) =>
      this.setStatus({ state: 'available', version: info.version }),
    );
    this.autoUpdater.on('update-not-available', (info) =>
      this.setStatus({ state: 'not-available', version: info.version }),
    );
    this.autoUpdater.on('download-progress', (progress) =>
      this.setStatus({ state: 'downloading', percent: Math.round(progress.percent) }),
    );
    this.autoUpdater.on('update-downloaded', (info) =>
      this.setStatus({ state: 'downloaded', version: info.version }),
    );
    this.autoUpdater.on('error', (err) => {
      this.logger.error(`auto-updater error: ${String(err)}`);
      this.setStatus({ state: 'error', message: err.message });
    });
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  async check(): Promise<UpdateStatus> {
    if (!this.supported) return this.status;
    if (this.status.state === 'checking' || this.status.state === 'downloading') {
      return this.status;
    }
    try {
      await this.autoUpdater.checkForUpdates();
    } catch (err) {
      this.setStatus({ state: 'error', message: (err as Error).message });
    }
    return this.status;
  }

  async download(): Promise<UpdateStatus> {
    if (!this.supported) return this.status;
    if (this.status.state === 'downloading' || this.status.state === 'downloaded') {
      return this.status;
    }
    try {
      await this.autoUpdater.downloadUpdate();
    } catch (err) {
      this.setStatus({ state: 'error', message: (err as Error).message });
    }
    return this.status;
  }

  install(): void {
    if (this.status.state !== 'downloaded') return;
    this.autoUpdater.quitAndInstall();
  }

  private setStatus(patch: Omit<UpdateStatus, 'supported'>): void {
    this.status = { ...patch, supported: this.supported };
    this.onStatus(this.status);
  }
}
