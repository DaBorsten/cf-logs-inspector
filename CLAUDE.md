# cf-log-inspector – project context for Claude Code

This file is the handover between development sessions (WSL and Windows checkouts). Keep it current when
milestones finish or decisions change. The detailed plan is in `docs/DEVELOPMENT_PLAN.md`; read it before
starting a new milestone.

## What this is

Cross-platform Electron desktop app (Linux/Windows/macOS) that logs in to Cloud Foundry spaces natively,
streams logs from many apps at once via the Log Cache API, stores them in switchable SQLite workspaces and
offers a filterable, column-configurable log table with a DQL-style query language, time filters,
auto-refresh and JSON/CSV export. It replaces `cf logs <app> [--recent]` in a terminal.

The author's earlier tools (`../cflogs`, `../log-viewer`, `../btpcflogin`, `../cf-sso-login`, siblings of this
repo on the WSL machine, not necessarily present on Windows) all shell out to the `cf` CLI. This app
deliberately does not depend on the `cf` CLI.

## Decisions (confirmed with the user on 2026-09-10, do not reopen)

| Topic | Decision |
|---|---|
| Shell | Electron + TypeScript (electron-vite 4, electron-builder 26), pnpm, Node 22. Tauri was rejected because of Linux WebKitGTK install friction. |
| CF access | Direct HTTP from the main process: UAA `/oauth/token`, CF v3 API, Log Cache `/api/v1/read/<guid>`. Renderer never talks to the network (CSP `connect-src 'none'` in production). |
| UI | React 19 + TanStack Table v8 + TanStack Virtual; Tailwind 4 + shadcn/ui (Radix); CodeMirror 6 for the query bar; TanStack Query for IPC data; zustand for UI state. |
| Persistence | Multiple named SQLite workspace files (better-sqlite3, WAL), one open at a time. Schema in the plan. |
| Credentials | Refresh tokens encrypted with Electron `safeStorage`; passwords are never stored. |
| Query language | OpenSearch DQL subset parsed in `src/shared/dql`, compiled to SQL in main. Adjacent clauses without an operator combine with **and** (`DEFAULT_OPERATOR` in `src/shared/dql/ast.ts`; DQL proper uses `or`). This is an assumption the user has not explicitly confirmed. |
| Dynamic properties | Only top-level JSON payload keys become columns; nested values stay queryable via dotted paths (`json_extract`). |

## Status

| Milestone | State |
|---|---|
| M0 scaffold | done: electron-vite, React, strict TS, typed contextBridge IPC with channel allowlist, CSP, single-instance lock, electron-builder targets, vitest, eslint, prettier |
| M1 shared DQL package | done: 220 vitest tests pass, typecheck and lint clean, `electron-vite build` succeeds |
| M2 auth + CF client | done (2026-09-10, Windows session): discovery, undici http with TLS options, UAA grants + TokenManager, passcode window, CC v3 orgs/spaces/apps, connection store, IPC `connection:*`/`auth:*`/`cf:*`; 336 tests, typecheck/lint/build clean. Not yet exercised against a real foundation. |
| M3 Log Cache streaming | done (2026-09-10): `LogCacheClient.read`, `LogPoller` (recent backfill, forward tail with overlap dedupe, immediate re-read on full page, backoff + Retry-After, auth pause/resume, abort), mock Log Cache route; 361 tests, typecheck/lint/build clean. Not yet exercised against a real foundation. |
| M4 storage | done (2026-09-10): WorkspaceManager (registry + one open SQLite file, WAL, migrations), schema v1, envelope parser, batched Writer with retention, StreamManager (sessions <-> pollers), IPC `workspace:*`/`session:*`, push `stream:batch`/`stream:status`; 440 tests. |
| M5 query engine | **next** |
| M6+ UI | not started |

`pnpm dev` was verified on Windows on 2026-09-10 (window shows the placeholder with the app version). The M2
code has only been tested against the in-process mock (`test/fixtures/mock-cf.ts`); the first real-foundation
check (password login, origin login, SSO passcode window, org/space/app listing) still has to happen, either
from a throwaway script or once the M6 connections UI exists.

Git: the repository was initialised on Windows on 2026-09-10 (`main`). The WSL checkout predates it; treat this
one as the origin of history.

## Repository layout (current)

