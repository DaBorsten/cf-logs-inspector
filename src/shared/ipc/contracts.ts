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
import type {
  EntryCount,
  EntryCountQuery,
  EntryDetail,
  EntryPage,
  EntryQuery,
  PropInfo,
  ValuesQuery,
} from '../model/query';
import type { SavedFilter, SavedFilterInput } from '../model/filters';
import type {
  ExportDoneEvent,
  ExportFailedEvent,
  ExportProgressEvent,
  ExportRequest,
  ExportStarted,
} from '../model/export';
import type { SessionRange } from '../model/session';
import type { AppInfo, UpdateStatus } from '../model/update';

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

  // ---- app updates (M14) ----
  'app:info': { req: void; res: AppInfo };
  /** Current cached update status; does not start a check. */
  'update:status': { req: void; res: UpdateStatus };
  /** Starts (or no-ops onto) a check against the GitHub releases feed. */
  'update:check': { req: void; res: UpdateStatus };
  /** Starts (or no-ops onto) downloading the update found by the last check. */
  'update:download': { req: void; res: UpdateStatus };
  /** Quits and installs a downloaded update. */
  'update:install': { req: void; res: void };

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
  /** Native "open file" dialog for .sqlite files; null when cancelled. */
  'workspace:pickFile': { req: void; res: string | null };
  /** Reveals the workspace file in the OS file manager. */
  'workspace:reveal': { req: { id: string }; res: void };

  // ---- log sessions / streams (M4) ----
  'session:list': { req: void; res: LogSession[] };
  'session:create': { req: SessionCreateInput; res: LogSession };
  'session:start': { req: SessionStartInput; res: LogSession };
  'session:stop': { req: { sessionId: number }; res: LogSession };
  'session:setInterval': { req: { sessionId: number; pollIntervalMs: number }; res: LogSession };
  /** Deletes the session's entries (stops it first); the session stays. */
  'session:clear': { req: { sessionId: number }; res: LogSession };
  'session:delete': { req: { sessionId: number }; res: void };
  /** Oldest/newest stored timestamps of a session (null when empty). */
  'session:range': { req: { sessionId: number }; res: SessionRange | null };

  // ---- query engine (M5) ----
  /** One page of entries; DQL is parsed/compiled in main, relative time filters resolved at call time. */
  'entries:query': { req: EntryQuery; res: EntryPage };
  /** Matching total (within the snapshot) and the highest matching id (ignoring the snapshot). */
  'entries:count': { req: EntryCountQuery; res: EntryCount };
  'entries:get': { req: { id: number }; res: EntryDetail };
  /** Distinct values of a field for autocomplete (frequency order). */
  'entries:values': { req: ValuesQuery; res: string[] };
  /** Discovered top-level JSON keys with type/count/sample. */
  'props:list': { req: { sessionIds?: number[] }; res: PropInfo[] };

  // ---- saved filters (M9) ----
  'filters:list': { req: void; res: SavedFilter[] };
  /** Create (no id) or update; an existing name is overwritten. */
  'filters:save': { req: SavedFilterInput; res: SavedFilter };
  'filters:delete': { req: { id: number }; res: void };

  // ---- export (M12) ----
  /** Shows the save dialog, then streams the export in the background (progress via push events). */
  'export:run': { req: ExportRequest; res: ExportStarted };
  'export:cancel': { req: { jobId: string }; res: void };
  'export:reveal': { req: { path: string }; res: void };
}

export const INVOKE_CHANNELS = [
  'app:version',
  'entries:validateDql',
  'app:info',
  'update:status',
  'update:check',
  'update:download',
  'update:install',
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
  'workspace:pickFile',
  'workspace:reveal',
  'session:list',
  'session:create',
  'session:start',
  'session:stop',
  'session:setInterval',
  'session:clear',
  'session:delete',
  'entries:query',
  'entries:count',
  'entries:get',
  'entries:values',
  'props:list',
  'filters:list',
  'filters:save',
  'filters:delete',
  'session:range',
  'export:run',
  'export:cancel',
  'export:reveal',
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
  'export:progress': ExportProgressEvent;
  'export:done': ExportDoneEvent;
  'export:failed': ExportFailedEvent;
  /** The update check/download state machine advanced. */
  'update:status': UpdateStatus;
}

export const PUSH_EVENTS = [
  'workspace:changed',
  'auth:required',
  'auth:changed',
  'stream:batch',
  'stream:status',
  'export:progress',
  'export:done',
  'export:failed',
  'update:status',
] as const satisfies readonly (keyof PushEvents)[];
