# cf-log-inspector – project context for Claude Code

This file is the handover between development sessions (WSL and Windows checkouts). Keep it current when
milestones finish or decisions change. The detailed plan is in `docs/DEVELOPMENT_PLAN.md`; read it before
starting a new milestone. A VS Code extension track (shared core, separate front-end) is planned in
`docs/DEVELOPMENT_PLAN_VSCODE.md`; not started, no bearing on the Electron milestones below until M13+ picks
it up.

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
| M5 query engine | done (2026-09-10): DQL->SQL compiler, entry query/count/get/values, props list, time filters, snapshot paging, IPC `entries:*` + `props:list`; 100-query SQL-vs-evaluator equivalence suite; 582 tests. |
| M6 app shell + workspaces + connections UI | done (2026-09-10): Tailwind 4 + Radix primitives, TanStack Query, zustand; AppShell (TitleBar/SidePanel/StatusBar), theme, workspace switcher + manage dialog, connections panel/form, login dialog (password / origin / passcode + manual paste), auth:required toasts; in-memory IPC mock for jsdom tests; 597 tests. Still no real-foundation check. |
| M7 streams panel | done (2026-09-10): connection/org/space pickers, app multi-select with filter, recent toggle, start (reuse existing session per app), stream list with stop/resume, poll interval, clear/delete, login shortcut; 603 tests. End-to-end against a real foundation still pending. |
| M8 log table core | done (2026-09-10): virtualized TanStack table with snapshot paging, new-entries banner, header sort, column resize, column picker (fixed + dynamic props, reorder) persisted per workspace in kv, Local/UTC toggle, plain-text DQL input with live validation; 611 tests. |
| M9 query bar (CodeMirror) | done (2026-09-10): CodeMirror 6 single-line DQL editor with token highlighting, lint squiggles, field/value/operator autocomplete (`entries:values`), Enter/Escape, query history (kv `query.history`), saved filters (`saved_filters` table + `filters:*` IPC); 649 tests. |
| M10 time filter + auto refresh + tail | done (2026-09-10): time range chip/panel (quick picks, custom relative, absolute in local/UTC, all time), auto refresh interval (off/1/2/5/10/30 s), tail mode with pause on scroll/hover/resize, refresh re-runs pages; 657 tests. |
| M11 detail + interaction | done (2026-09-10): row selection (click/Ctrl/Shift, arrows/Page/Home/End, Ctrl+A, Escape), Ctrl+C copies NDJSON via entries:get, resizable detail panel (message/JSON tree/raw tabs, fields sidebar, copy buttons, filter for/out), query term highlighting, multi-line markers; 677 tests. |
| M12 export + sessions | done (2026-09-10): streaming NDJSON/JSON/CSV export (`ExportJob`/`ExportManager`), `export:*` IPC + progress/done/failed push events, `ExportDialog` (format/scope/columns, progress, cancel, reveal), session scoping + "set time range to session" (`session:range`) with a query-bar scope chip, retention settings UI in the workspace dialog; 702 tests, typecheck/lint clean. |
| M13 packaging + CI | done (2026-09-11): electron-builder targets were already in place; added GitHub Actions CI (`ci.yml`: ubuntu-only lint/typecheck, then test+build matrix on ubuntu/windows/macos) and a tag-triggered release workflow (`release.yml`: `v*.*.*` tags build and `electron-builder --publish always` per OS into one draft GitHub Release), `packageManager` pin (`pnpm@10.6.5`) for corepack, `publish` block in `electron-builder.yml` (GitHub, draft). Unsigned builds; auto-update out of scope. Not yet exercised by pushing a real tag. |
| M14+ | not started |

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
docs/DEVELOPMENT_PLAN_VSCODE.md  VS Code extension track: architecture mapping, reuse inventory, risks, M13-M19 (not started)
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
src/main/db/repos/entries.ts  insertEntries (INSERT OR IGNORE, BigInt ts), retention deletes, session_props upsert/list, prepared() LRU cache (200)
src/main/db/query-compiler.ts compileDql(ast) -> {sql, params}; jsonPaths, sortExpression, TS_ISO_EXPR (see M5 section)
src/main/db/entry-query.ts    queryEntries, countEntriesFor, getEntry, distinctValues, listPropInfos (base predicate + compiled DQL)
src/main/db/time.ts           resolveTimeFilter(filter, nowMs) -> {fromNs?, toNs?}, isoToNs, msToNs
src/main/ipc/entries.handlers.ts entries:query/count/get/values, props:list
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
src/preload/index.ts          exposes window.api (PreloadApi from src/shared/ipc/bridge.ts) with channel/event allowlists
src/shared/ipc/bridge.ts      PreloadApi interface (implemented by preload and by the renderer mock)
src/renderer/src/main.tsx     imports styles/globals.css; installs the mock backend when window.api is missing (browser dev)
src/renderer/src/App.tsx      Providers (QueryClient + Toaster) -> AppShell
src/renderer/src/api/client.ts     invoke(channel, req) unwrapping IpcResult -> throws ApiError{code}; onEvent; errorMessage
src/renderer/src/api/useApiEvent.ts useApiEvent(event, handler)
src/renderer/src/api/mock/mock-api.ts createMockApi/installMockApi: full in-memory IpcContracts implementation with seedable state, failures, emit()
src/renderer/src/queries/     keys.ts (qk), workspaces.ts, connections.ts, sessions.ts (TanStack Query hooks + mutations)
src/renderer/src/store/ui.ts  zustand UI state (theme, side panel tab, open dialogs) persisted to localStorage
src/renderer/src/app/         AppShell, TitleBar (workspace switcher, theme menu), SidePanel (tabs), StatusBar, ApiEvents (push -> invalidate/toasts), Providers, theme.ts
src/renderer/src/components/ui/ button, input (Input/Textarea/NativeSelect), field (Label/Field/ErrorText), badge, dialog, tabs, switch, dropdown-menu, misc (Spinner/EmptyState/Toaster)
src/renderer/src/features/workspaces/  WorkspaceSwitcher, WorkspaceDialog (create / open file / delete with typed confirm)
src/renderer/src/features/connections/ ConnectionsPanel, ConnectionForm, ConnectionEditorDialog, LoginDialog
src/renderer/src/features/sessions/    SessionsPanel (read-only list)
src/renderer/src/features/streams/     StreamsPanel (guards) -> StreamPicker (connection/org/space/apps, recent, start) + StreamList (rows with controls)
src/renderer/src/queries/cf.ts         useOrgs/useSpaces/useApps (enabled only while logged in)
src/renderer/src/queries/sessions.ts   useSessions + useStartStreams (create-or-reuse + start per app), start/stop/setInterval/clear/delete mutations
src/renderer/src/lib/colors.ts         appHue/appColor: deterministic colour tag per app name
src/renderer/src/lib/time.ts           formatTimestamp, formatMinute, msToDateTimeInput/dateTimeInputToMs (datetime-local in local|utc), describeTimeFilter
src/renderer/src/store/query.ts        committed dql, sort (toggleSort cycles asc/desc/default), sessionIds, time, tz, refreshIntervalMs (REFRESH_INTERVALS_MS), tail
src/renderer/src/features/time-filter/TimeFilterControl.tsx chip + panel writing useQueryStore.time (QUICK_PICKS, relative form, absolute form)
src/renderer/src/store/selection.ts    ephemeral selection {ids, anchor, focus} + detailOpen
src/renderer/src/features/log-table/selection.ts pure selectByClick/moveSelection (tests in __tests__/selection.test.ts)
src/renderer/src/features/log-table/highlight.tsx buildHighlightTerms(dql) -> RegExp[], highlightSegments, <Highlighted/>
src/renderer/src/features/log-table/table-meta.ts TableMeta augmentation (highlightTerms passed to cells)
src/renderer/src/lib/dql-edit.ts        quoteDqlValue, scalarToDql, isFilterableField, appendClause(dql, field, value, negate)
src/renderer/src/features/detail/       RowDetailPanel (kv layout.detail height, tabs message/json/raw, fields sidebar with filter for/out, copy raw/JSON, copyText), JsonTree (collapsible, per-leaf filter/copy)
src/renderer/src/features/log-table/   LogView (QueryInput + LogTable), LogTable (virtualized grid), columns.tsx (fixed + p:<key> defs, layout types), useEntries.ts (snapshot/pages/props hooks), useColumnLayout.ts (kv-persisted layout), ColumnPicker
src/renderer/src/features/query-bar/ QueryBar (editor + Apply + history/saved-filter panels), QueryEditor (CodeMirror wrapper), dql-language.ts (classifyTokens/dqlHighlight, dqlDiagnostics/dqlLint, completionOptions/dqlCompletionSource, singleLine, dqlTheme)
src/renderer/src/queries/kv.ts         useKvJson(key, fallback) -> {value, set} per open workspace
src/renderer/src/queries/filters.ts    useSavedFilters/useSaveFilter/useDeleteFilter
src/renderer/src/test/codemirror.ts    queryEditorView/setQueryText/pressInQuery test helpers (typing into contenteditable is unreliable in jsdom)
src/shared/model/filters.ts            SavedFilter/SavedFilterInput, QUERY_HISTORY_KV_KEY/LIMIT
src/main/db/repos/filters.ts           listFilters/saveFilter (upsert by id or case-insensitive name)/deleteFilter; ipc/filters.handlers.ts
src/renderer/src/api/mock/entries.ts   makeMockEntries(n, opts) + propsOf(entries) fixture generators
src/renderer/src/test/render.tsx setupMock(state) + renderWithProviders + sampleConnection for component tests
src/renderer/src/styles/globals.css Tailwind 4 import, shadcn-style tokens (light/dark via .dark), base layer
src/shared/ipc/contracts.ts   IpcContracts, INVOKE_CHANNELS, PushEvents, PUSH_EVENTS (add channels here first)
src/shared/model/connection.ts ConnectionInput/Profile, AuthMode, AuthStatus, PasscodeStartResult
src/shared/model/cf.ts        CfEndpoints, CfOrg, CfSpace, CfApp
src/shared/model/log.ts       LogEnvelope (timestampNs string, sourceId, instanceId, appName?, sourceType?, stream, payload, tags)
src/shared/model/log-entry.ts ParsedEntry (stored row shape), LEVELS
src/shared/model/session.ts   LogSession, SessionStatus, SessionCreateInput, StreamBatchEvent, StreamStatusEvent, POLL_INTERVALS_MS
src/shared/model/workspace.ts WorkspaceInfo, WorkspaceStats, RetentionSettings, DEFAULT_RETENTION
src/shared/model/fields.ts    FIXED_FIELDS (name/aliases -> column/kind), TEXT_FIELDS, DYNAMIC_FIELD_RE, resolveFixedField, entryFieldKind
src/shared/model/query.ts     EntryQuery, TimeFilter, SortSpec, EntryRow/EntryDetail/EntryPage, EntryCount, ValuesQuery, PropInfo
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
  binary happens to be ABI-compatible with the system Node. `postinstall` is `electron-rebuild -f -w
  better-sqlite3` because `electron-builder install-app-deps` left the Node prebuild in place under pnpm on
  Windows (seen twice on 2026-09-10; symptom: NODE_MODULE_VERSION 137 vs 139 in every DB test). After any
  `pnpm add/install`, if DB tests fail with that message run `pnpm exec electron-rebuild -f -w better-sqlite3`.
