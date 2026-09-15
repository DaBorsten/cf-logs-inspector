# cf-log-inspector – VS Code Extension Development Plan

## Context

`cf-log-inspector` today is an Electron desktop app (see `docs/DEVELOPMENT_PLAN.md` and `CLAUDE.md` for
the full history and status). This document plans a second front-end for the same product: a VS Code
extension with **full feature parity**, sharing the core (CF/UAA/Log Cache client, SQLite storage, DQL
query engine) with the Electron app in the same repository ("shared core" approach) rather than a
separate rewrite.

Goal: a developer working in VS Code can log in to a Cloud Foundry space, stream logs from many apps,
store them in switchable SQLite workspaces, and use the same filterable/configurable log table with
DQL queries, time filters, auto-refresh and JSON/CSV export — without leaving the editor.

## Decisions (confirmed with user, 2026-09-11)

| Topic                | Decision                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code sharing         | Shared core in this repo: `src/shared/**`, `src/main/cf/**`, `src/main/db/**`, `src/main/ingest/**`, and most of `src/renderer/**` are reused by both the Electron app and the extension. Only host-integration adapters differ.                                                                                                                                                               |
| Feature scope        | Full parity with the desktop app (streaming, query bar, log table, time filter/auto-refresh/tail, detail panel, export, sessions, workspaces) — not a reduced MVP.                                                                                                                                                                                                                             |
| SSO / passcode login | No embedded login browser in VS Code (webviews cannot host an arbitrary navigable browser session the way an Electron `BrowserWindow` can). Use `vscode.env.openExternal` to open the system browser on the UAA passcode page, and the app's existing manual-paste fallback (`auth:passcodeLogin`) as the _only_ path. Accepted as a UX downgrade vs. the desktop app's semi-automated scrape. |
| Native SQLite        | Open question, first item to resolve at M13 (see Risks). Fallback if native `better-sqlite3` proves unworkable inside the VS Code extension host: a WASM SQLite build for the extension only.                                                                                                                                                                                                  |

## Why this is tractable: architecture fit

The Electron app already has a hard boundary that maps almost exactly onto VS Code's own process
model, because the renderer never imports Node/Electron and only ever talks to the main process
through a single typed bridge (`window.api` / `invoke()` / `onEvent()`):

| cf-log-inspector today                                    | VS Code equivalent                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| Electron **main** process (all networking, SQLite, files) | VS Code **extension host** (Node, no DOM)                        |
| Electron **preload** (`contextBridge` + `ipcRenderer`)    | Webview bootstrap script (`acquireVsCodeApi()` + `postMessage`)  |
| Electron **renderer** (React, only talks to `window.api`) | VS Code **Webview** (same React app, same `window.api` contract) |
| `src/shared/ipc/contracts.ts` (channel + event registry)  | Same registry, reused as the webview message protocol            |

Because of this, most of the app's logic and most of the React UI should be reusable with little or
no change; the new work is concentrated in a fairly small set of adapter/integration points, not a
rewrite of business logic.

## Reuse inventory

**Reusable essentially unchanged** (largest share of the codebase, low risk):

- `src/shared/**` — DQL package, models, IPC contract _types_ (become the webview message shapes).
- `src/main/cf/**` except `passcode-window.ts` — discovery, UAA, CC client, Log Cache client, poller,
  connection manager. Already plain Node, already tested without Electron.
- `src/main/db/**`, `src/main/ingest/**` — workspace manager, migrations, query compiler, entry
  queries, writer, export job/manager. Already plain Node.
- `src/main/ipc/register.ts` + `ipc/*.handlers.ts` + `ipc/schemas.ts` — the zod-validated command
  layer; only the _transport_ underneath changes, not the handler functions.
- `src/renderer/src/**` (React components, TanStack Query hooks, zustand stores, CodeMirror query bar,
  virtualized table, detail panel) — all reachable only through `window.api`; the existing renderer
  mock (`api/mock/mock-api.ts`) already proves the UI works against any `PreloadApi` implementation.
- The existing vitest suite for `src/main/*` and `src/shared/*` stays valid untouched.

**Needs a new/adapted implementation** (small, well-isolated per file, but new code):

- `src/main/store/safe-storage.ts` → an `Encryptor` backed by `vscode.SecretStorage` instead of
  Electron `safeStorage` (same interface, swap the implementation).
- `src/main/cf/passcode-window.ts` → replaced by `vscode.env.openExternal(loginUrl + '/passcode')` plus
  the existing manual-paste form; the scrape logic (`extractPasscode`) is dropped for the extension.
