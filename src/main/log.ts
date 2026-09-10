/**
 * Minimal logger abstraction so that `src/main/cf` and `src/main/store` stay testable under vitest
 * (electron-log needs the Electron runtime). `src/main/index.ts` passes an electron-log scope.
 */
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const SENSITIVE_KEYS =
  /^(authorization|password|passcode|refresh_token|access_token|cookie|set-cookie)$/i;

/** Returns a shallow copy with credential-bearing keys replaced by `[redacted]`. */
export function redact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = SENSITIVE_KEYS.test(k) ? '[redacted]' : v;
  return out;
}