- Renderer components: no Node imports; talk to main only through `api/client.ts` (`invoke`) and TanStack
  Query hooks in `queries/`; UI state in `store/ui.ts`. Forms use native `<select>` (`NativeSelect`) so
  jsdom tests can drive them with `userEvent.selectOptions`. Component tests: `setupMock(state)` installs
  the in-memory backend on `window.api`, `renderWithProviders(<X/>)`, then assert on `mock.state` /
  `mock.state.calls`; wrap direct zustand updates in `act()`. Push events are simulated with `mock.emit()`.
- New IPC channel checklist now includes the mock: add the handler in `api/mock/mock-api.ts` (TypeScript
  fails until every channel is implemented).
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

## M5 query engine: how it works (done)

- Field model (`src/shared/model/fields.ts`): fixed fields with aliases map to columns and kinds:
  `timestamp|ts|@timestamp|time` (date, `ts_ns`), `app|app_name|appName` (keyword), `app_guid`, `source_type|
  sourceType|source`, `instance` (number), `stream`, `level|severity`, `message|msg` (text), `raw` (text),
  `session|session_id` (number), `id` (number). Free-text terms search `message OR raw`. Anything else is a
  dynamic property in `props` and must match `DYNAMIC_FIELD_RE`.
- `compileDql(ast)` returns `{sql, params}` with positional `?` params. Semantics mirror the evaluator:
  text fields substring (`LIKE '%x%' ESCAPE '\'`), other fields case-insensitive exact via `CAST(.. AS TEXT) LIKE`
  (wildcards -> `segmentsToLike`); `NOT` wraps `COALESCE(.., 0)` so NULLs negate to true; `timestamp` matches
  against `TS_ISO_EXPR` (ISO with ms) and ranges bind `ts_ns` BigInt (ISO literal via `isoToNs`, numeric = epoch
  ms); dynamic properties dispatch on `json_type`: object -> no match, array -> `json_each` any scalar element,
  booleans compare as `true|false`, null -> no match; dotted names try all flattened/nested path compositions
  (`jsonPaths`, up to 4 segments, evaluator order) joined with OR; wildcard field names walk `json_tree(props)`
  matching the dotted key path with LIKE. Ranges: numeric when the literal is numeric and the value is a number
  or fully numeric text (GLOB checks), date via `julianday` when the literal is ISO and the value looks like a
  date, else text comparison. JSON paths are embedded as SQL string literals (validated names), not bound.
