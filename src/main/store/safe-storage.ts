import { safeStorage } from 'electron';
import type { Encryptor } from './connections';
import { noopLogger, type Logger } from '../log';

/**
 * `Encryptor` backed by Electron `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret/kwallet
 * on Linux). Must only be called after `app.whenReady()`.
 */
export function safeStorageEncryptor(logger: Logger = noopLogger): Encryptor {
  let warned = false;
  return {
    isAvailable: () => {
      const ok = safeStorage.isEncryptionAvailable();
      if (ok && !warned && process.platform === 'linux') {
        const backend = safeStorage.getSelectedStorageBackend();
        if (backend === 'basic_text') {
          logger.warn(
            'safeStorage uses the basic_text backend; tokens are only obfuscated, not encrypted',
          );
        }
        warned = true;
      }
      return ok;
    },
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (cipher) => safeStorage.decryptString(Buffer.from(cipher, 'base64')),
  };
}
