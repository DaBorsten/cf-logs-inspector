import { BrowserWindow } from 'electron';
import { noopLogger, type Logger } from '../log';

export interface PasscodeWindowOptions {
  connectionId: string;
  /** `links.login.href`; the window loads `{login}/passcode`. */
  loginUrl: string;
  skipSslValidation?: boolean;
  parent?: BrowserWindow;
  pollIntervalMs?: number;
  logger?: Logger;
}

export type PasscodeWindowResult = { kind: 'code'; code: string } | { kind: 'cancelled' };

const HEADER_RE = /temporary authentication code/i;
const CODE_RE = /^[A-Za-z0-9_-]{6,64}$/;

/**
 * Best-effort extraction of the one-time code from the UAA passcode page text. The page shows a
 * "Temporary Authentication Code" heading followed by the code on its own line; we only accept a
 * code after that heading so IdP login pages never produce false positives.
 */
export function extractPasscode(text: string): string | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const start = lines.findIndex((l) => HEADER_RE.test(l));
  if (start < 0) return undefined;
  for (let i = start + 1; i < Math.min(lines.length, start + 12); i++) {
    const line = lines[i]!;
    if (!line) continue;
    if (CODE_RE.test(line)) return line;
    // "Your code is: ABC123" style
    const m = /(?:code|passcode)\s*(?:is)?\s*:\s*([A-Za-z0-9_-]{6,64})\s*$/i.exec(line);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

const open = new Map<string, Promise<PasscodeWindowResult>>();

/**
 * Opens a sandboxed, isolated-partition browser window on the UAA passcode page so the user can
 * authenticate with their IdP (cookies persist per connection). Resolves with the scraped code, or
 * `cancelled` when the user closes the window. A second call for the same connection focuses the
 * existing window and shares its result.
 */
export function openPasscodeWindow(opts: PasscodeWindowOptions): Promise<PasscodeWindowResult> {
  const existing = open.get(opts.connectionId);
  if (existing) return existing;
  const p = run(opts).finally(() => open.delete(opts.connectionId));
  open.set(opts.connectionId, p);
  return p;
}

function run(opts: PasscodeWindowOptions): Promise<PasscodeWindowResult> {
  const logger = opts.logger ?? noopLogger;
  const passcodeUrl = `${opts.loginUrl.replace(/\/+$/, '')}/passcode`;
  const allowedProtocols = new Set(['https:']);
  if (new URL(passcodeUrl).protocol === 'http:') allowedProtocols.add('http:'); // local mock servers only

  return new Promise<PasscodeWindowResult>((resolve) => {
    let settled = false;
    const win = new BrowserWindow({
      width: 560,
      height: 760,
      title: 'Cloud Foundry SSO login',
      autoHideMenuBar: true,
      show: false,
      ...(opts.parent ? { parent: opts.parent, modal: true } : {}),
      webPreferences: {
        partition: `persist:uaa-${opts.connectionId}`,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    const wc = win.webContents;

    const finish = (result: PasscodeWindowResult): void => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      resolve(result);
      if (!win.isDestroyed()) win.close();
    };

    const isAllowed = (url: string): boolean => {
      try {
        return allowedProtocols.has(new URL(url).protocol);
      } catch {
        return false;
      }
    };
    wc.on('will-navigate', (event, url) => {
      if (!isAllowed(url)) {
        logger.warn(`passcode window blocked navigation to ${url}`);
        event.preventDefault();
      }
    });
    wc.setWindowOpenHandler(({ url }) => {
      // IdPs sometimes open pop-ups; keep them in this window instead of spawning new ones.
      if (isAllowed(url)) void wc.loadURL(url);
      return { action: 'deny' };
    });
    wc.on('certificate-error', (event, _url, _error, _cert, callback) => {
      if (opts.skipSslValidation) {
        event.preventDefault();
        callback(true);
      } else {
        callback(false);
      }
    });

    const timer = setInterval(() => {
      if (settled || win.isDestroyed() || wc.isLoading()) return;
      void wc
        .executeJavaScript('document.body ? document.body.innerText : ""', true)
        .then((text: unknown) => {
          const code = typeof text === 'string' ? extractPasscode(text) : undefined;
          if (code) {
            logger.info('passcode scraped from UAA page');
            finish({ kind: 'code', code });
          }
        })
        .catch(() => {
          /* page is navigating; try again on the next tick */
        });
    }, opts.pollIntervalMs ?? 500);

    win.once('ready-to-show', () => win.show());
    win.on('closed', () => finish({ kind: 'cancelled' }));
    void win.loadURL(passcodeUrl).catch((err: unknown) => {
      logger.warn(`passcode window failed to load ${passcodeUrl}: ${String(err)}`);
    });
  });
}
