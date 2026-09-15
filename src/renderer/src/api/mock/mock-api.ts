/**
 * In-memory implementation of the IPC contract for renderer tests and browser-only development.
 * State is plain data that tests can seed and inspect; `emit()` fakes push events from main.
 */
import { compileMatcher, parse } from '@shared/dql';
import type { IpcContracts, IpcResult, PushEvents } from '@shared/ipc/contracts';
import type { CfApp, CfOrg, CfSpace } from '@shared/model/cf';
import type { AuthStatus, ConnectionProfile, PasscodeStartResult } from '@shared/model/connection';
import { entryFieldKind, TEXT_FIELDS } from '@shared/model/fields';
import type { EntryDetail, EntryRow, PropInfo } from '@shared/model/query';
import type { LogSession } from '@shared/model/session';
import type { SavedFilter } from '@shared/model/filters';
import type { ExportRequest } from '@shared/model/export';
import type { WorkspaceInfo } from '@shared/model/workspace';
import type { UpdateStatus } from '@shared/model/update';
import type { PreloadApi } from '@shared/ipc/bridge';

export interface MockState {
  workspaces: WorkspaceInfo[];
  currentWorkspaceId: string | null;
  connections: ConnectionProfile[];
  auth: Record<string, AuthStatus>;
  /** Credentials accepted by loginPassword: `${username}:${password}`. */
  validCredentials: Set<string>;
  validPasscodes: Set<string>;
  passcodeWindowResult: PasscodeStartResult | 'use-valid-passcode';
  orgs: CfOrg[];
  spaces: CfSpace[];
  apps: CfApp[];
  sessions: LogSession[];
  entries: EntryDetail[];
  props: PropInfo[];
  filters: SavedFilter[];
  /** Recorded export requests; `exportSavePath` null simulates a cancelled save dialog. */
  exports: ExportRequest[];
  exportSavePath: string | null;
  cancelledExports: Set<string>;
  kv: Record<string, string>;
  /** Channels that should fail with this error (consumed once per call). */
  failures: Partial<Record<keyof IpcContracts, { code: string; message: string }>>;
  /** Every invoke, for assertions. */
  calls: { channel: string; req: unknown }[];
  version: string;
  pickFileResult: string | null;
  packaged: boolean;
  updateStatus: UpdateStatus;
  /** Version `update:check` finds when simulating an available update. */
  availableVersion: string | null;
}

export interface MockApi {
  api: PreloadApi;
  state: MockState;
  emit<E extends keyof PushEvents>(event: E, payload: PushEvents[E]): void;
}

let seq = 100;
const nextId = (): string => `mock-${++seq}`;

export function defaultMockState(): MockState {
  const now = Date.now();
  return {
    workspaces: [
      {
        id: 'ws-1',
        name: 'default',
        path: 'C:\\Users\\me\\AppData\\Roaming\\cf-log-inspector\\workspaces\\default-ws1.sqlite',
        createdAt: now - 86_400_000,
        lastOpenedAt: now,
        sizeBytes: 12_345,
        exists: true,
      },
    ],
    currentWorkspaceId: 'ws-1',
    connections: [],
    auth: {},
    validCredentials: new Set(['alice:secret']),
    validPasscodes: new Set(['PC123456']),
    passcodeWindowResult: 'use-valid-passcode',
    orgs: [
      { guid: 'org-1', name: 'acme' },
      { guid: 'org-2', name: 'beta' },
    ],
    spaces: [
      { guid: 'space-1', name: 'dev', orgGuid: 'org-1' },
      { guid: 'space-2', name: 'prod', orgGuid: 'org-1' },
      { guid: 'space-3', name: 'dev', orgGuid: 'org-2' },
    ],
    apps: [
      { guid: 'app-1', name: 'api', spaceGuid: 'space-1', state: 'STARTED' },
      { guid: 'app-2', name: 'worker', spaceGuid: 'space-1', state: 'STOPPED' },
      { guid: 'app-3', name: 'ui', spaceGuid: 'space-2', state: 'STARTED' },
    ],
    sessions: [],
    entries: [],
    props: [],
    filters: [],
    exports: [],
    exportSavePath: 'C:\\mock\\export.ndjson',
    cancelledExports: new Set(),
    kv: {},
    failures: {},
    calls: [],
    version: '0.1.0-mock',
    pickFileResult: null,
    packaged: false,
    updateStatus: { state: 'idle', supported: false },
    availableVersion: null,
  };
}