- `entry-query.ts`: `buildWhere` puts `session_id IN`, `ts_ns >=/<` and `id <= snapshotId` before the DQL;
  `queryEntries` clamps paging (max 1000), sorts by allowlisted keys with `id` tiebreaker (default `ts_ns DESC`),
  returns `EntryRow` with `props` parsed (no `raw`; `getEntry` adds it). `countEntriesFor` returns `total`
  within the snapshot and `maxId` ignoring it (new-entries banner). `distinctValues` groups by value with
  frequency order and prefix filter (text fields return []). Relative time filters resolve against `nowMs`
  passed in by the caller (tests inject it).
- Known divergences from the evaluator, all documented in the compiler header: SQLite case folding is
  ASCII-only; `1.0`/`1e21` numbers print differently; zoneless ISO strings compare as UTC in SQL but local in
  JS; `a[0].b` style paths appear only in SQL. The equivalence suite in `entry-query.test.ts` runs ~100 queries
  over a 120-row fixture through both engines; extend it whenever the compiler or evaluator changes.

## M6 app shell + workspaces + connections UI: how it works (done)

- Stack: Tailwind 4 via `@tailwindcss/vite` (renderer plugin in electron.vite.config.ts), hand-written
  shadcn-style components over the unified `radix-ui` package (Dialog, Tabs, Switch, DropdownMenu, Label),
  `lucide-react` icons, `sonner` toasts, TanStack Query 5, zustand 5 with `persist`. No shadcn CLI; add
  components by hand in `components/ui`.
