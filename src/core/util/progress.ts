// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { getMainWindow } from '../../main/window';
import type { ProgressEvent } from '../../shared/ipc-types';

/** The channels the progress window draws a bar for. */
export type ProgressChannel =
  | 'progress:mod-sync'
  | 'progress:loader-install'
  | 'progress:java-download'
  | 'progress:game-assets'
  | 'progress:launcher-update';

/**
 * Operations the window has been told about and not yet told the end of.
 *
 * A bar comes down when its operation reports that it is finished, and an
 * operation that fails or is cancelled never reports that — it throws. Each
 * one used to send its events straight to the window, so nothing knew a bar
 * had been left up: the box stayed on every page with its last line frozen,
 * over the update notice and the log viewer's buttons, until the same
 * operation ran again to the end or the launcher was restarted.
 */
const unfinished = new Set<string>();

/** Report where an operation has got to. At `progress: 1` it is finished. */
export function emitProgress(channel: ProgressChannel, event: ProgressEvent): void {
  if (event.progress >= 1) unfinished.delete(event.operationId);
  else unfinished.add(event.operationId);
  getMainWindow()?.webContents.send(channel, event);
}

/** Take down the bar of an operation that is over without having finished. */
export function abandonProgress(operationId: string): void {
  if (!unfinished.delete(operationId)) return;
  getMainWindow()?.webContents.send('progress:abandoned', operationId);
}

/**
 * Run a piece of work, and when it is over — returned, thrown or cancelled —
 * take down every bar it put up and did not finish.
 *
 * Around the whole of a launch and the whole of a sync, rather than a `finally`
 * in each of the downloads inside them: the ways out of those are many, and
 * this is the one place all of them pass through. Bars that were already up
 * when the work began belong to something else and are left alone.
 */
export async function withProgress<T>(work: () => Promise<T>): Promise<T> {
  const before = new Set(unfinished);
  try {
    return await work();
  } finally {
    for (const operationId of [...unfinished]) {
      if (!before.has(operationId)) abandonProgress(operationId);
    }
  }
}
