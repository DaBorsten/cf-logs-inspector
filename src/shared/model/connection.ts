/** Connection profiles describe how to reach one Cloud Foundry foundation. Passwords are never stored. */

export type AuthMode = 'password' | 'origin' | 'passcode';

export interface ConnectionInput {
  name: string;
  /** Normalised `https://api.<host>` without trailing slash. */
  apiUrl: string;
  /** BTP region key when the profile was created from the region picker; informational only. */
  region?: string;
  authMode: AuthMode;
  /** UAA identity provider origin key, required for `authMode === 'origin'`. */
  origin?: string;
  /** Remembered user name for password/origin logins (prefills the login dialog). */
  username?: string;
  skipSslValidation: boolean;
  /** Extra trusted CA certificate(s), PEM encoded. Appended to the system roots. */
  caCertPem?: string;
}

export interface ConnectionProfile extends ConnectionInput {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface AuthStatus {
  /** A usable access token exists or one can be obtained with the stored refresh token. */
  loggedIn: boolean;
  /** User name from the access token (`user_name` claim) when logged in. */
  username?: string;
  /** Access token expiry, epoch milliseconds. */
  expiresAt?: number;
  /** A refresh token is stored, so the session survives access-token expiry and app restarts. */
  canRefresh: boolean;
}

export type AuthRequiredReason = 'no-token' | 'refresh-failed' | 'unauthorized';

/** Result of `auth:startPasscode`: the embedded browser either yielded a code that was used to log in, or was closed. */
export type PasscodeStartResult = { kind: 'loggedIn'; status: AuthStatus } | { kind: 'cancelled' };
