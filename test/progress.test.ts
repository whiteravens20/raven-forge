// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Which progress bars the window is told to take down.
 *
 * A bar is removed when its operation reports the end, and one that fails or is
 * cancelled throws instead. The window was then left showing a frozen bar until
 * the launcher restarted — so the end of the work that owned it has to be what
 * takes it down, whichever way that work ends.
 */

const sent: [string, unknown][] = [];
vi.mock('../src/main/window', () => ({
  getMainWindow: () => ({
    webContents: { send: (channel: string, payload: unknown) => sent.push([channel, payload]) },
  }),
}));

type Progress = typeof import('../src/core/util/progress');
let progress: Progress;

const step = (operationId: string, value: number) => ({
  operationId,
  progress: value,
  message: { text: operationId },
});
const abandoned = () =>
  sent.filter(([channel]) => channel === 'progress:abandoned').map(([, id]) => id);

beforeEach(async () => {
  sent.length = 0;
  vi.resetModules();
  progress = await import('../src/core/util/progress');
});

describe('withProgress', () => {
  it('takes down the bars of work that threw', async () => {
    await expect(
      progress.withProgress(async () => {
        progress.emitProgress('progress:game-assets', step('assets-1.21.1', 0.4));
        progress.emitProgress('progress:java-download', step('java-21', 0.1));
        throw new Error('503');
      }),
    ).rejects.toThrow('503');

    expect(abandoned().sort()).toEqual(['assets-1.21.1', 'java-21']);
  });

  it('says nothing about a bar that finished by itself', async () => {
    await progress.withProgress(async () => {
      progress.emitProgress('progress:mod-sync', step('p1', 0.5));
      progress.emitProgress('progress:mod-sync', step('p1', 1));
    });

    expect(abandoned()).toEqual([]);
  });

  it('takes down a bar the work left short of the end without failing', async () => {
    // A sync that had nothing to do reports its check and returns.
    await progress.withProgress(async () => {
      progress.emitProgress('progress:mod-sync', step('p1', 0.9));
    });

    expect(abandoned()).toEqual(['p1']);
  });

  it('leaves alone a bar that was up before the work began', async () => {
    // The launcher's own update, downloading while a launch fails.
    progress.emitProgress('progress:launcher-update', step('launcher-update', 0.3));

    await expect(
      progress.withProgress(async () => {
        progress.emitProgress('progress:game-assets', step('assets-1.21.1', 0.4));
        throw new Error('cancelled');
      }),
    ).rejects.toThrow();

    expect(abandoned()).toEqual(['assets-1.21.1']);
  });

  it('takes a bar down once, however the work is nested', async () => {
    // A launch runs a sync inside it, and each is wrapped.
    await expect(
      progress.withProgress(async () => {
        await progress
          .withProgress(async () => {
            progress.emitProgress('progress:mod-sync', step('p1', 0.2));
            throw new Error('inner');
          })
          .catch(() => undefined);
        progress.emitProgress('progress:game-assets', step('assets-1.21.1', 0.4));
        throw new Error('outer');
      }),
    ).rejects.toThrow('outer');

    expect(abandoned()).toEqual(['p1', 'assets-1.21.1']);
  });
});

describe('abandonProgress', () => {
  it('is silent about an operation with no bar up', () => {
    progress.abandonProgress('launcher-update');
    expect(sent).toEqual([]);
  });
});
