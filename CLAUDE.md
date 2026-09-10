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
| M2 auth + CF client | **next** |
| M3 Log Cache streaming, M4 storage, M5 query engine, M6+ UI | not started |

The Electron window has not yet been launched by anyone; only `pnpm build` was verified. First thing to do on
a machine with a display: `pnpm dev` and confirm the placeholder window shows the app version via IPC.

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
src/main/index.ts             window creation, CSP header injection, navigation lockdown
src/main/ipc/register.ts      `handle(channel, fn)` wrapper -> IpcResult {ok,value}|{ok,error}; only app:version + entries:validateDql so far
src/preload/index.ts          exposes window.api = { invoke(channel, req), on(event, cb) } with allowlists
src/shared/ipc/contracts.ts   IpcContracts, INVOKE_CHANNELS, PushEvents, PUSH_EVENTS (add channels here first)
src/shared/dql/               ast, errors, tokenizer, parser, evaluator, wildcard, cursor, stringify, index + __tests__
src/renderer/src/App.tsx      placeholder UI
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
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` when Claude wrote the change.
- Formatting: prettier, single quotes, width 100, trailing commas.

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

## Next milestone: M2 auth + CF client (see plan section "CF client")

Files to create under `src/main/cf/`: `discovery.ts`, `http.ts` (undici Agent per connection with
`rejectUnauthorized`/custom CA, error mapping), `uaa.ts` (`TokenManager`: getAccessToken with single in-flight
refresh, loginPassword, loginPasscode, refresh, logout; tokens via `safeStorage`), `passcode-window.ts`
(sandboxed modal BrowserWindow on partition `persist:uaa-<connId>`, best-effort code scraping + manual paste),
`cc-client.ts` (orgs/spaces/apps with `pagination.next`), `errors.ts`. Plus `src/main/store/connections.ts`
for connection profiles and IPC channels `connection:*`, `auth:*`, `cf:*`. Test against a `node:http` mock of
UAA + CC in `test/fixtures/`.

## Platform notes

- Native module: `better-sqlite3` is rebuilt for Electron by `postinstall` (`electron-builder install-app-deps`).
  Never share one `node_modules` between WSL and Windows; each OS needs its own install.
- Windows: use a native Windows clone (not a path under `\\wsl$`), Node 22 + pnpm installed on Windows.
  Line endings: if git normalises to CRLF, prettier may complain; set `git config core.autocrlf false` for this repo or add `.gitattributes` with `* text=auto eol=lf`.
- WSL: WSLg is available (DISPLAY=:0), so `pnpm dev` opens a window. If Chromium sandbox errors appear use
  `ELECTRON_DISABLE_SANDBOX=1 pnpm dev`; GPU glitches: `pnpm dev -- --disable-gpu`.
- The `.npmrc` uses `node-linker=hoisted` so electron-builder can resolve native deps.

## Open questions for the user

- Confirm implicit DQL operator `and` (vs. DQL default `or`).
- Confirm Windows-first vs. Linux-first manual testing priority for packaged builds.
