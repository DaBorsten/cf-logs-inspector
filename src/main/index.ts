import { app, BrowserWindow, session, shell } from 'electron';
import { join } from 'node:path';
import log from 'electron-log/main';
import { ConnectionManager } from './cf/connection-manager';
import type { AppContext } from './context';
import { WorkspaceManager } from './db/workspace-manager';
import { StreamManager } from './ingest/stream-manager';
import { registerIpcHandlers } from './ipc/register';
import { pushEvent } from './ipc/push';
import { ConnectionStore } from './store/connections';
import { safeStorageEncryptor } from './store/safe-storage';

log.initialize();
log.transports.file.level = 'info';

const isDev = !app.isPackaged;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.on('ready-to-show', () => win.show());

  // Never navigate the main window away from the bundled renderer.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}

function installCsp(): void {
  // Renderer never talks to Cloud Foundry directly; all network I/O lives in main.
  const csp = isDev
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws:; img-src 'self' data:"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
    });
  });
}

async function createContext(): Promise<AppContext> {
  const logger = log.scope('main');
  const userData = app.getPath('userData');

  const store = new ConnectionStore({
    filePath: join(userData, 'connections.json'),
    encryptor: safeStorageEncryptor(logger),
    logger,
  });
  const workspaces = new WorkspaceManager({
    dir: join(userData, 'workspaces'),
    registryPath: join(userData, 'workspaces.json'),
    logger,
    onChange: (ws) => pushEvent('workspace:changed', { id: ws?.id ?? null }),
  });
  const connections = new ConnectionManager({
    store,
    logger,
    onAuthRequired: (connectionId, reason) => pushEvent('auth:required', { connectionId, reason }),
    onAuthChanged: (connectionId, status) => {
      pushEvent('auth:changed', { connectionId, status });
      streams.handleAuthChanged(connectionId, status); // fires asynchronously, after `streams` exists
    },
  });
  const streams = new StreamManager({
    workspaces,
    connections,
    logger,
    onBatch: (ev) => pushEvent('stream:batch', ev),
    onStatus: (ev) => pushEvent('stream:status', ev),
  });
  try {
    await workspaces.openLastOrDefault();
  } catch (err) {
    logger.error(`could not open a workspace at startup: ${String(err)}`);
  }
  return { connections, workspaces, streams, logger };
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let ctx: AppContext | undefined;
  app.whenReady().then(async () => {
    installCsp();
    ctx = await createContext();
    registerIpcHandlers(ctx);
    createMainWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  let shuttingDown = false;
  app.on('before-quit', (event) => {
    if (!ctx || shuttingDown) return;
    shuttingDown = true;
    event.preventDefault();
    const c = ctx;
    void (async () => {
      try {
        await c.streams.stopAll();
        await c.workspaces.close();
        await c.connections.disposeAll();
      } catch (err) {
        c.logger.error(`shutdown error: ${String(err)}`);
      } finally {
        app.quit();
      }
    })();
  });
}
