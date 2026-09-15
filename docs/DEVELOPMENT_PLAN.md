# cf-log-inspector – Development Plan

## Context

Cloud Foundry developers today inspect app logs with `cf logs <app> [--recent]` in a terminal: one app per process, one global CF target, no structured filtering, no history. The existing helper tools in this workspace each solve one slice:

- `cflogs` (cf-log-util): dependency-free filter expression parser + CSV/JSON writers, but shells out to `cf` and drops the log envelope.
- `log-viewer`: React prototype with virtualized table, SQLite JSON storage, streaming CSV export; depends on the `cf log-stream` plugin, no tests.
- `btpcflogin` / `cf-sso-login`: cover password, custom-IdP and SSO-passcode login, but only by driving the cf CLI or a headless browser.

Goal: one cross-platform desktop app (Linux/Windows/macOS) that logs in to CF spaces natively, streams logs from many apps concurrently, stores them in switchable SQLite workspaces, and offers a powerful filterable/configurable log table with DQL-style queries, time filters, auto-refresh and JSON/CSV export.

## Decisions (confirmed with user)

| Topic          | Decision                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| Shell          | Electron + TypeScript (electron-vite, electron-builder), pnpm, Node 22                                          |
| CF access      | Direct HTTP: UAA `/oauth/token`, CF v3 API, Log Cache `/api/v1/read/<guid>` (no cf CLI dependency)              |
| UI             | React 19 + TanStack Table v8 + TanStack Virtual; Tailwind 4 + shadcn/ui (Radix); CodeMirror 6 for the query bar |
| Persistence    | Multiple named SQLite workspace files (better-sqlite3, WAL); one open at a time                                 |
| Credentials    | Refresh tokens encrypted with Electron `safeStorage`; passwords never stored                                    |
| Query language | DQL subset (OpenSearch Dashboards Query Language) parsed in shared code, compiled to SQL in main                |

Assumptions made (flag if wrong): adjacent DQL clauses without operator combine with **and** (DQL itself defaults to or; `and` is what log filtering users expect, exposed as a constant). Only top-level JSON payload keys become dynamic properties; nested values remain queryable via dotted paths.

## Verified external facts

- **Log Cache read**: `GET {log_cache}/api/v1/read/<source-id>?start_time=<ns,inclusive>&end_time=<ns,exclusive>&envelope_types=LOG&limit=1000(max)&descending=true|false`, bearer token required. Response `{envelopes:{batch:[{timestamp:"<ns string>", source_id, instance_id, tags:{app_name, source_type, ...}, log:{payload:"<base64>", type:"OUT"|"ERR"}}]}}`. `GET /api/v1/meta` lists sources. This is what cf CLI v7+ uses for `cf logs`; `--recent` = one descending read with limit 1000.
- **UAA**: `POST {login}/oauth/token`, `Authorization: Basic Y2Y6` (client `cf`, empty secret). Grants: `grant_type=password&username&password[&login_hint={"origin":"<key>"}]` (custom IdP), `grant_type=password&passcode=<code>` (code from `{login}/passcode`), `grant_type=refresh_token&refresh_token=`. Response `access_token, refresh_token, expires_in, token_type`.
- **Discovery**: `GET {api}/` returns `links.{uaa,login,log_cache,cloud_controller_v3}.href`.
- **DQL 2.19**: terms, `"phrases"`, `field:value`, `field:*`, `*` wildcards in terms and field names (not in phrases), ranges `> >= < <=`, `and/or/not` (not > and > or), parentheses, `field:(a or b)`, dotted object fields, escaping of `\ ( ) : < > " *` with backslash.

## Reuse from prior art

