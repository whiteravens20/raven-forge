// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { WHITE_RAVENS_PUBLIC_KEY } from '../src/shared/branding';
import type { GlobalSettings, IpcResult, Profile } from '../src/shared/ipc-types';

/**
 * What a handler answers, asked the way the renderer asks it.
 *
 * `ipc-contract.test.ts` settles that every channel has a handler. This is for
 * the handlers that decide something themselves rather than passing a call
 * straight through — where the decision lives in neither `src/core/` nor the
 * renderer, and so is covered by the tests of neither.
 */

type Listener = (event: unknown, ...args: unknown[]) => unknown;

const { handlers, mainFrame, running } = vi.hoisted(() => ({
  handlers: new Map<string, Listener>(),
  mainFrame: {},
  /** Profiles this suite says have a game up; nothing is ever spawned. */
  running: new Set<string>(),
}));

let root: string;

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(root, 'userData'),
    getVersion: () => '0.0.0-test',
    isPackaged: false,
  },
  ipcMain: {
    handle: (channel: string, listener: Listener) => handlers.set(channel, listener),
  },
  dialog: {},
  shell: { openExternal: () => Promise.resolve(), openPath: () => Promise.resolve('') },
  session: { defaultSession: { setProxy: () => Promise.resolve() } },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: class {},
}));

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

vi.mock('../src/core/minecraft/game-launcher', async (original) => ({
  ...(await original<typeof import('../src/core/minecraft/game-launcher')>()),
  isGameRunning: (profileId: string) => running.has(profileId),
  isGameBusy: (profileId: string) => running.has(profileId),
}));

// The sender guard wants a window whose main frame the call came from.
vi.mock('../src/main/window', () => ({
  getMainWindow: () => ({
    isDestroyed: () => false,
    webContents: { mainFrame, send: () => {} },
  }),
}));

/** Invoke a channel as the launcher's own page would. */
function call<T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  const listener = handlers.get(channel);
  if (!listener) throw new Error(`No handler registered for ${channel}`);
  return Promise.resolve(listener({ senderFrame: mainFrame }, ...args)) as Promise<IpcResult<T>>;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-handlers-'));
  process.env.RAVENFORGE_DATA_DIR = path.join(root, 'data');
  await fs.mkdir(process.env.RAVENFORGE_DATA_DIR, { recursive: true });

  vi.resetModules();
  handlers.clear();
  running.clear();
  const { reloadDataRoot } = await import('../src/core/config/data-root');
  reloadDataRoot();
  const { registerAllIpcHandlers } = await import('../src/main/ipc-handlers');
  registerAllIpcHandlers();
});

afterEach(async () => {
  delete process.env.RAVENFORGE_DATA_DIR;
  await fs.rm(root, { recursive: true, force: true });
});

const newProfile = (name: string) => ({
  name,
  minecraftVersion: '1.21.4',
  modLoader: 'fabric',
  allocatedRamMb: 4096,
});

describe('game:get-running', () => {
  it('names the profiles with a game up, and only those', async () => {
    // What a reloaded page asks, having lost the count it kept from events.
    const a = (await call<Profile>('profiles:create', newProfile('A'))).data!;
    const b = (await call<Profile>('profiles:create', newProfile('B'))).data!;
    expect((await call<string[]>('game:get-running')).data).toEqual([]);

    running.add(b.id);
    expect((await call<string[]>('game:get-running')).data).toEqual([b.id]);

    running.add(a.id);
    expect((await call<string[]>('game:get-running')).data).toEqual([a.id, b.id]);
  });
});

/**
 * A profile's mods, shaders and resource packs while its game is up.
 *
 * The pages switch these controls off, which stops a click and not a request
 * that was already on its way. The game has the files open or is about to read
 * them, so the answer is given here as well.
 */
