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
import type {
  LogSession,
  SessionCreateInput,
  SessionStartInput,
  StreamBatchEvent,
  StreamStatusEvent,
} from '../model/session';
import type { WorkspaceInfo, WorkspaceStats } from '../model/workspace';

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

  // ---- workspaces (M4) ----
  'workspace:list': { req: void; res: WorkspaceInfo[] };
  /** Creates the file and switches to it. */
  'workspace:create': { req: { name: string }; res: WorkspaceInfo };
  /** Switches to a registered workspace (stops all streams first). */
  'workspace:open': { req: { id: string }; res: WorkspaceInfo };
  /** Registers an existing .sqlite file and switches to it. */
  'workspace:openFile': { req: { path: string }; res: WorkspaceInfo };
  'workspace:delete': { req: { id: string }; res: void };
  'workspace:current': { req: void; res: WorkspaceInfo | null };
  'workspace:stats': { req: void; res: WorkspaceStats };
  'workspace:kvGet': { req: { key: string }; res: string | null };
  'workspace:kvSet': { req: { key: string; value: string | null }; res: void };

  // ---- log sessions / streams (M4) ----
  'session:list': { req: void; res: LogSession[] };
  'session:create': { req: SessionCreateInput; res: LogSession };
  'session:start': { req: SessionStartInput; res: LogSession };
  'session:stop': { req: { sessionId: number }; res: LogSession };
  'session:setInterval': { req: { sessionId: number; pollIntervalMs: number }; res: LogSession };
  /** Deletes the session's entries (stops it first); the session stays. */
  'session:clear': { req: { sessionId: number }; res: LogSession };
  'session:delete': { req: { sessionId: number }; res: void };
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
  'workspace:list',
  'workspace:create',
  'workspace:open',
  'workspace:openFile',
  'workspace:delete',
  'workspace:current',
  'workspace:stats',
  'workspace:kvGet',
  'workspace:kvSet',
  'session:list',
  'session:create',
  'session:start',
  'session:stop',
  'session:setInterval',
  'session:clear',
  'session:delete',
] as const satisfies readonly (keyof IpcContracts)[];

export interface PushEvents {
  /** The open workspace changed (`id: null` while none is open). */
  'workspace:changed': { id: string | null };
  /** Token refresh failed or no token exists; the renderer should prompt for login. */
  'auth:required': { connectionId: string; reason: AuthRequiredReason };
  /** Login, refresh or logout changed the auth state of a connection. */
  'auth:changed': { connectionId: string; status: AuthStatus };
  /** A writer flush committed rows for a session (counts only; re-query to see them). */
  'stream:batch': StreamBatchEvent;
  /** A session's poller changed state. */
  'stream:status': StreamStatusEvent;
}

export const PUSH_EVENTS = [
  'workspace:changed',
  'auth:required',
  'auth:changed',
  'stream:batch',
  'stream:status',
] as const satisfies readonly (keyof PushEvents)[];
