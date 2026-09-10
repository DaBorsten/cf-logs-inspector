import { BrowserWindow } from 'electron';
import type { PasscodeStartResult } from '@shared/model/connection';
import { openPasscodeWindow } from '../cf/passcode-window';
import type { AppContext } from '../context';
import { handle } from './handle';
import { connectionIdSchema, loginPasswordSchema, passcodeLoginSchema } from './schemas';

export function registerAuthHandlers(ctx: AppContext): void {
  handle('auth:status', connectionIdSchema, ({ connectionId }) =>
    ctx.connections.authStatus(connectionId),
  );

  handle(
    'auth:loginPassword',
    loginPasswordSchema,
    async ({ connectionId, username, password, origin }) => {
      const rt = await ctx.connections.runtime(connectionId);
      // Profile origin wins unless the dialog overrides it; password-mode profiles never send a login_hint.
      const effectiveOrigin =
        rt.profile.authMode === 'origin' ? (origin ?? rt.profile.origin) : origin || undefined;
      return rt.tokens.loginPassword(username, password, effectiveOrigin);
    },
  );

  handle(
    'auth:startPasscode',
    connectionIdSchema,
    async ({ connectionId }, { sender }): Promise<PasscodeStartResult> => {
      const rt = await ctx.connections.runtime(connectionId);
      const parent = BrowserWindow.fromWebContents(sender) ?? undefined;
      const result = await openPasscodeWindow({
        connectionId,
        loginUrl: rt.endpoints.login,
        skipSslValidation: rt.profile.skipSslValidation,
        logger: ctx.logger,
        ...(parent ? { parent } : {}),
      });
      if (result.kind === 'cancelled') return { kind: 'cancelled' };
      return { kind: 'loggedIn', status: await rt.tokens.loginPasscode(result.code) };
    },
  );

  handle('auth:passcodeLogin', passcodeLoginSchema, async ({ connectionId, passcode }) => {
    const rt = await ctx.connections.runtime(connectionId);
    return rt.tokens.loginPasscode(passcode);
  });

  handle('auth:logout', connectionIdSchema, async ({ connectionId }) => {
    const rt = await ctx.connections.runtime(connectionId);
    rt.tokens.logout();
  });
}