- Data flow: hooks in `queries/*` wrap `invoke()`; `ApiEvents` (rendered once in AppShell) maps push events:
  `workspace:changed` -> invalidate workspaces/current/stats/sessions/entries/props; `auth:changed` ->
  `setQueryData(qk.auth(id))` + invalidate `['cf', id]`; `auth:required` -> error toast with a "Log in" action
  (`openLogin(id)`), deduped per connection by toast id; `stream:*` -> invalidate sessions (+ stats on batch).
- Workspaces: `WorkspaceSwitcher` (title bar dropdown) switches or opens the `WorkspaceDialog`
  (create, open file via `workspace:pickFile` + `workspace:openFile`, reveal, delete with typed-name confirm).
  `MainArea` shows an empty state when no workspace is open and a stats card otherwise (log table comes in M8).
- Connections: `ConnectionsPanel` lists profiles with live auth status (`useAuthStatus`), Log in / Log out,
  edit, delete. `ConnectionForm` covers name, BTP region (grouped by provider from `BTP_REGIONS`, URL derived
  with `btpApiUrl`) or custom API URL, login mode, origin key, remembered username, TLS options (skip SSL,
  extra CA), "Test connection" (`connection:test` -> endpoints). Editing detects the region with
  `btpRegionFromApiUrl`.