| Asset                                                                                          | Path                                                                               | Use                                                                                                          |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Filter parser style (tokenizer → recursive descent → evaluator)                                | `../cflogs/src/lib/filter.js`                                                      | Template for `src/shared/dql`                                                                                |
| CSV/JSON writers                                                                               | `../cflogs/src/lib/output.js`                                                      | Port into `src/main/db/export.ts`                                                                            |
| JSON1 SQL generation, LIKE escaping, allowlisted sort                                          | `../log-viewer/server.js:186-284, 320-334`                                         | Basis for `query-compiler.ts`                                                                                |
| Streaming CSV over cursor                                                                      | `../log-viewer/server.js:357-430`                                                  | Export implementation                                                                                        |
| Viewer UX (virtualized table, column menu, detail popover, cell renderers, new-entries banner) | `../log-viewer/src/App.jsx`                                                        | UX blueprint, reimplemented on TanStack                                                                      |
| SAP BTP region catalogue                                                                       | `~/.nvm/versions/node/v24.14.0/lib/node_modules/btpcflogin/data/regions-data.json` | Copy to `src/shared/regions.ts` (host `api.cf.<region>.hana.ondemand.com`, `cn40` → `.platform.sapcloud.cn`) |
| Login mode semantics (password / `--origin` / `--sso-passcode`)                                | btpcflogin `CloudFoundryCli`, cf-sso-login `passcode.ts`                           | Spec for auth service and passcode window (selectors: `login_hint` origin-chooser, passcode page text)       |

## Architecture

```
renderer (React)  ──typed IPC (contextBridge, zod-validated)──►  main (Node)
  query bar / table / panels                                       cf/  discovery, uaa TokenManager, cc-client, log-cache, poller
  TanStack Query cache                                             ingest/ parser → writer (batched tx) → stream-manager
  zustand UI state                                                 db/  workspace-manager, schema, repos, query-compiler, export
        ▲  push events: stream:batch, stream:status, auth:required, export:progress
src/shared: dql (AST+parser+evaluator), ipc contracts, model types, regions   — no node/dom imports
```

### Repository layout

```
cf-log-inspector/
  package.json  electron.vite.config.ts  electron-builder.yml  tsconfig.{json,node,web}.json  components.json
  src/shared/
    dql/{tokenizer,parser,ast,evaluator,wildcard,cursor,stringify,errors}.ts + __tests__/
    ipc/{contracts,events}.ts        model/{log-entry,time-filter,columns,levels}.ts   regions.ts
  src/main/
    index.ts  log.ts  ipc/register.ts  ipc/*.handlers.ts
    cf/{discovery,http,uaa,passcode-window,cc-client,log-cache,poller,errors}.ts
    ingest/{parser,writer,stream-manager}.ts
    db/{workspace-manager,schema,query-compiler,export}.ts  db/repos/*.ts
    store/{app-config,connections}.ts
  src/preload/index.ts
  src/renderer/src/
    app/ (AppShell, TitleBar, StatusBar, SidePanel, Providers, theme)
    api/ (client.ts, useApiEvent.ts, mock/)   queries/   store/
    features/{query-bar,time-filter,log-table,auto-refresh,streams,connections,workspaces,export,sessions,settings}/
    components/ui (shadcn)  lib/  styles/globals.css
  test/ (vitest setup, log-cache-mock server)   e2e/ (playwright)
```

