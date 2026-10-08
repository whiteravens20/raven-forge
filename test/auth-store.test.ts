// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installRendererApi } from './helpers/renderer-api';

/**
 * What the accounts page is told about a sign-in, a switch and a sign-out.
 *
 * Each of them can be refused by the main process, and each used to look the
 * same on screen whether it had been or not.
 */

let api: ReturnType<typeof installRendererApi>;

async function loadStore() {
  const { useAuthStore } = await import('../src/renderer/stores/auth-store');
  return useAuthStore;
}

beforeEach(() => {
  vi.resetModules();
  api = installRendererApi();
  api.call('auth', 'getState').mockResolvedValue({
    success: true,
    data: { accounts: [{ id: 'a' }, { id: 'b' }], activeAccountId: 'a' },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signing in with Microsoft', () => {
  it('reports nothing when the player closed the window themselves', async () => {
    // It came back as "Login failed: Authentication window was closed", in red.
    const store = await loadStore();
    api.call('auth', 'loginMicrosoft').mockResolvedValueOnce({
      success: false,
      error: 'Sign-in was called off',
      code: 'CANCELLED',
    });

    await expect(store.getState().loginMicrosoft()).resolves.toBeNull();
    expect(store.getState().isAuthenticating).toBe(false);
  });

  it('reports a sign-in that really failed, with the reason', async () => {
    const store = await loadStore();
    api
      .call('auth', 'loginMicrosoft')
      .mockResolvedValueOnce({ success: false, error: 'Login failed: no Xbox profile' });

    await expect(store.getState().loginMicrosoft()).resolves.toBe('Login failed: no Xbox profile');
  });
});

describe('switching the active account', () => {
  it('marks it active once the main process has agreed', async () => {
    const store = await loadStore();
    await store.getState().load();

    await expect(store.getState().setActive('b')).resolves.toBeNull();

    expect(store.getState().activeAccountId).toBe('b');
  });

  it('leaves the old one marked when it was refused, and says why', async () => {
    // The page used to mark the new one whatever the answer, and the launcher
    // went on playing as the old.
    const store = await loadStore();
    await store.getState().load();
    api
      .call('auth', 'setActive')
      .mockResolvedValueOnce({ success: false, error: 'no such account' });

    await expect(store.getState().setActive('b')).resolves.toBe('no such account');

    expect(store.getState().activeAccountId).toBe('a');
  });
});

describe('signing out', () => {
  it('says when it failed, and shows the list as it now is', async () => {
    const store = await loadStore();
    api.call('auth', 'logout').mockResolvedValueOnce({ success: false, error: 'keychain locked' });

    await expect(store.getState().logout('a')).resolves.toBe('keychain locked');

    expect(api.call('auth', 'getState')).toHaveBeenCalled();
    expect(store.getState().accounts).toHaveLength(2);
  });
});

describe('the accounts before they have been read', () => {
  it('are not taken for nobody being signed in', async () => {
    let answer: (result: unknown) => void = () => {};
    api
      .call('auth', 'getState')
      .mockReturnValue(new Promise((resolve) => (answer = resolve)) as never);
    const store = await loadStore();

    const loading = store.getState().load();
    expect(store.getState().loaded).toBe(false);

    answer({ success: true, data: { accounts: [], activeAccountId: null } });
    await loading;
    expect(store.getState().loaded).toBe(true);
  });

  it('count as read once the main process has announced them itself', async () => {
    // The silent refresh at launch tells the page who is signed in before the
    // page has asked.
    const store = await loadStore();
    api.emit('auth:state-changed', { accounts: [{ id: 'a' }], activeAccountId: 'a' });
    expect(store.getState().loaded).toBe(true);
  });

  it('keeps the accounts it has, and says so, when they cannot be read again', async () => {
    const store = await loadStore();
    await store.getState().load();
    api.call('auth', 'getState').mockResolvedValue({ success: false, error: 'keyring is locked' });

    await store.getState().load();

    expect(store.getState().accounts).toHaveLength(2);
    const { useNoticeStore } = await import('../src/renderer/stores/notice-store');
    expect(useNoticeStore.getState().message).toBe('keyring is locked');
  });
});