- Login: `LoginDialog` is opened via `useUiStore.openLogin(id)`. Password/origin mode posts
  `auth:loginPassword` and silently saves a changed username/origin back to the profile. Passcode mode:
  "Open SSO login window" -> `auth:startPasscode`; `loggedIn` closes, `cancelled` switches to the manual paste
  form (`auth:passcodeLogin`), which is also reachable directly.
- Theme: `useThemeEffect` toggles `.dark` on `<html>` from the store (`light|dark|system`, follows the OS in
  system mode). Sonner's theme follows the same resolver.
- Main additions: `workspace:pickFile` (Electron `dialog.showOpenDialog`) and `workspace:reveal`
  (`shell.showItemInFolder`).

## M7 streams panel: how it works (done)

- `StreamsPanel` guards (no workspace / loading / no connections -> empty states), then renders
  `StreamPicker` above `StreamList`.
- `StreamPicker` keeps its selection in `useUiStore.streamPicker` (connection, org, space, recent; persisted)
  so tab switches do not lose it; stale ids fall back gracefully (first connection, empty org/space). Orgs,
  spaces and apps load only while the connection's `useAuthStatus` says logged in; otherwise a "Log in" button
  opens the login dialog. Apps render as a checkbox list with a text filter, "Select all" (skips already
  streaming apps), an app-state badge and a "streaming" badge for apps with a non-stopped session.
- Start: `useStartStreams` lists sessions once, then per selected app reuses the session with the same
  connection + app GUID or creates one (with org/space names), and starts it with the `recent` flag; errors are
  prefixed with the app name. Everything invalidates `qk.sessions` and `qk.workspaceStats`.
- `StreamList` rows: colour dot (`appColor`), name, status badge (`streaming|stopped|retrying|login required`),
  connection / org / space, entry count and last error; stop/resume icon button; inline poll interval select
  (`POLL_INTERVALS_MS`, restarts a running poller in main); clear and delete with inline confirmation; a "Log in"
  button for `paused-auth` sessions. No Radix dropdowns in rows (slow and flaky in jsdom; inline controls test
  fine with `userEvent`).

## M8 log table core: how it works (done)

- `useQueryStore` holds what the table shows: committed `dql`, `sort` (single key; `toggleSort` cycles
  asc -> desc -> `DEFAULT_SORT`), `sessionIds`, `time`, `tz` (persisted). `QueryInput` edits a draft, validates
  with `entries:validateDql` (debounced 200 ms, error shown with position), Enter/Apply commits, Escape reverts.
- `useEntrySnapshot(scope)`: `live` count (`entries:count` without snapshot) -> when the scope key changes the
  snapshot becomes `live.maxId`; `inSnapshot` count gives the displayed total; `newCount = live.total -
  inSnapshot.total` drives the "N new entries · show" pill; `refresh()` refetches live and re-snapshots.
  `ApiEvents` invalidates `[...qk.entries, 'count']` and `qk.props` on `stream:batch`, so the banner updates
  while the pages (keyed by snapshot) stay stable. `useEntryPages` is an `useInfiniteQuery` of 200-row pages
  (`offset` page param) with `keepPreviousData`; the virtualizer renders a loader row past the end that triggers
  `fetchNextPage`.
- `LogTable`: TanStack Table (`manualSorting`, `manualPagination`, `columnResizeMode: 'onChange'`) rendered as
  CSS grid rows (`gridTemplateColumns` from column sizes, fixed 28 px rows) inside a TanStack Virtual list
  (`overscan 15`, `initialRect`). Header buttons sort (`aria-sort`), a right-edge handle resizes
  (double-click resets), rows get a level tint (`rowTintClass`). Column ids: fixed (`timestamp`, `level`, `app`,
  `source_type`, `instance`, `stream`, `session`, `message`) and `p:<key>` for props from `props:list`
  (`sortKeyOf` strips the prefix for `EntryQuery.sort`).
