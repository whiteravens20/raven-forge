import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Profile } from '../src/shared/ipc-types';

/**
 * Custom profile artwork.
 *
 * The picked file comes from a native file dialog, so its name and its size are
 * both the user's — but the *type* decides what a `data:` URL will make the
 * renderer parse, and the size decides how much of it sits in the main
 * process's heap and then in every render. Both are checked here rather than
 * left to Chromium to be surprised by.
 *
 * The copy is deliberate too: referencing the file in place means a profile
 * that breaks because somebody tidied their Downloads folder.
 */

let root: string;
let source: string;

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

type Icons = typeof import('../src/core/profiles/profile-icon');
type Manager = typeof import('../src/core/profiles/profile-manager');

let icons: Icons;
let mgr: Manager;
let profile: Profile;

const png = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489',
  'hex',
);

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-icon-'));
  source = path.join(root, 'source');
  await fs.mkdir(source, { recursive: true });
  process.env.RAVENFORGE_DATA_DIR = path.join(root, 'data');

  vi.resetModules();
  const { reloadDataRoot } = await import('../src/core/config/data-root');
  reloadDataRoot();
  mgr = await import('../src/core/profiles/profile-manager');
  icons = await import('../src/core/profiles/profile-icon');

  profile = await mgr.createProfile({
    name: 'Ravens',
    minecraftVersion: '1.21.4',
    modLoader: 'fabric',
    allocatedRamMb: 4096,
  } as Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>);
});

afterEach(async () => {
  delete process.env.RAVENFORGE_DATA_DIR;
  await fs.rm(root, { recursive: true, force: true });
});

async function put(name: string, bytes: Buffer | number = png): Promise<string> {
  const file = path.join(source, name);
  await fs.writeFile(file, typeof bytes === 'number' ? Buffer.alloc(bytes) : bytes);
  return file;
}

describe('setProfileIcon', () => {
  it('copies the file in and points the profile at the copy', async () => {
    const updated = await icons.setProfileIcon(profile.id, await put('avatar.png'));

    expect(updated.iconPath).toBe(
      path.join(process.env.RAVENFORGE_DATA_DIR!, 'profiles', profile.id, 'icon.png'),
    );
    expect(await fs.readFile(updated.iconPath!)).toEqual(png);
    // The original can go now — that is the point of copying.
    await fs.rm(path.join(source, 'avatar.png'));
    expect(await icons.getProfileIconDataUrl(profile.id)).toMatch(/^data:image\/png;base64,/);
  });

  it('accepts every extension it advertises', async () => {
    for (const ext of ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']) {
      await expect(icons.setProfileIcon(profile.id, await put(`a${ext}`))).resolves.toBeTruthy();
    }
  });

  it('does not care what case the extension arrived in', async () => {
    await expect(icons.setProfileIcon(profile.id, await put('AVATAR.PNG'))).resolves.toBeTruthy();
  });

  it('refuses a type Chromium will not render as an image', async () => {
    await expect(icons.setProfileIcon(profile.id, await put('avatar.bmp'))).rejects.toThrow(
      /Unsupported image type/,
    );
  });

  it('refuses a file with no extension at all', async () => {
    await expect(icons.setProfileIcon(profile.id, await put('avatar'))).rejects.toThrow(
      /Unsupported image type/,
    );
  });

  it('refuses a directory that happens to be named like an image', async () => {
    const dir = path.join(source, 'album.png');
    await fs.mkdir(dir, { recursive: true });
    await expect(icons.setProfileIcon(profile.id, dir)).rejects.toThrow(/not a file/);
  });

  it('refuses an image far larger than a 40px avatar needs', async () => {
    // Not a taste judgement: this ends up base64'd into a data URL that the
    // renderer holds for as long as the profile list is on screen.
    await expect(
      icons.setProfileIcon(profile.id, await put('huge.png', 3 * 1024 * 1024)),
    ).rejects.toThrow(/the limit is 2 MB/);
  });

  it('does not leave the previous icon behind when the extension changes', async () => {
    const dir = path.join(process.env.RAVENFORGE_DATA_DIR!, 'profiles', profile.id);
    await icons.setProfileIcon(profile.id, await put('a.png'));
    await icons.setProfileIcon(profile.id, await put('b.webp'));

    expect((await fs.readdir(dir)).filter((f) => f.startsWith('icon.'))).toEqual(['icon.webp']);
  });

  it('says so when there is no such profile', async () => {
    await expect(icons.setProfileIcon('nope', await put('a.png'))).rejects.toThrow(/not found/);
  });
});

describe('clearProfileIcon', () => {
  it('removes the file and the reference', async () => {
    await icons.setProfileIcon(profile.id, await put('a.png'));
    const cleared = await icons.clearProfileIcon(profile.id);

    expect(cleared.iconPath).toBeUndefined();
    expect(await icons.getProfileIconDataUrl(profile.id)).toBeNull();
  });
});

describe('getProfileIconDataUrl', () => {
  it('is null for a profile that never had one', async () => {
    expect(await icons.getProfileIconDataUrl(profile.id)).toBeNull();
  });

  it('reads a vanished file as "never had one" rather than failing', async () => {
    // Somebody cleaned out the profile directory by hand. The profile list
    // still has to render.
    const updated = await icons.setProfileIcon(profile.id, await put('a.png'));
    await fs.rm(updated.iconPath!);
    expect(await icons.getProfileIconDataUrl(profile.id)).toBeNull();
  });

  it('gives the MIME type the extension names, not a guess at the bytes', async () => {
    await icons.setProfileIcon(profile.id, await put('a.svg'));
    expect(await icons.getProfileIconDataUrl(profile.id)).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});