```
CLAUDE.md                     this file
docs/DEVELOPMENT_PLAN.md      approved architecture + milestones (source of truth for design)
package.json                  scripts: dev, build, preview, typecheck, test, lint, format, package
electron.vite.config.ts       main/preload/renderer builds, alias @shared -> src/shared, @renderer -> src/renderer/src
electron-builder.yml          nsis / dmg+zip / AppImage+deb, asarUnpack **/*.node
tsconfig.base.json            strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
tsconfig.node.json            main + preload + shared + test
tsconfig.web.json             renderer + shared (+ src/preload/index.d.ts for window.api)
vitest.config.ts              globals on; renderer tests run in jsdom via environmentMatchGlobs
src/main/index.ts             window creation, CSP header injection, navigation lockdown, AppContext wiring
src/main/context.ts           AppContext { connections: ConnectionManager, logger } shared by IPC handlers
src/main/log.ts               Logger interface + noopLogger + redact(); cf/store code never imports electron-log
src/main/ipc/handle.ts        `handle(channel, zodSchema | undefined, fn)` -> IpcResult; toIpcError maps ZodError/CfError
src/main/ipc/push.ts          pushEvent(event, payload) to all windows
src/main/ipc/schemas.ts       zod request schemas per channel
src/main/ipc/register.ts      app:version, entries:validateDql + calls the domain registrations below
src/main/ipc/*.handlers.ts    connection, auth (passcode window), cf, workspace, session handlers
src/main/db/schema.ts         MIGRATIONS[] (user_version steps), applyPragmas, migrate
src/main/db/workspace-manager.ts WorkspaceManager: registry (workspaces.json), create/openById/openFile/delete/openLastOrDefault, db(), stats, kv, onBeforeClose hooks
src/main/db/repos/sessions.ts log_sessions CRUD, recordBatch, recountSessions, clearSessionData
src/main/db/repos/entries.ts  insertEntries (INSERT OR IGNORE, BigInt ts), retention deletes, session_props upsert/list, prepared() cache
src/main/ingest/parser.ts     parseEnvelope -> ParsedEntry (message/level/props/dedupeKey), normalizeLevel, levelFromText
src/main/ingest/writer.ts     Writer: batched transaction (250 ms / 500 rows), props, retention, stream:batch events
src/main/ingest/stream-manager.ts StreamManager: sessions <-> LogPoller, start/stop/setInterval/clear/delete/stopAll, handleAuthChanged
src/main/store/json-file.ts   readJsonFile(path, zodSchema, fallback) with corrupt-file backup, writeJsonAtomic
scripts/test.mjs              runs vitest under Electron's Node (ELECTRON_RUN_AS_NODE) so better-sqlite3 loads
src/main/cf/errors.ts         CfError hierarchy + httpStatusError / mapNetworkError / describeErrorBody
src/main/cf/http.ts           HttpClient over undici Agent (skipSslValidation, caCertPem, timeouts), json(req, zodSchema)
src/main/cf/discovery.ts      normalizeApiUrl, discoverEndpoints, guessLogCacheUrl
src/main/cf/uaa.ts            UaaClient grants, TokenSet/TokenStore, TokenManager, authStatusOf, decodeJwtPayload
src/main/cf/authorized.ts     getJsonWithAuth(http, tokens, url, schema): bearer GET, one 401 refresh+retry, reportUnauthorized
src/main/cf/cc-client.ts      CcClient.listOrgs/listSpaces/listApps with pagination (uses authorized.ts)
src/main/cf/log-cache.ts      LogCacheClient.read(sourceId, {startTimeNs,endTimeNs,limit,descending}) -> LogEnvelope[]; compareNs
src/main/cf/poller.ts         LogPoller: start/stop/resume, status, recent backfill + forward tail (see M3 section)
src/main/cf/passcode-window.ts openPasscodeWindow (per-connection partition), extractPasscode (pure)
src/main/cf/connection-manager.ts ConnectionManager: profiles CRUD, test(), authStatus(), runtime(id) cache
src/main/store/connections.ts ConnectionStore: connections.json (profiles + encrypted tokens), Encryptor interface
src/main/store/safe-storage.ts safeStorageEncryptor (only file besides index.ts/passcode-window/ipc that imports electron)
src/preload/index.ts          exposes window.api = { invoke(channel, req), on(event, cb) } with allowlists
src/shared/ipc/contracts.ts   IpcContracts, INVOKE_CHANNELS, PushEvents, PUSH_EVENTS (add channels here first)
src/shared/model/connection.ts ConnectionInput/Profile, AuthMode, AuthStatus, PasscodeStartResult
src/shared/model/cf.ts        CfEndpoints, CfOrg, CfSpace, CfApp
src/shared/model/log.ts       LogEnvelope (timestampNs string, sourceId, instanceId, appName?, sourceType?, stream, payload, tags)
src/shared/model/log-entry.ts ParsedEntry (stored row shape), LEVELS
src/shared/model/session.ts   LogSession, SessionStatus, SessionCreateInput, StreamBatchEvent, StreamStatusEvent, POLL_INTERVALS_MS
src/shared/model/workspace.ts WorkspaceInfo, WorkspaceStats, RetentionSettings, DEFAULT_RETENTION
src/shared/regions.ts         BTP_REGIONS catalogue, btpApiUrl(region), btpRegionFromApiUrl(url)
src/shared/dql/               ast, errors, tokenizer, parser, evaluator, wildcard, cursor, stringify, index + __tests__
src/renderer/src/App.tsx      placeholder UI
test/fixtures/mock-cf.ts      node:http(s) mock of API root + UAA + CC v3 + Log Cache read with mutable state (startMockCf, addLogs)
test/fixtures/tls/            self-signed localhost cert/key for TLS option tests (valid until 2036)
```