- `useColumnLayout`: `{order, sizes}` per workspace in kv key `layout.columns` (read once per workspace,
  written debounced 400 ms; `ColumnPicker` toggles/reorders with arrow buttons, "Reset" restores
  `DEFAULT_LAYOUT`). Pinning and drag-and-drop reordering were deferred (plan lists dnd-kit; add in M14 if
  wanted).
- jsdom: TanStack Virtual measures the scroll element with `offsetWidth/offsetHeight`, which are 0 in jsdom.
  `test/setup-dom.ts` returns 1200x600 for elements carrying `data-virtual-scroll`; mark any virtualized scroll
  container with that attribute. The scroll container also must not call `scrollTo` (jsdom lacks it); set
  `scrollTop` instead.
- Vite: `optimizeDeps.include` lists all renderer deps so the dev server never re-optimises mid-session
  (that produced "Invalid hook call" from two React copies once M8 pulled in TanStack Table/Virtual).

## M9 query bar: how it works (done)

- `QueryEditor` mounts one `EditorView` (state, view, autocomplete, lint, commands packages; no Lezer
  grammar). Extensions: `singleLine` (transaction filter flattening newlines), `history`, `dqlHighlight`
  (ViewPlugin marking tokens from `classifyTokens`: field/operator/keyword/value/quoted/paren/term/error,
  classes `.cm-dql-*` styled in `dqlTheme` via CSS variables), `dqlLint` (`parse()` error -> one diagnostic),
  `dqlAutocompletion` (source built on `completionContextAt`: fields insert `name:`, values come from
  `entries:values` with prefix and are quoted when needed, `*` for exists, `and/or/not` after a clause; no popup
  on plain whitespace unless Ctrl+Space), keymap (completionKeymap first, then Enter -> onSubmit, Escape ->
  onCancel, Mod-Space -> startCompletion, history + default keymaps), `contentAttributes` `aria-label="Query"`.
  External `value` changes are pushed into the view; edits flow out through `onChange`.
- `QueryBar` owns the draft, validates with `dqlDiagnostics` (shared parser, no IPC round trip), commits via
  `useQueryStore.setDql`, records applied queries in kv `query.history` (max 50, most recent first, deduped),
  and hosts two toggle panels: history (pick re-applies) and saved filters (save current dql + time filter
  under a name, apply sets dql and time, delete with inline confirm). `Escape` first closes an open completion
  popup (CodeMirror), the second press reverts the draft.
- Saved filters live per workspace in `saved_filters`; `saveFilter` upserts by id or case-insensitive name and
  clears the time filter when saving without one.
- Tests drive the editor through `src/renderer/src/test/codemirror.ts` (`setQueryText`, `pressInQuery`) since
  `userEvent.type` on contenteditable is unreliable; `test/setup-dom.ts` polyfills `Range#getClientRects` /
  `getBoundingClientRect` and `Element#getClientRects` for CodeMirror's measurements.

## M10 time filter + auto refresh + tail: how it works (done)

- `TimeFilterControl` (in the query bar row) shows `describeTimeFilter(time, tz)` on a chip and opens a panel
  with quick picks (`QUICK_PICKS`: 5 min .. 7 d as relative filters), a custom relative form (integer amount +
  unit), an absolute form (`datetime-local` inputs interpreted in the current `tz` via `dateTimeInputToMs`,
  start must precede end, either side optional) and "All time". Writes `useQueryStore.time`; main resolves
  relative windows against `Date.now()` on every query.
- Auto refresh: `refreshIntervalMs` (persisted; `REFRESH_INTERVALS_MS`, 0 = off) drives a `setInterval` in
  `LogTable` that calls `snapshot.refresh()` when `newCount > 0` or the time filter is relative (sliding window).
- Tail: `tail` (persisted) applies `snapshot.refresh()` whenever `newCount > 0` unless paused; paused while
  `scrollTop > 4`, the pointer is over the rows, or a column is being resized (`columnSizingInfo`). A badge
  shows `Live` / `Tail paused`. Refresh now also invalidates the in-snapshot count and pages for the scope, so
  unchanged snapshot ids still re-run the rows (needed for relative windows and cleared sessions).
