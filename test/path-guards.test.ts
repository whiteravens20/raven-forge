import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { paths } from '../src/core/config/paths';
import { loaderCacheDir } from '../src/core/modloader/loader-paths';
import { profileSchema } from '../src/shared/validators';
import { modManifestSchema } from '../src/shared/manifest-schema';

/**
 * Everything that arrives from outside and then becomes a path.
 *
 * Profile ids and loader versions both cross IPC as bare strings, and a profile
 * read back from `profiles.json` is not re-parsed on the way in — so the check
 * has to live where the path is built, not only in the schema that produced it.
 */

const ESCAPES = ['..', '.', '../../etc', 'a/b', 'a\\b', '/absolute', '', 'nul\0byte'];

describe('profile id as a path component', () => {
  const builders = [
    ['profileDir', (id: string) => paths.profileDir(id)],
    ['profileGameDir', (id: string) => paths.profileGameDir(id)],
    ['profileModsDir', (id: string) => paths.profileModsDir(id)],
    ['profileLockFile', (id: string) => paths.profileLockFile(id)],
    ['profileSyncStateFile', (id: string) => paths.profileSyncStateFile(id)],
    ['profileManifestCacheFile', (id: string) => paths.profileManifestCacheFile(id)],
    ['profileBackupsDir', (id: string) => paths.profileBackupsDir(id)],
    ['profileShadersDir', (id: string) => paths.profileShadersDir(id)],
    ['profileResourcePacksDir', (id: string) => paths.profileResourcePacksDir(id)],
  ] as const;

  for (const [name, build] of builders) {
    it(`${name} refuses an id that is not a single path component`, () => {
      for (const bad of ESCAPES) {
        expect(() => build(bad), `${name}(${JSON.stringify(bad)})`).toThrow(/Not a profile id/);
      }
    });

    it(`${name} stays under the profiles directory for a real id`, () => {
      const id = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
      const relative = path.relative(paths.profilesDir, build(id));
      expect(relative.startsWith('..')).toBe(false);
      expect(path.isAbsolute(relative)).toBe(false);
    });
  }
});

describe('loaderCacheDir', () => {
  it('refuses a loader version that is not a single path component', () => {
    for (const bad of ESCAPES) {
      expect(() => loaderCacheDir('fabric', '1.21.4', bad)).toThrow(/Not a version id/);
    }
  });

  it('refuses a Minecraft version that is not a single path component', () => {
    expect(() => loaderCacheDir('forge', '../../..', '54.0.1')).toThrow(/Not a version id/);
  });

  it('builds the expected directory for real versions', () => {
    const dir = loaderCacheDir('neoforge', '1.21.4', '21.4.100-beta');
    expect(dir).toBe(path.join(paths.loadersDir, 'neoforge', '1.21.4-21.4.100-beta'));
  });
});

describe('modLoaderVersion in the schemas', () => {
  const profile = {
    id: 'p1',
    name: 'Test',
    minecraftVersion: '1.21.4',
    modLoader: 'fabric' as const,
    allocatedRamMb: 4096,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  };

  it('accepts a plain loader version', () => {
    expect(profileSchema.parse({ ...profile, modLoaderVersion: '0.16.9' }).modLoaderVersion).toBe(
      '0.16.9',
    );
  });

  it('accepts no loader version at all', () => {
    expect(profileSchema.parse(profile).modLoaderVersion).toBeUndefined();
  });

  it('refuses a loader version carrying a path', () => {
    for (const bad of ['../../evil', 'a/b', 'a\\b', '..']) {
      expect(() => profileSchema.parse({ ...profile, modLoaderVersion: bad })).toThrow();
    }
  });

  it('refuses the same thing arriving in a pack manifest', () => {
    const manifest = {
      manifestVersion: 2,
      serverName: 'Test',
      minecraftVersion: '1.21.4',
      modLoader: 'forge',
      modLoaderVersion: '../../../../tmp/evil',
      mods: [],
    };
    expect(() => modManifestSchema.parse(manifest)).toThrow();
  });
});