## Conventions

- `src/shared` must stay free of Node and DOM imports; it is bundled into both processes.
- Add an IPC channel by: type in `IpcContracts`, name in `INVOKE_CHANNELS`, handler via `handle()` in
  `src/main/ipc/register.ts` (split into `ipc/*.handlers.ts` per domain as they grow). Validate requests with zod
  in main. Push events go through `PushEvents` + `PUSH_EVENTS`.
- Timestamps from Log Cache are nanosecond int64 strings. Keep them as `bigint`/decimal strings; never `Number`.
  Over IPC they travel as strings.
- Tests are table-driven (`it.each`) and live next to the code in `__tests__`. Run `pnpm test`, `pnpm typecheck`,
  `pnpm lint` before committing; all three were clean at the last commit.
- `pnpm test` runs vitest inside Electron's Node (`scripts/test.mjs`, `ELECTRON_RUN_AS_NODE=1`) so the
  Electron-built `better-sqlite3` binary loads; `pnpm test:node` is plain vitest and only works while the
  binary happens to be ABI-compatible with the system Node. If `better-sqlite3` fails to load in the app,
  run `pnpm exec electron-rebuild -f -w better-sqlite3` (the `postinstall` `install-app-deps` step did not
  replace the Node prebuild on Windows/pnpm on 2026-09-10).
