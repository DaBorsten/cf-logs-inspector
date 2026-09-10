/**
 * Single source of truth for the renderer <-> main IPC boundary.
 * Channels are added per milestone; keep request/response shapes JSON-serialisable
 * (BigInt timestamps travel as decimal strings).
 */
import type {
  AuthRequiredReason,
  AuthStatus,
  ConnectionInput,
  ConnectionProfile,
  PasscodeStartResult,
} from '../model/connection';
import type { CfApp, CfEndpoints, CfOrg, CfSpace } from '../model/cf';

export interface IpcError {
  code: string;
  message: string;
  details?: unknown;
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError };

export interface DqlValidation {
  ok: boolean;
  error?: { message: string; start: number; end: number };
}

export interface IpcContracts {
  'app:version': { req: void; res: string };
  'entries:validateDql': { req: { dql: string }; res: DqlValidation };

  // ---- connections (M2) ----
  'connection:list': { req: void; res: ConnectionProfile[] };
  /** Create (no id) or update (with id) a profile. The API URL is normalised in main. */
  'connection:save': { req: ConnectionInput & { id?: string }; res: ConnectionProfile };
  'connection:delete': { req: { id: string }; res: void };
  /** Runs endpoint discovery for a (possibly unsaved) profile; proves reachability and TLS settings. */
  'connection:test': {
    req: Pick<ConnectionInput, 'apiUrl' | 'skipSslValidation' | 'caCertPem'>;
    res: CfEndpoints;
  };

  // ---- auth (M2) ----
  'auth:status': { req: { connectionId: string }; res: AuthStatus };
  'auth:loginPassword': {
    req: { connectionId: string; username: string; password: string; origin?: string };
    res: AuthStatus;
  };
  /** Opens the embedded SSO window; resolves when a code was scraped and used, or the window was closed. */
  'auth:startPasscode': { req: { connectionId: string }; res: PasscodeStartResult };
  /** Manual fallback: the user pasted the code shown at `{login}/passcode`. */
  'auth:passcodeLogin': { req: { connectionId: string; passcode: string }; res: AuthStatus };
  'auth:logout': { req: { connectionId: string }; res: void };

  // ---- cloud controller (M2) ----
  'cf:orgs': { req: { connectionId: string }; res: CfOrg[] };
  'cf:spaces': { req: { connectionId: string; orgGuid: string }; res: CfSpace[] };
  'cf:apps': { req: { connectionId: string; spaceGuid: string }; res: CfApp[] };
}

export const INVOKE_CHANNELS = [
  'app:version',
  'entries:validateDql',
  'connection:list',
  'connection:save',
  'connection:delete',
  'connection:test',
  'auth:status',
  'auth:loginPassword',
  'auth:startPasscode',
  'auth:passcodeLogin',
  'auth:logout',
  'cf:orgs',
  'cf:spaces',
  'cf:apps',
] as const satisfies readonly (keyof IpcContracts)[];

export interface PushEvents {
  'workspace:changed': { id: string };
  /** Token refresh failed or no token exists; the renderer should prompt for login. */
  'auth:required': { connectionId: string; reason: AuthRequiredReason };
  /** Login, refresh or logout changed the auth state of a connection. */
  'auth:changed': { connectionId: string; status: AuthStatus };
}

export const PUSH_EVENTS = [
  'workspace:changed',
  'auth:required',
  'auth:changed',
] as const satisfies readonly (keyof PushEvents)[];
