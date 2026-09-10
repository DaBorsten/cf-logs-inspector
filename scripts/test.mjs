#!/usr/bin/env node
/**
 * Runs vitest inside Electron's bundled Node (ELECTRON_RUN_AS_NODE) so that native modules built for
 * Electron (better-sqlite3) load in tests. Extra CLI args are passed through, e.g. `pnpm test -- --watch`.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const electron = require('electron'); // resolves to the binary path
const vitest = require.resolve('vitest/vitest.mjs');

const args = process.argv.slice(2);
const mode = args.some((a) => a === 'watch' || a === '--watch' || a === '-w') ? [] : ['run'];
const child = spawn(electron, [vitest, ...mode, ...args.filter((a) => a !== 'watch')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' },
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
