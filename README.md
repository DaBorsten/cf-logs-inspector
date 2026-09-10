# cf-log-inspector

Cross-platform desktop app (Linux, Windows, macOS) to stream, store and analyze Cloud Foundry application logs.

- Log in to Cloud Foundry spaces natively (username/password, custom identity provider, SSO passcode) without the `cf` CLI
- Stream logs from several apps at once via the Log Cache API, with `--recent` backfill
- Store sessions in switchable SQLite workspaces
- Filter with an OpenSearch DQL-style query language, time ranges and a configurable column table
- Export to JSON or CSV

See [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) for architecture and milestones.

## Development

```bash
pnpm install        # also rebuilds better-sqlite3 for Electron
pnpm dev            # start Electron with hot reload
pnpm test           # vitest
pnpm typecheck
pnpm lint
pnpm build          # bundle main/preload/renderer into out/
pnpm package        # electron-builder installers into release/
```

## Status

- [x] M0 scaffold: electron-vite, React, strict TypeScript, typed IPC bridge, CSP, vitest
- [x] M1 shared DQL package (`src/shared/dql`): tokenizer, parser, evaluator, autocomplete context, stringify
- [x] M2 auth + CF client (`src/main/cf`): endpoint discovery, UAA password / custom-IdP origin / SSO passcode login with token refresh, encrypted token store, CF v3 orgs/spaces/apps
- [ ] M3 Log Cache streaming
- [ ] M4 storage
- [ ] M5 query engine
- [ ] M6+ UI