- Tests use short real intervals (store set to 60 ms) rather than fake timers because TanStack Query and RTL
  `waitFor` do not mix well with `vi.useFakeTimers`.

## M11 detail + interaction: how it works (done)

- Selection lives in `useSelectionStore` as `{ids, anchor, focus}` by entry id (stable while tailing; rows
  that scroll out of the page simply lose their highlight). `selectByClick` (plain / Ctrl toggle / Shift range
  from the anchor / Ctrl+Shift adds a range) and `moveSelection` (arrows, PageUp/Down = 20 rows, Home/End,
  Shift extends) are pure and unit-tested. The scroll container is focusable (`tabIndex 0`) and handles keys;
  after a keyboard move the focused row is scrolled into view with `virtualizer.scrollToIndex`. Ctrl+A selects
  the loaded rows, Escape clears, Ctrl+C fetches `entries:get` for up to 500 selected ids (batches of 20) and
  copies NDJSON. Setting a focus opens the detail panel; closing it keeps the selection.
- `RowDetailPanel` (bottom of `LogView`, height in kv `layout.detail`, drag handle) loads the focused entry
  via `entries:get` and shows a header (timestamp, app tag, level, source/instance/stream/id), tabs message
  (highlighted, whitespace preserved) / json (`JsonTree`) / raw, copy raw / copy JSON, and a fields sidebar
  (`FIXED_ROWS`) with filter for/out actions. `JsonTree` expands two levels by default; array elements keep
  the parent path because DQL matches any element; leaves offer filter for/out/copy when
  `isFilterableField(path)` and the value is a scalar.
- Filters append `field:value` / `not field:value` with an explicit `and` via `appendClause` (values quoted
  by `quoteDqlValue`, result re-parsed defensively) and commit through `useQueryStore.setDql`.
- Highlighting: `buildHighlightTerms(dql)` turns positive free-text / message literals into case-insensitive
  regexes (wildcards -> lazy gaps); the table passes them through `table.options.meta.highlightTerms` to the
  message cell, which also shows only the first line plus a `⏎ N` marker for multi-line messages.
- Mock fixture note: `makeMockEntries` makes ids with `(id-1) % 3 === 2` plain text (3, 6, 9, ...), levels cycle
  INFO, INFO, DEBUG, WARN, ERROR, null; tenants t1/t2/t3. Tests that click rows must pick ids accordingly.
  `userEvent.setup()` installs its own clipboard stub; re-define `navigator.clipboard` after it when spying.

## M12 export + sessions: how it works (done)

- `src/main/db/export.ts`: `ExportJob` streams rows to a file in NDJSON / JSON array / CSV (RFC 4180 quoting via
  `csvEscape`/`csvHeader`/`csvLine`). Rows come from `queryPages()` (filtered scope, pins the snapshot id from
  the first page so later pages don't shift) or `idPages()` (explicit `ids`, e.g. "export selected rows", which
  ignores `sessionIds`/`dql`/`time` when present). `columnValue`/`toRecord` map fixed columns (including
  `timestamp` as ISO via `isoOf`) and `p:<key>` props into the record shape per format. Cancelling deletes the
  partial file; progress is reported via a callback (`written`/`total`).
- `src/main/db/export-manager.ts` (`ExportManager`, held on `AppContext.exports`): runs `ExportJob`s by uuid job
  id, tracks running jobs, exposes `cancel(jobId)`, and forwards `onProgress`/`onDone`/`onFailed` callbacks that
  `index.ts` wires to `pushEvent('export:progress'|'export:done'|'export:failed', ...)`.
- IPC (`src/main/ipc/export.handlers.ts`, schemas in `ipc/schemas.ts`): `export:run` opens
  `dialog.showSaveDialog` with a suggested name/extension (`EXPORT_EXTENSIONS`), then starts the job and returns
  `{jobId}` (or a cancelled-dialog result); `export:cancel {jobId}`; `export:reveal {path}` calls
  `shell.showItemInFolder`. Shared types in `src/shared/model/export.ts`: `ExportFormat`, `ExportScope` (extends
  `EntryCountQuery` + `sort?` + `ids?`), `ExportRequest`, `EXPORT_FIXED_COLUMNS`.
