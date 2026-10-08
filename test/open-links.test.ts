// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installRendererApi } from './helpers/renderer-api';

/**
 * A button that opens a link or a folder, when nothing opens.
 *
 * A dozen of them asked the main process and did not look at the answer: no
 * browser, a folder that had been deleted, and the button simply did nothing.
 */

let api: ReturnType<typeof installRendererApi>;

async function load() {
  const open = await import('../src/renderer/open');
  const { useNoticeStore } = await import('../src/renderer/stores/notice-store');
  return { ...open, notice: () => useNoticeStore.getState().message };
}

beforeEach(() => {
  vi.resetModules();
  api = installRendererApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('opening something outside the launcher', () => {
  it('says nothing when it opened', async () => {
    const { openLink, notice } = await load();

    await expect(openLink('https://modrinth.com/mod/sodium')).resolves.toBe(true);

    expect(api.call('system', 'openUrl')).toHaveBeenCalledWith('https://modrinth.com/mod/sodium');
    expect(notice()).toBeNull();
  });

  it('says what did not open, and why when the system said', async () => {
    const { openLink, notice } = await load();
    api
      .call('system', 'openUrl')
      .mockResolvedValueOnce({ success: false, error: 'Failed to open URL: no handler' });

    await expect(openLink('https://modrinth.com/mod/sodium')).resolves.toBe(false);

    expect(notice()).toContain('https://modrinth.com/mod/sodium');
    expect(notice()).toContain('no handler');
  });

  it('does the same for a folder that is no longer there', async () => {
    const { openPath, notice } = await load();
    api
      .call('system', 'openPath')
      .mockResolvedValueOnce({ success: false, error: 'That folder is not there' });

    await openPath('/data/crash-reports');

    expect(notice()).toContain('/data/crash-reports');
    expect(notice()).toContain('That folder is not there');
  });

  it('names the profile whose folder would not open', async () => {
    const { openProfileFolder, notice } = await load();
    api.call('profiles', 'openFolder').mockResolvedValueOnce({ success: false });

    await openProfileFolder('p1', 'Survival');

    expect(notice()).toContain('Survival');
  });
});
