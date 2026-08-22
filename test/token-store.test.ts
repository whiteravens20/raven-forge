import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MinecraftAccount } from '../src/shared/ipc-types';

/**
 * Where a Microsoft login is kept.
 *
 * Secrets belong in the OS keychain, and on a Linux box with no keyring daemon
 * there is no keychain to put them in. Refusing to log in on such a machine is
 * not an option, so the launcher falls back to a 0600 file — and then has to
 * say so, because the person whose refresh token is sitting in plaintext is the
 * one who gets to decide whether that is acceptable. A `log.warn` nobody opens
 * does not tell them.
 *
 * The migration is the other half: a login made by a pre-keychain build must
 * move into the keychain the first time a build that has one reads it, and
 * anything the keychain rejects has to stay exactly where it is — a failed
 * migration is not a lost login.
 */

let root: string;
let keychain: Map<string, string> | null;

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// `keychain === null` is the machine with no keyring daemon: every call fails,
// which is what keytar does at call time rather than at load time.
vi.mock('../src/core/auth/secret-store', () => ({
  setSecret: async (key: string, value: string) => {
    if (!keychain) return false;
    keychain.set(key, value);
    return true;
  },
  getSecret: async (key: string) => keychain?.get(key),
  deleteSecret: async (key: string) => keychain?.delete(key) ?? false,
}));

type Store = typeof import('../src/core/auth/token-store');

async function loadModule(): Promise<Store> {
  vi.resetModules();
  const { reloadDataRoot } = await import('../src/core/config/data-root');
  reloadDataRoot();
  return import('../src/core/auth/token-store');
}

const authFile = () => path.join(root, 'auth.json');
const readAuth = async () => JSON.parse(await fs.readFile(authFile(), 'utf-8'));

const account = (id: string, name = id): MinecraftAccount => ({
  id,
  username: name,
  uuid: id,
  type: 'microsoft',
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-auth-'));
  process.env.RAVENFORGE_DATA_DIR = root;
  keychain = new Map();
});

afterEach(async () => {
  delete process.env.RAVENFORGE_DATA_DIR;
  await fs.rm(root, { recursive: true, force: true });
});

describe('with a working keychain', () => {
  it('keeps the refresh token out of the file entirely', async () => {
    const store = await loadModule();
    await store.saveAccount(account('a1'), 'refresh-token-value');

    const raw = await fs.readFile(authFile(), 'utf-8');
    expect(raw).not.toContain('refresh-token-value');
    expect(JSON.parse(raw).refreshTokens).toEqual({});
    expect(await store.getRefreshToken('a1')).toBe('refresh-token-value');
  });

  it('keeps the session token out of the file but the expiry in it', async () => {
    // The expiry is not a secret, and keeping it on disk means the "does this
    // need refreshing?" check never touches the keychain.
    const store = await loadModule();
    const expiresAt = Date.now() + 60_000;
    await store.saveAccount(account('a1'), undefined, { accessToken: 'mc-token', expiresAt });

    const stored = (await readAuth()).mcSessions.a1;
    expect(stored).toEqual({ expiresAt });
    expect(await store.getMcSession('a1')).toEqual({ accessToken: 'mc-token', expiresAt });
  });

  it('does not report plaintext credentials when there are none', async () => {
    const store = await loadModule();
    await store.saveAccount(account('a1'), 'refresh');
    const state = await store.getAuthState();
    expect(state.credentialsInPlaintext).toBe(false);
    expect(state).not.toHaveProperty('credentialsFile');
  });

  it('reads a session whose secret has gone as no session at all', async () => {
    // Indistinguishable from an expired one, and reporting it missing makes the
    // caller re-run the refresh chain instead of spending a token it cannot read.
    const store = await loadModule();
    await store.saveAccount(account('a1'), undefined, {
      accessToken: 'mc-token',
      expiresAt: Date.now() + 60_000,
    });
    keychain!.clear();
    expect(await store.getMcSession('a1')).toBeUndefined();
  });
});

