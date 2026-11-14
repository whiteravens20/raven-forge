// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MinecraftAccount } from '../src/shared/ipc-types';

/**
 * What signing an account out leaves of the sign-in window.
 *
 * The window shares the launcher's session, so what Microsoft's pages keep in
 * it — cookies, and their storage beside them — outlives the account unless it
 * is cleared. The launcher's own page is in the same session and keeps things
 * of its own there: the profile chosen, the announcements put away. Those stay.
 * That clearing everything but one origin leaves that origin's storage alone
 * is Electron's to keep; it was tried on Electron 44 with a `file://` page and
 * a page over http, and only the second lost its storage and cookies.
 */

const { cleared, signedIn, clearing } = vi.hoisted(() => ({
  cleared: [] as unknown[],
  signedIn: { account: undefined as MinecraftAccount | undefined },
  clearing: { fails: false },
}));

vi.mock('electron', () => ({
  BrowserWindow: class {},
  session: {
    defaultSession: {
      clearData: async (options: unknown) => {
        if (clearing.fails) throw new Error('the session would not be cleared');
        cleared.push(options);
      },
    },
  },
}));
vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../src/main/window', () => ({ getMainWindow: () => null }));
vi.mock('../src/core/auth/token-store', () => ({
  getAccount: async () => signedIn.account,
  removeAccount: async () => {
    signedIn.account = undefined;
  },
  saveAccount: async () => {},
  setActiveAccountId: async () => {},
  getRefreshToken: async () => undefined,
  getMcSession: async () => undefined,
  getAuthState: async () => ({ accounts: [], activeAccountId: null }),
}));

const { logoutAccount } = await import('../src/core/auth/microsoft-auth');

const microsoft: MinecraftAccount = {
  id: 'a1',
  uuid: '069a79f444e94726a5befca90e38aaf5',
  username: 'RavenPlayer',
  type: 'microsoft',
};

beforeEach(() => {
  cleared.length = 0;
  clearing.fails = false;
  delete process.env.VITE_DEV_SERVER_URL;
});

afterEach(() => {
  delete process.env.VITE_DEV_SERVER_URL;
});

describe('signing out a Microsoft account', () => {
  it("clears what every page kept, except the launcher's own page", async () => {
    signedIn.account = microsoft;
    await logoutAccount('a1');
    expect(cleared).toEqual([{ excludeOrigins: ['file://'] }]);
  });

  it('leaves the page the development server serves alone as well, while it is the one in use', async () => {
    process.env.VITE_DEV_SERVER_URL = 'http://127.0.0.1:5173/';
    signedIn.account = microsoft;
    await logoutAccount('a1');
    expect(cleared).toEqual([{ excludeOrigins: ['file://', 'http://127.0.0.1:5173'] }]);
  });

  it('signs the account out even when the session cannot be cleared', async () => {
    signedIn.account = microsoft;
    clearing.fails = true;
    await expect(logoutAccount('a1')).resolves.toBeUndefined();
    expect(signedIn.account).toBeUndefined();
  });
});

describe('signing out an offline account', () => {
  it('clears nothing, since it never opened the sign-in window', async () => {
    signedIn.account = { ...microsoft, type: 'offline' };
    await logoutAccount('a1');
    expect(cleared).toEqual([]);
  });
});