- SQLite integers: `ts_ns` is INTEGER; bind it as `BigInt` and read it back with `CAST(ts_ns AS TEXT)` (or
  `stmt.safeIntegers()`), never as a JS number. `INSERT OR IGNORE` also swallows NOT NULL/CHECK conflicts, so
  keep entries valid before insert; foreign-key violations still abort the flush.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` when Claude wrote the change.
- Formatting: prettier, single quotes, width 100, trailing commas (`.prettierrc`). All files are formatted since
  the M2 commit; run `pnpm format` before committing.
- `src/main/cf` and `src/main/store` must stay runnable under plain Node (vitest): no `electron` or `electron-log`
  imports there. Inject a `Logger` (`src/main/log.ts`) and an `Encryptor`; only `safe-storage.ts`,
  `passcode-window.ts`, `ipc/*` and `index.ts` touch Electron APIs.
- Errors thrown from main are `CfError` subclasses with a stable `code` (`src/main/cf/errors.ts`); `toIpcError`
  puts that code on the wire, so the renderer branches on `error.code`, never on messages.

## DQL package semantics (src/shared/dql)

- `parse(input)` never throws; returns `{ok, ast, tokens}` or `{ok:false, error:{message,start,end}, tokens}`.
  `parseOrThrow`, `stripSpans`, `astKey` (stable hash key) also exported.
- AST: `match_all | and | or | not | term (free text) | match (field:value) | exists (field:*) | range (field>v)`.
  `Literal {raw, quoted, hasWildcard, segments?}`: `segments` is present only for wildcard literals and holds the
  text between `*`s, already unescaped, so compilers emit LIKE/regex without re-escaping.
- Value literals after `:` or a range operator merge contiguous tokens, so `url:http://x/y` and
  `ts>=2026-01-01T00:00:00Z` parse without escaping colons. A space before `:` is an error (`a :x`).
- `field:(a or b and not c)` and `bytes:(>100 and <200)` are desugared into plain boolean nodes over `match`/`range`.
- Keywords `and/or/not` are case-insensitive; `level:and` and `and:x` are literals/fields, `\and` is a free term.
- Evaluator: `field:value` is case-insensitive exact on keyword fields and substring on text fields (default
  `textFields = ['message']`); arrays match if any element matches; objects never match; ranges compare numerically
  when both sides are numeric, as dates on `timestamp|ts|@timestamp|time` or ISO-looking literals, else lexicographic.
- `wildcard.ts`: `segmentsToRegExp`, `segmentsToLike`, `containsToLike`, `escapeLike`, `globToRegExp`. The test
  `wildcard.test.ts` proves regex and LIKE agree; reuse it when writing the SQL compiler.
- `completionContextAt(input, cursor)` -> `field-or-term | value{field,inGroup} | operator | none` for autocomplete.
- `stringify(ast)` is canonical and round-trips (`parse(stringify(parse(q)))` equals `parse(q)` after `stripSpans`).

## Verified external API facts (checked 2026-09-10)

- Log Cache: `GET {log_cache}/api/v1/read/<source-id>?start_time=<ns incl>&end_time=<ns excl>&envelope_types=LOG&limit=1000&descending=bool`,
  bearer token required. Response `{envelopes:{batch:[{timestamp:"<ns>", source_id, instance_id, tags:{app_name, source_type,...}, log:{payload:"<base64>", type:"OUT"|"ERR"}}]}}`.
  `--recent` = one descending read with limit 1000. Live tail = walk forward from cursor, re-read immediately when a page is full.
- UAA: `POST {login}/oauth/token` with `Authorization: Basic Y2Y6` (client `cf`, empty secret).
  Grants: `grant_type=password&username&password[&login_hint={"origin":"<key>"}]`,
  `grant_type=password&passcode=<code>` (code from `{login}/passcode`), `grant_type=refresh_token&refresh_token=`.
- Discovery: `GET {api}/` -> `links.{uaa,login,log_cache,cloud_controller_v3}.href`.
- SAP BTP hosts: `api.cf.<region>.hana.ondemand.com`, `login.cf.<region>.hana.ondemand.com`; region `cn40` uses
  `.platform.sapcloud.cn`. Region catalogue to copy: npm package `btpcflogin`, file `data/regions-data.json`.
  The app must also accept arbitrary API URLs (non-BTP foundations).

## M2 auth + CF client: how it fits together (done)

- `ConnectionManager.runtime(id)` lazily builds and caches per profile: `HttpClient` (own undici Agent with the
  profile's TLS settings) -> `discoverEndpoints` -> `UaaClient(login)` -> `TokenManager(store.tokenStore(id))`
  -> `CcClient(cloud_controller_v3)`. Saving or deleting a profile disposes the runtime; a failed build is not
  cached. `authStatus(id)` reads stored tokens without network when no runtime exists.
- `TokenManager.getAccessToken()` returns the cached token until 60 s before expiry, then refreshes with a single
  in-flight promise. A UAA rejection of the refresh clears the tokens and fires `onAuthRequired('refresh-failed')`;
  non-auth failures (5xx, network) keep the session. `CcClient` retries once after a 401 with `forceRefresh()`
  and calls `reportUnauthorized()` if the retry is rejected too. M3 pollers must pause on `auth:required`.
- Login modes: `auth:loginPassword` sends `login_hint={"origin":...}` when the profile is `origin` mode (or the
  dialog passes an origin). `auth:startPasscode` opens `passcode-window.ts` (partition `persist:uaa-<id>`,
  https-only navigation, `certificate-error` accepted only with skipSslValidation), scrapes the code from the
  "Temporary Authentication Code" page via `executeJavaScript(document.body.innerText)` and logs in; on window
  close it returns `{kind:'cancelled'}` and the UI should offer `auth:passcodeLogin` (manual paste).
- Tokens: whole `TokenSet` (access + refresh + expiry + username) is JSON-encrypted with `safeStorage` into
  `connections.json` `tokens[id]`; if encryption is unavailable a per-id `MemoryTokenStore` is used instead.
- Errors: UAA 400/401 on login -> `AUTH_FAILED` (bad credentials), on refresh -> `AUTH_REQUIRED`; CC 401 ->
  `AUTH_REQUIRED`; TLS handshake codes -> `TLS_ERROR`; everything else per `httpStatusError`.
- The mock (`startMockCf`) serves UAA under `<base>/uaa` (so prefix handling is tested), caps `per_page` at 2 to
  force pagination, and exposes `state.validAccessTokens/validRefreshTokens/failNextCc/failNextUaa/notCf`.

## M3 Log Cache streaming: how it works (done)

- `LogCacheClient.read` -> `GET {log_cache}/api/v1/read/<guid>?envelope_types=LOG&limit=<=1000[&start_time&end_time&descending]`
  via `getJsonWithAuth`. Only envelopes with a `log` member are returned; payload is base64-decoded, `stream` is
  `OUT|ERR`, `appName`/`sourceType` come from tags. Timestamps stay decimal strings (`compareNs` for ordering).
- `LogPoller` (one per app stream) runs a single loop: optional backfill (`recent`: one descending read, page
  delivered oldest-first, cursor = last ts + 1) then forward reads from `cursor`. After a full page it re-reads
  immediately from `cursor`; otherwise it sleeps `pollIntervalMs` (1 s) and re-reads from
  `max(cursor - overlapMs, floor)` where `floor` is the start position (fromNs / now / end of backfill), so
  late arrivals within 2 s are caught but nothing before the start is ever read. Duplicates are dropped with an
  in-memory key set (`ts instance stream payload`) pruned to the overlap window; storage (M4) must still use
  `INSERT OR IGNORE` because a restart loses the set.
- `onBatch` may be async; the batch is only marked seen and the cursor only advanced after it resolves, so a
  writer failure leads to backoff and re-delivery of the same envelopes.
- Errors: `AUTH_REQUIRED|AUTH_FAILED` -> state `paused-auth` until `resume()` (call it after a successful login;
  M4's StreamManager should do this on `auth:changed` with `loggedIn`). Everything else -> state `backoff` with
  exponential wait 1 s -> 30 s (reset after success), `retryAfterMs` honoured up to 5 min. `stop()` aborts the
  in-flight request and any sleep and resolves once the loop reports `stopped`.
- `sleep` and `nowNs` are injectable; tests use a manual gate (`Gate` in `poller.test.ts`) instead of fake timers
  so real HTTP to the mock keeps working. Mock knobs: `state.logs`, `addLogs(sourceId, messages, startNs, stepNs)`,
  `logCacheLimitCap`, `failLogCache` (queue), `scrambleLogCache`.

## M4 storage: how it works (done)

- `WorkspaceManager` keeps a registry (`<userData>/workspaces.json`: id, name, path, createdAt, lastOpenedAt,
  lastOpenId) and exactly one open `better-sqlite3` connection. Files live at
  `<userData>/workspaces/<slug>-<id8>.sqlite`; `openFile` registers arbitrary paths. Opening applies pragmas
  (WAL, synchronous=NORMAL, foreign_keys=ON), runs `migrate`, and resets every `log_sessions.status` to
  `stopped`. Switching/closing runs `onBeforeClose` hooks first; `StreamManager` registers `stopAll()` there.
  `index.ts` calls `openLastOrDefault()` at startup (creates `default` on first run) and emits
  `workspace:changed {id | null}`.
- `parseEnvelope`: trims trailing newlines, JSON object payloads -> `message` from `msg|message|text|log`,
  `level` from `level|severity|lvl|loglevel|log_level|levelname` (words or pino numbers) else a heuristic on
  the text (`levelFromText`, first 64 chars), `props` = the whole parsed object; plain text -> heuristic level,
  `props = null`. `dedupeKey = ts:appGuid:instance:stream:sha1(raw)[0..16]` (app name changes do not dupe).
- `Writer` (one per open workspace, owned by `StreamManager`): `enqueue(sessionId, entries)` resolves after
  the transaction that stored them; flush at 500 queued rows or after 250 ms. Per flush and session:
  `INSERT OR IGNORE`, `recordBatch` (entry_count, monotonic `last_ts_ns`), `session_props` upsert
  (type/count/sample, `mixed` on type conflicts), per-session retention (oldest rows beyond
  `maxRowsPerSession`), then workspace-wide retention (`SUM(entry_count)` vs `maxRowsWorkspace`, recount
  affected sessions), then `stream:batch {sessionId, inserted, totalCount, latestId}`. A failing flush rejects
  the awaiting pollers, which back off and re-deliver.
- `StreamManager.start(sessionId, recent)` builds a `LogPoller` from the connection runtime's `logCache`;
  without `recent` it resumes from `last_ts_ns + 1`. Poller status maps to `SessionStatus`
  (`running|backoff|paused-auth|stopped`), is persisted to `log_sessions.status` on transitions and pushed as
  `stream:status`. `setInterval` restarts a running poller; `clear` stops and wipes entries + props;
  `handleAuthChanged(connectionId, {loggedIn:true})` resumes paused pollers (wired in `index.ts`).
- Retention defaults: 500k rows per session, 2M per workspace (`DEFAULT_RETENTION`); not yet user-configurable
  (M12 settings UI; store in `kv` when that lands).

## Next milestone: M5 query engine (see plan section "SQL compilation" and the `EntryQuery` contract)

Create `src/main/db/query-compiler.ts` (DQL AST -> SQL: fixed field allowlist `ts|timestamp -> ts_ns`,
`app -> app_name`, `source_type`, `instance`, `stream`, `level`, `message`, `session -> session_id`; dynamic
names `/^[A-Za-z_@][\w-]*(\.[A-Za-z_@][\w-]*)*$/` -> `json_extract(props, ?)` with bound `$.path`; `LIKE ? ESCAPE '\'`
via `segmentsToLike`/`containsToLike` from `src/shared/dql/wildcard.ts`; numeric compare through
`CAST(.. AS REAL)` guarded by `json_type`; `exists` -> `IS NOT NULL`; base predicate
`session_id IN (...) AND ts_ns BETWEEN ? AND ?` first; allowlisted sort keys with `id` tiebreaker; prepared
statement LRU), `src/main/db/repos/entries.ts` additions (`query`, `count {total, maxId}`, `get(id)`, `values(field)`
for autocomplete), `props:list` from `listProps`, time filter resolution (relative -> absolute ns in main),
snapshot paging (`id <= snapshotId`), and IPC `entries:{query,count,get,values}` + `props:list`. Test SQL vs
`evaluate()` equivalence on fixtures in a temp database (both must agree on the DQL semantics listed above,
including `textFields = ['message']` substring vs keyword exact match and range typing).

## Platform notes

- Native module: `better-sqlite3` is rebuilt for Electron by `postinstall` (`electron-builder install-app-deps`).
  Never share one `node_modules` between WSL and Windows; each OS needs its own install.
- Windows: use a native Windows clone (not a path under `\\wsl$`), Node 22 + pnpm installed on Windows.
  `.gitattributes` forces LF (`* text=auto eol=lf`). `pnpm dev` works; to see renderer console output in the
  terminal (e.g. preload failures) run with `ELECTRON_ENABLE_LOGGING=1`. In PowerShell, `Start-Process pnpm`
  fails (shim is not a Win32 app); use `cmd /c pnpm ...` when scripting.
- Sandboxed renderers only accept CommonJS preload scripts: the preload build is forced to `format: 'cjs'` with
  entry `index.cjs` in `electron.vite.config.ts`. An ESM `.mjs` preload fails silently with a blank window.
- WSL: WSLg is available (DISPLAY=:0), so `pnpm dev` opens a window. If Chromium sandbox errors appear use
  `ELECTRON_DISABLE_SANDBOX=1 pnpm dev`; GPU glitches: `pnpm dev -- --disable-gpu`.
- The `.npmrc` uses `node-linker=hoisted` so electron-builder can resolve native deps.

## Open questions for the user

- Confirm implicit DQL operator `and` (vs. DQL default `or`).
- Confirm Windows-first vs. Linux-first manual testing priority for packaged builds.
- Passcode page scraping (`extractPasscode`) is based on the UAA "Temporary Authentication Code" page layout and
  has not been verified against a real SAP BTP login; the manual-paste path (`auth:passcodeLogin`) is the fallback.
