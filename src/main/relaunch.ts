// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { spawn } from 'node:child_process';
import { app } from 'electron';

/**
 * Start the launcher again, and leave.
 *
 * Electron's own relaunch hands the restart to a helper: a second copy of the
 * program that waits for this one to go and then starts it. That is right
 * everywhere but in an AppImage, which is one file that mounts itself for the
 * length of a run. The program there is the copy inside the mount, the helper
 * is that copy too, and the mount is taken down the moment this process leaves
 * — so the helper went with it, whichever program it had been told to start.
 * The launcher closed and stayed closed, after a move of the data above all,
 * which is the one thing it restarts for.
 *
 * `APPIMAGE` names the file itself, and the file is started from here, the way
 * the updater starts the one it has just put in place. The lock that keeps the
 * launcher to one instance is let go first: the new one comes up while this
 * one is still leaving, and finding the lock held it would take itself for a
 * second copy and close.
 */
export function relaunchLauncher(): void {
  const image = process.env.APPIMAGE;
  if (image) {
    app.releaseSingleInstanceLock();
    spawn(image, process.argv.slice(1), { detached: true, stdio: 'ignore' }).unref();
  } else {
    app.relaunch();
  }
  app.quit();
}
