/**
 * Launch Electron against the Vite dev server.
 *
 * This exists because `VITE_DEV_SERVER_URL=... electron .` is not portable —
 * cmd.exe does not understand the leading assignment, so the npm script would
 * only work on Linux and macOS. Setting it here keeps one dev command for
 * every platform without pulling in cross-env.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');

const url = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173';

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

child.on('close', (code, signal) => {
  // Ctrl-C in the terminal reaches Electron too; don't report that as a crash.
  process.exit(signal ? 0 : (code ?? 0));
});