- `src/main/db/settings.ts`: `readRetention(db)` reads the `retention` kv key (zod-validated, clamped to
  1000..50M rows/session and 1000..200M rows/workspace), falling back to `DEFAULT_RETENTION`; `Writer` reads it
  via a `retention()` getter on every flush so changes apply without a restart.
- `src/main/db/repos/sessions.ts`: `sessionRange(db, id)` returns `{minTsNs, maxTsNs, count}` (or `null` if the
  session has no rows; throws on an unknown session id) for "set time range to session".
- Renderer: `features/export/ExportDialog.tsx` — format (ndjson/json/csv), scope (all filtered / selected rows
  / currently loaded rows, with counts), columns (visible layout vs. all fixed+props), then a progress bar
  fed by `export:progress`/`export:done`/`export:failed`, with cancel and "Reveal in folder". Opened from an
  export button in `LogTable`'s toolbar with the current query scope + snapshot, selection and loaded ids.
- `features/sessions/SessionsPanel.tsx`: click scopes the query to one session, Ctrl+click adds/removes
  (`useQueryStore.sessionIds`), a "show all" clears it; a calendar button calls `session:range` and sets an
  absolute time filter to the session's span. `QueryBar`'s `SessionScopeChip` shows the active scope and clears
  it.
- `features/workspaces/WorkspaceDialog.tsx` gained a retention settings form (max rows per session/workspace,
  validated session ≤ workspace ≥ 1000) persisted to kv `retention`.
- Mock (`api/mock/mock-api.ts`) implements `export:run/cancel/reveal` and `session:range` with seedable
  `exportSavePath`/`cancelledExports` state and emits the same push events as main.

## M13 packaging + CI: how it works (done)

- `.github/workflows/ci.yml`: `lint-typecheck` job (ubuntu-latest only) runs install/lint/typecheck once;
  `test-build` job (matrix ubuntu/windows/macos, `needs: lint-typecheck`) runs install/test/build on all three
  OS (native `better-sqlite3` rebuild differs per OS via `postinstall`). No packaging step in CI — packaging is
  only exercised at release time to keep CI fast.
- `.github/workflows/release.yml` follows electron-builder's recommended GitHub Releases flow (rebuilt
  2026-09-14): the user drafts a release in GitHub with tag `v<package.json version>` (e.g. `v0.2.0`), then
  every push to `main` (or `workflow_dispatch`) rebuilds the installers on ubuntu/windows/macos and
  `electron-builder --publish always` replaces the assets on that draft. Publishing the draft in GitHub tags
  the latest commit. A `check-draft` job runs first and fails with a clear error when no draft for the
  package version exists, because electron-builder's "find draft or create it" is not atomic and three
  parallel runners raced into duplicate drafts on the first tag push. Consequence: bump `version` in
  `package.json` and create the next draft before pushing work meant for a new release. Concurrency group
  `release-<ref>` cancels superseded runs.
- `electron-builder.yml` gained a `publish` block (`provider: github`, `owner: DevEpos`,
  `repo: cf-logs-inspector`, `releaseType: draft`); existing `win`/`mac`/`linux` target lists were untouched.
- `package.json` gained `"packageManager": "pnpm@10.6.5"` so corepack pins the same pnpm version locally and
  in CI; both workflows use `pnpm/action-setup` (no version input needed) + `actions/setup-node` with
  `cache: pnpm`.
- Actions are pinned to their latest majors (checked 2026-09-11): `actions/checkout@v7`,
  `actions/setup-node@v7`, `pnpm/action-setup@v6`.
- Out of scope for this pass: code signing (unsigned win/mac builds), auto-update.
- Verified 2026-09-14: per-OS artifacts land in a draft release via `release.yml`. The rebuilt
  draft-first workflow has not yet been exercised end to end (draft `v0.2.0` must exist, then push to main).

## Next milestone: M14+

Not started; see `docs/DEVELOPMENT_PLAN.md` for later milestones (real-foundation verification, auto-update,
etc.) before picking the next scope of work.

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