export function createMockApi(init: Partial<MockState> = {}): MockApi {
  const state: MockState = { ...defaultMockState(), ...init };
  const listeners = new Map<string, Set<(payload: unknown) => void>>();

  const emit = <E extends keyof PushEvents>(event: E, payload: PushEvents[E]): void => {
    for (const cb of listeners.get(event) ?? []) cb(payload);
  };

  const authOf = (id: string): AuthStatus =>
    state.auth[id] ?? { loggedIn: false, canRefresh: false };
  const setAuth = (id: string, status: AuthStatus): AuthStatus => {
    state.auth[id] = status;
    emit('auth:changed', { connectionId: id, status });
    return status;
  };
  const connection = (id: string): ConnectionProfile => {
    const c = state.connections.find((x) => x.id === id);
    if (!c) throw { code: 'NOT_FOUND', message: `Unknown connection ${id}` };
    return c;
  };
  const requireLogin = (id: string): void => {
    if (!authOf(id).loggedIn) throw { code: 'AUTH_REQUIRED', message: 'Not logged in' };
  };
  const currentWorkspace = (): WorkspaceInfo => {
    const ws = state.workspaces.find((w) => w.id === state.currentWorkspaceId);
    if (!ws) throw { code: 'INVALID_INPUT', message: 'No workspace is open' };
    return ws;
  };
  const session = (id: number): LogSession => {
    const s = state.sessions.find((x) => x.id === id);
    if (!s) throw { code: 'NOT_FOUND', message: `Unknown session ${id}` };
    return s;
  };
  const toRecord = (e: EntryDetail): Record<string, unknown> => {
    const iso = new Date(Number(BigInt(e.tsNs) / 1_000_000n)).toISOString();
    return {
      ...(e.props ?? {}),
      id: e.id,
      session: e.sessionId,
      timestamp: iso,
      ts: iso,
      app: e.appName,
      app_name: e.appName,
      source_type: e.sourceType,
      instance: e.instance,
      stream: e.stream,
      level: e.level,
      message: e.message,
      msg: e.message,
      raw: e.raw,
    };
  };
  const filterEntries = (q: {
    sessionIds?: number[];
    dql?: string;
    snapshotId?: number;
  }): EntryDetail[] => {
    let rows = state.entries;
    if (q.sessionIds) rows = rows.filter((e) => q.sessionIds!.includes(e.sessionId));
    if (q.snapshotId !== undefined) rows = rows.filter((e) => e.id <= q.snapshotId!);
    if (q.dql?.trim()) {
      const parsed = parse(q.dql);
      if (!parsed.ok)
        throw { code: 'INVALID_INPUT', message: `Invalid query: ${parsed.error.message}` };
      const m = compileMatcher(parsed.ast, {
        textFields: [...TEXT_FIELDS],
        fieldKind: entryFieldKind,
      });
      rows = rows.filter((e) => m(toRecord(e)));
    }
    return rows;
  };
  const strip = (e: EntryDetail): EntryRow => {
    const { raw, ...row } = e;
    void raw;
    return row;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: { [K in keyof IpcContracts]: (req: IpcContracts[K]['req']) => any } = {
    'app:version': () => state.version,
    'app:info': () => ({ version: state.version, packaged: state.packaged, platform: 'win32' }),
    'update:status': () => state.updateStatus,
    'update:check': () => {
      if (!state.packaged) return state.updateStatus;
      state.updateStatus = state.availableVersion
        ? { state: 'available', version: state.availableVersion, supported: true }
        : { state: 'not-available', supported: true };
      emit('update:status', state.updateStatus);
      return state.updateStatus;
    },
    'update:download': () => {
      if (!state.packaged || state.updateStatus.state !== 'available') return state.updateStatus;
      state.updateStatus = state.updateStatus.version
        ? { state: 'downloaded', version: state.updateStatus.version, supported: true }
        : { state: 'downloaded', supported: true };
      emit('update:status', state.updateStatus);
      return state.updateStatus;
    },
    'update:install': () => undefined,
    'entries:validateDql': ({ dql }) => {
      const r = parse(dql);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    'connection:list': () => [...state.connections].sort((a, b) => a.name.localeCompare(b.name)),
    'connection:save': (req) => {
      if (!req.name.trim()) throw { code: 'INVALID_INPUT', message: 'Connection name is required' };
      if (req.authMode === 'origin' && !req.origin?.trim()) {
        throw {
          code: 'INVALID_INPUT',
          message: 'An identity provider origin is required for origin login',
        };
      }
      const now = Date.now();
      const existing = req.id ? state.connections.find((c) => c.id === req.id) : undefined;
      const profile: ConnectionProfile = {
        ...(existing ?? { id: nextId(), createdAt: now }),
        ...req,
        id: existing?.id ?? req.id ?? nextId(),
        apiUrl: req.apiUrl.replace(/\/+$/, ''),
        updatedAt: now,
        createdAt: existing?.createdAt ?? now,
      };
      state.connections = existing
        ? state.connections.map((c) => (c.id === existing.id ? profile : c))
        : [...state.connections, profile];
      return profile;
    },
    'connection:delete': ({ id }) => {
      state.connections = state.connections.filter((c) => c.id !== id);
      delete state.auth[id];
    },
    'connection:test': ({ apiUrl }) => {
      if (!/^https?:\/\//.test(apiUrl) && !/^[a-z0-9.-]+$/i.test(apiUrl)) {
        throw { code: 'INVALID_INPUT', message: `Invalid API URL: ${apiUrl}` };
      }
      const api = apiUrl.startsWith('http') ? apiUrl : `https://${apiUrl}`;
      const host = new URL(api).host.replace(/^api\./, '');
      return {
        api,
        uaa: `https://uaa.${host}`,
        login: `https://login.${host}`,
        logCache: `https://log-cache.${host}`,
        cloudControllerV3: `${api}/v3`,
      };
    },
    'auth:status': ({ connectionId }) => {
      connection(connectionId);
      return authOf(connectionId);
    },
    'auth:loginPassword': ({ connectionId, username, password }) => {
      connection(connectionId);
      if (!state.validCredentials.has(`${username}:${password}`)) {
        throw { code: 'AUTH_FAILED', message: 'Login failed: unauthorized: Bad credentials' };
      }
      return setAuth(connectionId, {
        loggedIn: true,
        username,
        canRefresh: true,
        expiresAt: Date.now() + 600_000,
      });
    },
    'auth:startPasscode': ({ connectionId }) => {
      connection(connectionId);
      if (state.passcodeWindowResult === 'use-valid-passcode') {
        return {
          kind: 'loggedIn',
          status: setAuth(connectionId, { loggedIn: true, username: 'sso-user', canRefresh: true }),
        };
      }
      return state.passcodeWindowResult;
    },
    'auth:passcodeLogin': ({ connectionId, passcode }) => {
      connection(connectionId);
      if (!state.validPasscodes.has(passcode.trim())) {
        throw { code: 'AUTH_FAILED', message: 'Login failed: unauthorized: Invalid passcode' };
      }
      return setAuth(connectionId, { loggedIn: true, username: 'sso-user', canRefresh: true });
    },
    'auth:logout': ({ connectionId }) => {
      connection(connectionId);
      setAuth(connectionId, { loggedIn: false, canRefresh: false });
    },
    'cf:orgs': ({ connectionId }) => {
      requireLogin(connectionId);
      return state.orgs;
    },
    'cf:spaces': ({ connectionId, orgGuid }) => {
      requireLogin(connectionId);
      return state.spaces.filter((s) => s.orgGuid === orgGuid);
    },
    'cf:apps': ({ connectionId, spaceGuid }) => {
      requireLogin(connectionId);
      return state.apps.filter((a) => a.spaceGuid === spaceGuid);
    },
    'workspace:list': () => [...state.workspaces],
    'workspace:create': ({ name }) => {
      if (state.workspaces.some((w) => w.name.toLowerCase() === name.trim().toLowerCase())) {
        throw {
          code: 'INVALID_INPUT',
          message: `A workspace named "${name.trim()}" already exists`,
        };
      }
      const ws: WorkspaceInfo = {
        id: nextId(),
        name: name.trim(),
        path: `C:\\mock\\${name.trim()}.sqlite`,
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
        sizeBytes: 0,
        exists: true,
      };
      state.workspaces.push(ws);
      state.currentWorkspaceId = ws.id;
      state.sessions = [];
      state.entries = [];
      emit('workspace:changed', { id: ws.id });
      return ws;
    },
    'workspace:open': ({ id }) => {
      const ws = state.workspaces.find((w) => w.id === id);
      if (!ws) throw { code: 'NOT_FOUND', message: `Unknown workspace ${id}` };
      state.currentWorkspaceId = id;
      ws.lastOpenedAt = Date.now();
      emit('workspace:changed', { id });
      return ws;
    },
    'workspace:openFile': ({ path }) => {
      let ws = state.workspaces.find((w) => w.path === path);
      if (!ws) {
        ws = {
          id: nextId(),
          name:
            path
              .split(/[\\/]/)
              .pop()
              ?.replace(/\.sqlite$/i, '') ?? 'file',
          path,
          createdAt: Date.now(),
          sizeBytes: 0,
          exists: true,
        };
        state.workspaces.push(ws);
      }
      state.currentWorkspaceId = ws.id;
      emit('workspace:changed', { id: ws.id });
      return ws;
    },
    'workspace:delete': ({ id }) => {
      state.workspaces = state.workspaces.filter((w) => w.id !== id);
      if (state.currentWorkspaceId === id) {
        state.currentWorkspaceId = null;
        emit('workspace:changed', { id: null });
      }
    },
    'workspace:current': () =>
      state.workspaces.find((w) => w.id === state.currentWorkspaceId) ?? null,
    'workspace:stats': () => {
      const ws = currentWorkspace();
      const ts = state.entries.map((e) => e.tsNs).sort();
      return {
        id: ws.id,
        path: ws.path,
        sizeBytes: ws.sizeBytes,
        sessions: state.sessions.length,
        entries: state.entries.length,
        minTsNs: ts[0] ?? null,
        maxTsNs: ts[ts.length - 1] ?? null,
      };
    },
    'workspace:kvGet': ({ key }) => state.kv[key] ?? null,
    'workspace:kvSet': ({ key, value }) => {
      if (value === null) delete state.kv[key];
      else state.kv[key] = value;
    },
    'workspace:pickFile': () => state.pickFileResult,
    'workspace:reveal': () => undefined,
    'session:list': () => [...state.sessions],
    'session:create': (req) => {
      connection(req.connectionId);
      const s: LogSession = {
        id: state.sessions.reduce((m, x) => Math.max(m, x.id), 0) + 1,
        name: req.name ?? req.appName,
        connectionId: req.connectionId,
        appGuid: req.appGuid,
        appName: req.appName,
        createdAt: Date.now(),
        status: 'stopped',
        entryCount: 0,
        pollIntervalMs: req.pollIntervalMs ?? 1000,
        ...(req.orgGuid ? { orgGuid: req.orgGuid } : {}),
        ...(req.orgName ? { orgName: req.orgName } : {}),
        ...(req.spaceGuid ? { spaceGuid: req.spaceGuid } : {}),
        ...(req.spaceName ? { spaceName: req.spaceName } : {}),
      };
      state.sessions.push(s);
      return s;
    },
    'session:start': ({ sessionId }) => {
      const s = session(sessionId);
      requireLogin(s.connectionId);
      s.status = 'running';
      emit('stream:status', { sessionId, status: 'running' });
      return s;
    },
    'session:stop': ({ sessionId }) => {
      const s = session(sessionId);
      s.status = 'stopped';
      emit('stream:status', { sessionId, status: 'stopped' });
      return s;
    },
    'session:setInterval': ({ sessionId, pollIntervalMs }) => {
      const s = session(sessionId);
      s.pollIntervalMs = pollIntervalMs;
      return s;
    },
    'session:clear': ({ sessionId }) => {
      const s = session(sessionId);
      state.entries = state.entries.filter((e) => e.sessionId !== sessionId);
      s.entryCount = 0;
      s.status = 'stopped';
      delete s.lastTsNs;
      return s;
    },
    'session:range': ({ sessionId }) => {
      session(sessionId);
      const rows = state.entries.filter((e) => e.sessionId === sessionId);
      if (rows.length === 0) return null;
      const ts = rows.map((e) => BigInt(e.tsNs));
      let min = ts[0]!;
      let max = ts[0]!;
      for (const t of ts) {
        if (t < min) min = t;
        if (t > max) max = t;
      }
      return { minTsNs: min.toString(), maxTsNs: max.toString(), count: rows.length };
    },
    'export:run': (req) => {
      state.exports.push(req);
      if (state.exportSavePath === null) return { jobId: null };
      const jobId = `job-${state.exports.length}`;
      const path = state.exportSavePath;
      const rows = req.scope.ids
        ? state.entries.filter((e) => req.scope.ids!.includes(e.id))
        : filterEntries(req.scope);
      setTimeout(() => {
        if (state.cancelledExports.has(jobId)) {
          emit('export:failed', { jobId, message: 'Export cancelled', cancelled: true });
          return;
        }
        emit('export:progress', { jobId, written: rows.length, total: rows.length });
        emit('export:done', { jobId, path, written: rows.length });
      }, 10);
      return { jobId, path };
    },
    'export:cancel': ({ jobId }) => {
      state.cancelledExports.add(jobId);
    },
    'export:reveal': () => undefined,
    'session:delete': ({ sessionId }) => {
      session(sessionId);
      state.sessions = state.sessions.filter((s) => s.id !== sessionId);
      state.entries = state.entries.filter((e) => e.sessionId !== sessionId);
    },
    'entries:query': (q) => {
      const rows = filterEntries(q);
      const sort = q.sort?.[0] ?? { key: 'timestamp', dir: 'desc' as const };
      const dir = sort.dir === 'asc' ? 1 : -1;
      const sorted = [...rows].sort((a, b) => {
        const av = toRecord(a)[sort.key];
        const bv = toRecord(b)[sort.key];
        const c = av === bv ? 0 : av === undefined ? 1 : bv === undefined ? -1 : av! < bv! ? -1 : 1;
        return c * dir || (a.id - b.id) * dir;
      });
      const limit = Math.min(Math.max(q.paging.limit, 1), 1000);
      const offset = Math.max(q.paging.offset, 0);
      return { rows: sorted.slice(offset, offset + limit).map(strip), limit, offset };
    },
    'entries:count': (q) => {
      const total = filterEntries(q).length;
      const { snapshotId, ...unsnapshotted } = q;
      void snapshotId;
      const maxId = filterEntries(unsnapshotted).reduce((m, e) => Math.max(m, e.id), 0);
      return { total, maxId };
    },
    'entries:get': ({ id }) => {
      const e = state.entries.find((x) => x.id === id);
      if (!e) throw { code: 'NOT_FOUND', message: `Unknown entry ${id}` };
      return e;
    },
    'entries:values': (q) => {
      const counts = new Map<string, number>();
      for (const e of filterEntries(q)) {
        const v = toRecord(e)[q.field];
        if (v === undefined || v === null || typeof v === 'object') continue;
        const s = String(v);
        if (q.prefix && !s.toLowerCase().startsWith(q.prefix.toLowerCase())) continue;
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, q.limit ?? 50)
        .map(([v]) => v);
    },
    'props:list': () => state.props,
    'filters:list': () => [...state.filters].sort((a, b) => a.name.localeCompare(b.name)),
    'filters:save': (req) => {
      const name = req.name.trim();
      if (!name) throw { code: 'INVALID_INPUT', message: 'Filter name is required' };
      const now = Date.now();
      const existing =
        state.filters.find((f) => f.id === req.id) ??
        state.filters.find((f) => f.name.toLowerCase() === name.toLowerCase());
      const filter: SavedFilter = {
        id: existing?.id ?? state.filters.reduce((m, f) => Math.max(m, f.id), 0) + 1,
        name,
        dql: req.dql.trim(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ...(req.timeFilter ? { timeFilter: req.timeFilter } : {}),
      };
      state.filters = existing
        ? state.filters.map((f) => (f.id === existing.id ? filter : f))
        : [...state.filters, filter];
      return filter;
    },
    'filters:delete': ({ id }) => {
      if (!state.filters.some((f) => f.id === id)) {
        throw { code: 'NOT_FOUND', message: `Unknown filter ${id}` };
      }
      state.filters = state.filters.filter((f) => f.id !== id);
    },
  };

  const api: PreloadApi = {
    invoke: async (channel, req) => {
      state.calls.push({ channel, req });
      const failure = state.failures[channel];
      if (failure) {
        delete state.failures[channel];
        return { ok: false, error: failure } as IpcResult<never>;
      }
      try {
        const value: unknown = await (handlers[channel] as (r: unknown) => unknown)(req);
        return { ok: true, value } as IpcResult<never>;
      } catch (err) {
        const e = err as { code?: string; message?: string };
        return {
          ok: false,
          error: { code: e.code ?? 'INTERNAL', message: e.message ?? String(err) },
        } as IpcResult<never>;
      }
    },
    on: (event, cb) => {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(cb as (payload: unknown) => void);
      return () => set!.delete(cb as (payload: unknown) => void);
    },
  } as PreloadApi;

  return { api, state, emit };
}

/** Installs the mock as `window.api` (tests, browser-only dev). Returns the mock for seeding/inspection. */
export function installMockApi(init: Partial<MockState> = {}): MockApi {
  const mock = createMockApi(init);
  (window as unknown as { api: PreloadApi }).api = mock.api;
  return mock;
}