- File/reveal dialogs (`workspace:pickFile`, `workspace:reveal`, export's save dialog) →
  `vscode.window.showOpenDialog`/`showSaveDialog`, `vscode.env.openExternal`/reveal-in-explorer
  equivalents.
- `src/main/index.ts` → new `src/extension/extension.ts` (`activate`/`deactivate`), no CSP header
  injection (webview CSP is set via the webview's HTML meta tag instead), no single-instance lock,
  window creation replaced by creating/reusing a `WebviewPanel`/`WebviewView`.
- `src/preload/index.ts` → new webview bootstrap implementing the same `PreloadApi` shape over
  `postMessage`/`acquireVsCodeApi()` instead of `contextBridge`.
- Title bar / window chrome (`app/TitleBar.tsx`, theme switcher) → simplify or drop in favor of VS
  Code's own window chrome; theme should follow the active VS Code theme via its CSS variables rather
  than the app's own light/dark/system toggle (visual/design work, not just plumbing).
- View layout decision: connections/streams/sessions as VS Code sidebar views (activity bar +
  `WebviewView`s) with the log table as a main editor-area `WebviewPanel`, vs. one single webview
  panel reusing today's internal side panel. Not forced by the platform — a UX decision to make at M13.

**Net-new** (no equivalent today):

- Extension packaging: `package.json` contribution points (commands, views, viewsContainers,
  configuration), `@vscode/vsce` packaging, Marketplace/Open VSX listing, versioning independent from
  electron-builder.
- Build tooling for the extension host bundle (esbuild is the common choice for VS Code extensions)
  alongside the existing Vite renderer build, which can likely be reused almost as-is for the webview
  bundle.

## Risks / decisions to resolve early

1. **better-sqlite3 native module in the extension host.** VS Code's extension host runs a specific
   bundled Node/Electron ABI that may not match what `electron-rebuild` produces for the desktop app,
   and prebuilt binaries are needed per OS/arch (win32-x64/arm64, darwin-x64/arm64, linux-x64/arm64).
   This is the single biggest technical risk to full parity and must be spiked first (M13). Fallback:
   a WASM SQLite build for the extension only, trading query performance/native FS access for zero
   native-module risk.
2. **SSO UX downgrade.** Dropping the embedded passcode-scrape window (confirmed decision) means every
   SSO login in the extension is manual copy-paste of the passcode. Accepted, but a real regression
   versus the desktop app worth calling out to users.
3. **Multiple VS Code windows / extension host lifecycle.** VS Code can have several windows open
   against the same installed extension, and `deactivate()` gives a much shorter shutdown grace period
   than Electron's `before-quit`. Decide whether stream/session state is per-window or a shared
   singleton, and make sure `streams.stopAll()` / `workspaces.close()` can complete within that window.
4. **Workspace model vs. VS Code's own "workspace" concept.** The app's own multi-file SQLite
   "workspaces" are unrelated to VS Code workspace folders; decide whether to keep them fully
   independent (simplest, most parity) or bind them to the currently open VS Code folder.
5. **Keybinding conflicts.** Row-selection shortcuts (Ctrl+A, Ctrl+C, Escape, arrow/Page/Home/End
   navigation) inside a webview may collide with VS Code's own keybindings and need explicit
   `when`-clause scoping or remapping.

## Milestones

| Milestone                                        | Scope                                                                                                                                                                                                                                                                              | Complexity                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| M13 – Feasibility spike                          | Prove better-sqlite3 (or the WASM fallback) works inside the real VS Code extension host across target platforms; decide the webview layout (single panel vs. sidebar views + editor panel); decide the workspace-vs-VS-Code-folder relationship. Blocks all following milestones. | Medium — research/prototyping, not shippable code |
| M14 – Extension scaffold + IPC transport adapter | New `src/extension/` host entry, webview bootstrap replacing preload, a message-passing adapter reusing `ipc/register.ts` handlers unchanged, minimal contribution points, a "hello world" webview loading the existing React bundle end-to-end.                                   | Medium                                            |
| M15 – Port core services + small adapters        | Wire `cf`/`db`/`ingest` code into the extension host unchanged; implement the `SecretStorage` encryptor, VS Code file dialogs, external-browser + manual-paste passcode flow.                                                                                                      | Low–medium                                        |
| M16 – Webview UI integration                     | Theme bridge to VS Code CSS variables, drop/replace the custom title bar and window chrome, lay out connections/streams/sessions/log table per the M13 layout decision, resolve keybinding conflicts.                                                                              | Medium–high — the most genuinely new/design work  |
| M17 – Feature-by-feature parity verification     | Query bar/DQL, time filter + auto-refresh + tail, detail panel, export, sessions/workspace management, all exercised inside the real webview (not just jsdom); fix webview-CSP or messaging-latency issues.                                                                        | Medium                                            |
| M18 – Packaging & distribution                   | `vsce` packaging including native module per-platform targets (or the WASM fallback from M13), CI build matrix, Marketplace/Open VSX listing, versioning strategy.                                                                                                                 | Medium–high, depends heavily on the M13 outcome   |
| M19 – Real-foundation validation                 | Same kind of end-to-end check the Electron app still owes (login, streaming at scale, export) but specifically inside VS Code.                                                                                                                                                     | —                                                 |

## Open questions carried forward (decide at/before M13)

- Sidebar-views-plus-editor-panel layout vs. a single big webview panel — affects M16 scope a lot.
- Whether VS Code workspace folders should ever auto-select/create a matching cf-log-inspector
  workspace file, or the two stay fully independent.
- Whether the Electron app and the extension should ship from the same version number/release, or
  independently.

## Status

Not started. This document is the source of truth for scope/design of the VS Code extension track;
update it as milestones complete, the same way `docs/DEVELOPMENT_PLAN.md` is kept current for the
Electron app.