Key libs: electron ^38, electron-vite ^4, electron-builder ^26, better-sqlite3 ^12, @electron/rebuild, undici ^7, zod, electron-log, react 19, @tanstack/react-table 8, @tanstack/react-virtual 3, @tanstack/react-query 5, zustand 5, @dnd-kit, @codemirror/* 6, tailwindcss 4, shadcn/ui, react-hook-form, date-fns 4, vitest 3, @testing-library/react, playwright.

### Data model

Parsed entry (from Log Cache envelope): `tsNs` (BigInt, serialised as string over IPC), `appGuid`, `appName`, `sourceType` (APP/PROC/WEB, RTR, CELL, STG, ...), `instance`, `stream` OUT|ERR, `message` (JSON `msg|message|text` or raw), `level` (normalised from `level|severity|lvl`), `isJson`, `raw`, `props` (top-level JSON keys), `dedupeKey` = `ts:app:instance:stream:hash(raw)`.

### SQLite schema (per workspace file, `<userData>/workspaces/<slug>-<id>.sqlite`)

```sql
CREATE TABLE log_sessions (id INTEGER PRIMARY KEY, name TEXT NOT NULL, connection_id TEXT NOT NULL,
  org_guid TEXT, org_name TEXT, space_guid TEXT, space_name TEXT, app_guid TEXT NOT NULL, app_name TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_ts_ns TEXT, status TEXT NOT NULL DEFAULT 'stopped', entry_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE log_entries (id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES log_sessions(id) ON DELETE CASCADE,
  ts_ns INTEGER NOT NULL, app_guid TEXT NOT NULL, app_name TEXT NOT NULL, source_type TEXT NOT NULL, instance INTEGER,
  stream TEXT NOT NULL, level TEXT, message TEXT NOT NULL, is_json INTEGER NOT NULL DEFAULT 0, raw TEXT NOT NULL,
  props TEXT, dedupe_key TEXT NOT NULL);
CREATE UNIQUE INDEX ux_entries_dedupe ON log_entries(session_id, dedupe_key);
CREATE INDEX ix_entries_session_ts ON log_entries(session_id, ts_ns, id);
CREATE INDEX ix_entries_ts ON log_entries(ts_ns, id);
CREATE INDEX ix_entries_session_level ON log_entries(session_id, level);
CREATE TABLE session_props (session_id INTEGER REFERENCES log_sessions(id) ON DELETE CASCADE, key TEXT, type TEXT, count INTEGER, sample TEXT, PRIMARY KEY(session_id,key));
CREATE TABLE saved_filters (id INTEGER PRIMARY KEY, name TEXT UNIQUE, dql TEXT, time_filter TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE column_layouts (id INTEGER PRIMARY KEY, name TEXT UNIQUE, columns TEXT, sort TEXT, is_default INTEGER DEFAULT 0, updated_at INTEGER);
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT);   -- query history, last query, retention, ui prefs per workspace
```

Pragmas: WAL, `synchronous=NORMAL`, `user_version` migrations. Dynamic fields via `json_extract(props, ?)` with bound path. Optional later: promoted generated columns + index for hot props. Retention: `max_rows_per_session` (500k) / `max_rows_workspace` (2M), prune after batches.

### CF client

- `discovery.ts`: root links cached per connection; fallback `log-cache.` host.
- `http.ts`: undici Agent per connection (`rejectUnauthorized`, custom CA), error mapping to `AuthError/ForbiddenError/NotFoundError/RateLimitError/ServerError/NetworkError/TlsError`.
- `uaa.ts TokenManager`: `getAccessToken()` (refresh 60 s before expiry, single in-flight promise), `loginPassword(user, pw, origin?)`, `loginPasscode(code)`, `refresh()`, `logout()`. Tokens → `safeStorage.encryptString` → `connections.json`; memory-only if encryption unavailable. Refresh failure → `auth:required` event, pollers pause.
- `passcode-window.ts`: modal `BrowserWindow` (sandboxed, partition `persist:uaa-<connId>` so IdP cookies persist) loading `{login}/passcode`; polls `document.body.innerText` for the code (best effort), manual paste fallback always available.
- `cc-client.ts`: orgs, spaces, apps with `pagination.next` following, one 401 retry after forced refresh.
- `log-cache.ts` + `poller.ts`: `--recent` = descending read limit 1000, reversed; live = walk forward from cursor, immediate re-read when a page is full (1000), else wait poll interval (default 1 s, configurable); 2 s overlap window with `INSERT OR IGNORE` dedupe; exponential backoff 1→30 s on 5xx/network, honour Retry-After; `AbortController` stop.

### Ingest pipeline

Poller → parser → Writer (per workspace): flush every 250 ms or 500 entries in one transaction (insert entries, upsert `session_props`, update counts); backpressure when queue > 20k; after commit emit `stream:batch {sessionId, inserted, totalCount, latestId}` (counts only; renderer re-queries). StreamManager keeps `Map<sessionId, {poller, status}>`, stops all on workspace switch, resumes from `last_ts_ns` on request.

### IPC contract (`src/shared/ipc/contracts.ts`)

Invoke channels (zod-validated in main, errors serialised `{code,message,details}`):
`workspace:{list,create,open,openFile,delete,current,stats,kvGet,kvSet}` · `connection:{list,save,delete,test}` · `auth:{loginPassword,startPasscode,passcodeLogin,logout,status}` · `cf:{orgs,spaces,apps}` · `session:{list,create,start,stop,setInterval,clear,delete}` · `entries:{query,count,get,validateDql,values}` · `props:list` · `filters:{list,save,delete}` · `layouts:{list,save,delete}` · `export:{run,cancel}` · `settings:{get,set}`.

Push events: `stream:batch`, `stream:status`, `auth:required`, `workspace:changed`, `export:progress`, `export:done`, `theme:changed`.

```ts
interface EntryQuery {
  sessionIds?: number[]; // scope; omitted = whole workspace
  dql?: string; // parsed + compiled in main
  time?: TimeFilter; // {kind:'relative',amount,unit:'m'|'h'|'d'} | {kind:'absolute',fromMs?,toMs?}; relative resolved in main
  sort: { key: string; dir: 'asc' | 'desc' }[]; // default ts_ns desc, id desc
  snapshotId?: number; // rows with id > snapshotId excluded → stable paging while streaming
  paging: { limit: number; offset: number };
}
// entries:count → {total, maxId}; "new entries" = count with id > snapshotId
```

Paging model: renderer takes a snapshot (`maxId`) when it (re)loads; pages use offset within that snapshot; refresh/tail advances the snapshot. Keyset paging is an optimisation for the default sort only.

### DQL package (`src/shared/dql`)

AST (shared by parser, evaluator and SQL compiler):

```ts
type DqlNode =
  | { type: 'match_all' }
  | { type: 'and'; children: DqlNode[] }
  | { type: 'or'; children: DqlNode[] }
  | { type: 'not'; child: DqlNode }
  | { type: 'term'; value: Literal } // free text → message/raw LIKE
  | { type: 'match'; field: FieldRef; value: Literal } // field:value, field:"phrase"
  | { type: 'exists'; field: FieldRef } // field:*
  | { type: 'range'; field: FieldRef; op: '>' | '>=' | '<' | '<='; value: Literal };
interface FieldRef {
  name: string;
  path: string[];
  hasWildcard: boolean;
  span?: Span;
}
interface Literal {
  raw: string;
  quoted: boolean;
  hasWildcard: boolean;
  span?: Span;
}
```

- Tokenizer never throws (error-tolerant for highlighting); parser is recursive descent; `field:(a or b)` is desugared into `or/and/not` over `match` nodes; errors carry positions and specific messages.
- Semantics: `field:value` case-insensitive exact on keyword fields, substring on text fields (`message`, `stacktrace`); phrases verbatim; `*` → LIKE/regex; ranges numeric when both sides numeric, ISO date on `timestamp`, else lexicographic.
- `wildcard.ts` provides `globToRegExp` and `globToLike` with a shared truth-table test so in-memory and SQL results agree.
- `cursor.ts` gives completion context (field / value / operator) from tokens for autocomplete. `stringify.ts` for canonical saved filters.
- SQL compilation (`query-compiler.ts`): fixed-field allowlist (`ts|timestamp→ts_ns`, `app→app_name`, `source_type`, `instance`, `stream`, `level`, `message`, `session`); dynamic names must match `/^[A-Za-z_@][\w\-]*(\.[A-Za-z_@][\w\-]*)*$/` and compile to `json_extract(props, ?)` with a bound `$.path`; `LIKE ? ESCAPE '\'`; numeric compare via `CAST(... AS REAL)` guarded by `json_type`; `exists` → `IS NOT NULL` / `json_type(...) IS NOT NULL`; base predicate `session_id IN (...) AND ts_ns BETWEEN ? AND ?` first so the index drives; sort keys allowlisted, `id` tiebreaker; prepared-statement LRU.

### Renderer

Layout: TitleBar (workspace switcher, stream count, refresh interval, theme, settings) · SidePanel tabs Streams / Sessions / Connections · Main: QueryBar + time filter + chips, NewEntriesBanner, LogTable, resizable RowDetailPanel · StatusBar (row counts, selection, sort, tail state, timezone).

- **Query bar**: CodeMirror single-line editor, token-based highlighting, lint squiggles from `parse()`, autocomplete for fields (from `props:list`), values (`entries:values`, debounced), operators; history (50/workspace) and saved filters.
- **Time filter**: quick picks (5m…7d), relative N m/h/d, absolute between with date-time pickers, Local/UTC toggle; relative = live range end.
- **Log table**: TanStack Table `manualSorting/manualPagination`, column order/visibility/size/pinning persisted per workspace, dnd-kit header reorder, CSS-variable column widths; TanStack Virtual with fixed row height (measure only expanded rows); pages of 200 loaded via TanStack Query keyed by `(query hash, snapshotId, page)`; cell renderers Timestamp/AppTag/Level/Message (term highlight)/JsonValue/Stacktrace; level row tint; detail panel with JSON tree, copy, "filter for value"; keyboard nav, multi-select, Ctrl+C as NDJSON; tail mode with pause on interaction.
- **Auto refresh**: Off/1/2/5/10/30 s; tailing advances snapshot and scrolls; otherwise updates "N new entries" banner (also from `stream:batch`); paused during drag/resize/dialogs.
- **Streams panel**: connection → org → space → app multi-select with search, `--recent` toggle, start/stop, per-stream status badge and colour tag (deterministic per app name).
- **Connections**: list + form (BTP region picker or custom API URL, skip-SSL/CA, auth mode password / password+origin / SSO passcode), login dialog state machine, `auth:required` toast with re-login.
- **Workspaces**: switcher, create/open file/delete (typed confirm), path + size, retention settings.
- **Export**: JSON (NDJSON/array) or CSV; scope all-filtered / selected / loaded; columns visible/all; progress + cancel + reveal.
- **Sessions**: browse previous sessions, click to scope query + absolute time range.
- State: TanStack Query for IPC data (push events → `invalidateQueries`), zustand for UI state with IPC-backed persistence (global prefs in `<userData>/config.json`, per-workspace in `kv`).

### Security

`contextIsolation`, `sandbox`, no `nodeIntegration`; preload exposes allowlisted channels only; CSP `connect-src 'none'` for renderer (never talks to CF directly); passcode window in own partition with navigation limited to https; `certificate-error` accepted only for connections with skip-SSL; log redaction of `Authorization`/`password`/`passcode`.

### Packaging & CI

electron-builder: `nsis` (win x64), `dmg`+`zip` (mac x64/arm64), `AppImage`+`deb` (linux); `postinstall: electron-builder install-app-deps` rebuilds better-sqlite3; `asarUnpack: ["**/*.node"]`. GitHub Actions `ci.yml` matrix ubuntu/windows/macos × Node 22: install, lint, typecheck, test, build; `release.yml` on tag publishes per OS. Pin electron and better-sqlite3 versions together.