describe('with no keychain', () => {
  beforeEach(() => {
    keychain = null;
  });

  it('falls back to the file rather than making login impossible', async () => {
    const store = await loadModule();
    await store.saveAccount(account('a1'), 'refresh-token-value');
    expect((await readAuth()).refreshTokens.a1).toBe('refresh-token-value');
    expect(await store.getRefreshToken('a1')).toBe('refresh-token-value');
  });

  it('does not leave the fallback file world-readable', async () => {
    const store = await loadModule();
    await store.saveAccount(account('a1'), 'refresh-token-value');
    expect((await fs.stat(authFile())).mode & 0o777).toBe(0o600);
  });

  it('tells the user their credentials are in plaintext, and where', async () => {
    const store = await loadModule();
    await store.saveAccount(account('a1'), 'refresh-token-value');
    const state = await store.getAuthState();
    expect(state.credentialsInPlaintext).toBe(true);
    expect(state.credentialsFile).toBe(authFile());
  });

  it('reports plaintext from what is on disk, not from what happened this session', async () => {
    // A launch that only reads has never hit the fallback path, and the warning
    // still has to be right.
    await fs.writeFile(
      authFile(),
      JSON.stringify({ accounts: [], activeAccountId: null, refreshTokens: { a1: 'secret' } }),
    );
    const store = await loadModule();
    expect((await store.getAuthState()).credentialsInPlaintext).toBe(true);
  });
});

describe('migrating a pre-keychain login', () => {
  it('lifts plaintext secrets into the keychain and drops them from the file', async () => {
    await fs.writeFile(
      authFile(),
      JSON.stringify({
        accounts: [account('a1')],
        activeAccountId: 'a1',
        refreshTokens: { a1: 'old-refresh' },
        mcSessions: { a1: { expiresAt: 123, accessToken: 'old-session' } },
      }),
    );

    const store = await loadModule();
    expect(await store.getAuthState()).toMatchObject({ credentialsInPlaintext: false });

    const after = await readAuth();
    expect(after.refreshTokens).toEqual({});
    expect(after.mcSessions.a1).toEqual({ expiresAt: 123 });
    expect(await store.getRefreshToken('a1')).toBe('old-refresh');
  });

  it('leaves a secret exactly where it is when the keychain refuses it', async () => {
    keychain = null;
    await fs.writeFile(
      authFile(),
      JSON.stringify({
        accounts: [account('a1')],
        activeAccountId: 'a1',
        refreshTokens: { a1: 'old-refresh' },
      }),
    );

    const store = await loadModule();
    await store.getAuthState();
    expect((await readAuth()).refreshTokens.a1).toBe('old-refresh');
    expect(await store.getRefreshToken('a1')).toBe('old-refresh');
  });
});

describe('the account list', () => {
  it('makes the first account active without being asked', async () => {
    const store = await loadModule();
    await store.saveAccount(account('a1'));
    await store.saveAccount(account('a2'));
    expect((await store.getAuthState()).activeAccountId).toBe('a1');
  });

  it('updates an account in place rather than adding it twice', async () => {
    const store = await loadModule();
    await store.saveAccount(account('a1', 'Old'));
    await store.saveAccount(account('a1', 'New'));
    const state = await store.getAuthState();
    expect(state.accounts).toHaveLength(1);
    expect(state.accounts[0].username).toBe('New');
  });

  it('hands the active flag on when the active account is removed', async () => {
    const store = await loadModule();
    await store.saveAccount(account('a1'));
    await store.saveAccount(account('a2'));
    await store.removeAccount('a1');

    const state = await store.getAuthState();
    expect(state.accounts.map((a) => a.id)).toEqual(['a2']);
    expect(state.activeAccountId).toBe('a2');
  });

  it('takes the secrets with the account', async () => {
    const store = await loadModule();
    await store.saveAccount(account('a1'), 'refresh', {
      accessToken: 'session',
      expiresAt: Date.now() + 1000,
    });
    await store.removeAccount('a1');

    expect(keychain!.size).toBe(0);
    expect(await store.getRefreshToken('a1')).toBeUndefined();
    expect(await store.getMcSession('a1')).toBeUndefined();
  });

  it('leaves nobody active when the last account goes', async () => {
    const store = await loadModule();
    await store.saveAccount(account('a1'));
    await store.removeAccount('a1');
    expect((await store.getAuthState()).activeAccountId).toBeNull();
  });

  it('refuses to make an account active that is not on the list', async () => {
    const store = await loadModule();
    await store.saveAccount(account('a1'));
    await expect(store.setActiveAccountId('a2')).rejects.toThrow(/not found/);
    expect((await store.getAuthState()).activeAccountId).toBe('a1');
  });
});

describe('overlapping writes', () => {
  it('does not let two saves in flight lose each other', async () => {
    // Every writer here reads the whole store, awaits a keychain round trip,
    // and writes the whole store back. A slow keychain widens that window and
    // what is at stake is a signed-in account disappearing from the list.
    const store = await loadModule();
    await Promise.all([
      store.saveAccount(account('a1'), 'r1'),
      store.saveAccount(account('a2'), 'r2'),
      store.saveAccount(account('a3'), 'r3'),
    ]);

    const state = await store.getAuthState();
    expect(state.accounts.map((a) => a.id).sort()).toEqual(['a1', 'a2', 'a3']);
  });
});
