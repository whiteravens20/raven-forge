// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

/**
 * Launch Electron against the Vite dev server.
 *
 * This exists because `VITE_DEV_SERVER_URL=... electron .` is not portable —
 * cmd.exe does not understand the leading assignment, so the npm script would
 * only work on Linux and macOS. Setting it here keeps one dev command for
 * every platform without pulling in cross-env.
 *
 * It starts beside the two things it needs, so it waits for them first: the
 * dev server, and what `tsc --watch` writes. A few lines of its own, because
 * a package for that brought an HTTP client and a schema library along, with
 * their advisories, to ask whether one port is open.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const electron = require('electron');

const url = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173';
const BUILT = ['dist/main/index.js', 'dist/preload/index.js'];

function serverListening() {
  const { hostname, port, protocol } = new URL(url);
  return new Promise((resolve) => {
    const socket = connect(Number(port) || (protocol === 'https:' ? 443 : 80), hostname);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

while (!BUILT.every((file) => existsSync(file)) || !(await serverListening())) {
  await sleep(250);
}

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

child.on('close', (code, signal) => {
  // Ctrl-C in the terminal reaches Electron too; don't report that as a crash.
  process.exit(signal ? 0 : (code ?? 0));
});