## Milestones (single developer, ~65 working days)

| #   | Milestone                               | Deliverable                                                                                                                                                                            | Days |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| M0  | Scaffold                                | electron-vite + React + TS strict, Tailwind/shadcn, eslint/prettier, vitest/RTL/Playwright wiring, preload bridge, zod contracts, electron-log, CSP, mock IPC backend for renderer dev | 3    |
| M1  | DQL package                             | tokenizer, parser, AST, evaluator, wildcard, cursor, stringify, table-driven tests (unblocks compiler and query bar)                                                                   | 4    |
| M2  | Auth + CF client                        | discovery, undici http w/ TLS options, TokenManager (password, origin, refresh, safeStorage), passcode window + manual paste, CC v3 orgs/spaces/apps; mock UAA/CC tests                | 5    |
| M3  | Log Cache streaming                     | log-cache client, poller (recent, walk, dedupe, backoff, abort) with mock server tests                                                                                                 | 3    |
| M4  | Storage                                 | workspace manager, schema/migrations, writer pipeline, sessions lifecycle, `stream:batch`, retention                                                                                   | 3    |
| M5  | Query engine                            | AST→SQL compiler, `entries:query/count/values`, props discovery, time filters, snapshot paging; heavy tests incl. SQL vs evaluator equivalence                                         | 4    |
| M6  | App shell + workspaces + connections UI | AppShell, theme, zustand persistence, workspace switcher/manage, connections dialog, login flows, auth guard                                                                           | 5    |
| M7  | Streams panel                           | cascading pickers, multi-select, start/stop, status, colours; **first end-to-end integration checkpoint**                                                                              | 3    |
| M8  | Log table core                          | snapshot paging via TanStack Query + Virtual, fixed + dynamic columns, column picker, sort/reorder/resize/pin, persistence, level tint                                                 | 7    |
| M9  | Query bar                               | CodeMirror editor, highlight, lint, autocomplete, history, saved filters                                                                                                               | 5    |
| M10 | Time + refresh + tail                   | time filter popover, live mode, auto refresh, new-entries banner, tail with interaction pause                                                                                          | 4    |
| M11 | Detail + interaction                    | detail panel/JSON view, rich cells, selection, keyboard nav, copy / filter-for-value                                                                                                   | 4    |
| M12 | Export + sessions                       | streamed JSON/CSV export with progress/cancel, sessions panel + scope chip, retention settings UI                                                                                      | 4    |
| M13 | Packaging + CI                          | three-OS builds, native rebuild, release workflow, auto-update optional                                                                                                                | 3    |
| M14 | Hardening                               | perf on 1M rows (EXPLAIN QUERY PLAN, promoted columns if needed), a11y pass, Playwright smoke, token-expiry edge cases, docs                                                           | 8    |