describe('changing a profile’s files under its running game', () => {
  const modsDir = (id: string) => path.join(root, 'data', 'profiles', id, '.minecraft', 'mods');
  const lockFile = (id: string) => path.join(root, 'data', 'profiles', id, 'installed.lock');

  async function profileWithMod(): Promise<string> {
    const { id } = (await call<Profile>('profiles:create', newProfile('Modded'))).data!;
    await fs.mkdir(modsDir(id), { recursive: true });
    await fs.writeFile(path.join(modsDir(id), 'sodium.jar'), 'jar');
    await fs.writeFile(
      lockFile(id),
      JSON.stringify([
        {
          id: 'sodium',
          name: 'Sodium',
          version: '0.6.0',
          source: 'modrinth',
          fileName: 'sodium.jar',
          required: false,
          side: 'client',
          enabled: true,
          fromManifest: false,
        },
      ]),
    );
    return id;
  }

  it.each([
    ['mods:sync-manifest', []],
    ['mods:install-from-search', [{ id: 'lithium' }]],
    ['mods:uninstall', ['sodium']],
    ['mods:toggle-enabled', ['sodium', false]],
    ['mods:update', [['sodium']]],
    ['content:install-shader', ['modrinth:complementary']],
    ['content:install-resourcepack', ['modrinth:faithful']],
    ['content:remove-shader', ['x']],
    ['content:remove-resourcepack', ['x']],
    ['content:reorder-resourcepacks', [[]]],
    ['content:install-shader-loader', ['iris']],
  ])('%s is refused, and says why', async (channel, args) => {
    const id = await profileWithMod();
    running.add(id);

    const result = await call(channel, id, ...args);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Close the game first/);
    // Nothing was touched on the way to saying so.
    expect(await fs.readFile(path.join(modsDir(id), 'sodium.jar'), 'utf-8')).toBe('jar');
    expect(JSON.parse(await fs.readFile(lockFile(id), 'utf-8'))).toHaveLength(1);
  });

  it('goes through once the game is down', async () => {
    const id = await profileWithMod();

    expect((await call('mods:uninstall', id, 'sodium')).success).toBe(true);
    await expect(fs.access(path.join(modsDir(id), 'sodium.jar'))).rejects.toThrow();
  });
});

describe('settings:add-trusted-key', () => {
  const key = (publicKey: string, name = 'Raven SMP') => ({
    name,
    publicKey,
    addedAt: '2026-01-01T00:00:00.000Z',
  });
  const real = () => encodeBase64(nacl.sign.keyPair().publicKey);

  it('stores a real key and answers with the settings that now hold it', async () => {
    const added = key(real());
    const result = await call<GlobalSettings>('settings:add-trusted-key', added);
    expect(result.success).toBe(true);
    expect(result.data?.trustedPublicKeys).toEqual([added]);

    // And it is what a later read finds, so the renderer need not save it again.
    const stored = await call<GlobalSettings>('settings:get');
    expect(stored.data?.trustedPublicKeys).toEqual([added]);
  });

  it('refuses something that is not a key, and stores nothing', async () => {
    // Stored, it could verify nothing and would still switch enforcement on:
    // every third-party manifest refused from then on.
    for (const wrong of ['not-a-key', 'MCowBQYDK2VwAyEA', real().slice(0, 20)]) {
      const result = await call<GlobalSettings>('settings:add-trusted-key', key(wrong));
      expect(result.success, wrong).toBe(false);
      expect(result.error).toMatch(/not an Ed25519 public key/);
    }
    expect((await call<GlobalSettings>('settings:get')).data?.trustedPublicKeys).toEqual([]);
  });

  it('refuses a key that is already there', async () => {
    const added = key(real());
    await call('settings:add-trusted-key', added);
    const again = await call<GlobalSettings>(
      'settings:add-trusted-key',
      key(added.publicKey, 'Twice'),
    );
    expect(again.success).toBe(false);
    expect((await call<GlobalSettings>('settings:get')).data?.trustedPublicKeys).toEqual([added]);
  });

  it('refuses the built-in key, which the list would hide and never let go of', async () => {
    const result = await call<GlobalSettings>(
      'settings:add-trusted-key',
      key(WHITE_RAVENS_PUBLIC_KEY),
    );
    expect(result.success).toBe(false);
    expect((await call<GlobalSettings>('settings:get')).data?.trustedPublicKeys).toEqual([]);
  });

  it('does not report a key with no name as stored', async () => {
    const result = await call<GlobalSettings>('settings:add-trusted-key', key(real(), ''));
    expect(result.success).toBe(false);
  });
});

describe('settings:remove-trusted-key', () => {
  it('answers with the settings that are left', async () => {
    const kept = {
      name: 'Kept',
      publicKey: encodeBase64(nacl.sign.keyPair().publicKey),
      addedAt: '2026-01-01T00:00:00.000Z',
    };
    const gone = { ...kept, name: 'Gone', publicKey: encodeBase64(nacl.sign.keyPair().publicKey) };
    await call('settings:add-trusted-key', kept);
    await call('settings:add-trusted-key', gone);

    const result = await call<GlobalSettings>('settings:remove-trusted-key', gone.publicKey);
    expect(result.success).toBe(true);
    expect(result.data?.trustedPublicKeys).toEqual([kept]);
  });
});