Order rationale: auth and Log Cache streaming are the highest-risk unknowns (IdP page variance, Log Cache ordering), so they come right after the shared DQL package; UI work from M6 on runs against the mock backend and integrates at M7 and M10.

## Verification

- **Unit**: `pnpm test` runs vitest for `shared/dql` (parser goldens, evaluator, glob truth table), `query-compiler` (SQL snapshots + execution on in-memory SQLite fixtures), envelope parser fixtures (JSON app log, RTR, STG, ERR), poller against the Log Cache mock server (full 1000 pages, duplicates, out-of-order, 401→refresh, 500 backoff with fake timers), writer + retention on temp DB files.
- **Components**: RTL tests with `window.api` mock (mini backend using the DQL evaluator): query bar typing/lint/complete/submit, time filter, table column persistence and keyboard nav, streams start with recent flag, connection form validation, export dialog scopes.
- **E2E**: Playwright `_electron` smoke with `E2E_MOCK_CF=1`: create workspace, add connection + login, start two streams, rows appear, filter `level:ERROR`, open detail, toggle column, export CSV and assert file, switch theme.
- **Manual against a real SAP BTP space**: password login, custom-IdP origin login, SSO passcode via embedded window, `--recent` backfill then live tail for 2+ apps across two connections, workspace switch mid-stream, token expiry re-login, export of a filtered range, packaged builds installed on Windows, macOS and Linux (deb + AppImage).
