import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModrinthVersion } from '../src/core/mods/modrinth-api';
import type { InstalledMod } from '../src/shared/ipc-types';

const getModVersions = vi.fn();
const getProjectTitle = vi.fn();

vi.mock('../src/core/mods/modrinth-api', () => ({
  getModVersions: (...args: unknown[]) => getModVersions(...args),
  getProjectTitle: (...args: unknown[]) => getProjectTitle(...args),
}));

const { planModInstall, planContentInstall, requiredDependencies } =
  await import('../src/core/mods/compatibility');
const { acceptedLoaders } = await import('../src/shared/constants');

/** A Modrinth build, with only the fields the planner reads. */
function build(over: Partial<ModrinthVersion> = {}): ModrinthVersion {
  return {
    id: 'v1',
    project_id: 'p1',
    name: 'build',
    version_number: '1.0.0',
    game_versions: ['1.21.4'],
    loaders: ['fabric'],
    files: [],
    dependencies: [],
    ...over,
  };
}

const FABRIC_1214 = { minecraftVersion: '1.21.4', modLoader: 'fabric' } as const;
const MOD = { id: 'p1', name: 'Some Mod' };

/**
 * Answer `getModVersions(projectId, gameVersion, loaders)` from a table keyed by
 * how the call was narrowed, so a test can say "there are Forge builds for
 * 1.21.4 and nothing else" without caring about call order.
 *
 * Keyed by the *query*, not by what it means. A content check passes no loaders
 * at all, so its narrowest call is `versionOnly` and its widest is `unfiltered`
 * — the same two buckets a mod check uses when widening past the loader.
 */
function respond(table: {
  bothNarrowed?: ModrinthVersion[];
  versionOnly?: ModrinthVersion[];
  loaderOnly?: ModrinthVersion[];
  unfiltered?: ModrinthVersion[];
}) {
  getModVersions.mockImplementation(
    (_id: string, gameVersion?: string, loaders?: string[]): ModrinthVersion[] => {
      const hasLoaders = Array.isArray(loaders) && loaders.length > 0;
      if (gameVersion && hasLoaders) return table.bothNarrowed ?? [];
      if (gameVersion) return table.versionOnly ?? [];
      if (hasLoaders) return table.loaderOnly ?? [];
      return table.unfiltered ?? [];
    },
  );
}

beforeEach(() => {
  getModVersions.mockReset();
  getProjectTitle.mockReset();
  getProjectTitle.mockImplementation((id: string) => `Project ${id}`);
});

describe('acceptedLoaders', () => {
  it('accepts Fabric mods on a Quilt profile', () => {
    // Quilt ships a Fabric compatibility layer and most projects never publish
    // a separate Quilt build — refusing them would reject most of what exists.
    expect(acceptedLoaders('quilt')).toEqual(['quilt', 'fabric']);
  });

  it('keeps every other loader to itself', () => {
    expect(acceptedLoaders('fabric')).toEqual(['fabric']);
    expect(acceptedLoaders('forge')).toEqual(['forge']);
    // Forge and NeoForge were one thing on 1.20.1 and diverged after it. A rule
    // true for one Minecraft version is not a rule.
    expect(acceptedLoaders('neoforge')).toEqual(['neoforge']);
  });

  it('gives vanilla nothing, because nothing would load a mod', () => {
    expect(acceptedLoaders('vanilla')).toEqual([]);
  });
});

describe('planModInstall', () => {
  it('reports nothing wrong, and asks Modrinth once, when the build fits', async () => {
    respond({ bothNarrowed: [build()] });

    const plan = await planModInstall(FABRIC_1214, MOD, []);

    expect(plan.issues).toEqual([]);
    expect(plan.versionId).toBe('v1');
    // The common case must not cost extra round trips — a widening query only
    // makes sense once something is already known not to fit.
    expect(getModVersions).toHaveBeenCalledTimes(1);
  });

  it('names the loaders a mod does publish when only the loader is wrong', async () => {
    respond({ versionOnly: [build({ loaders: ['forge', 'neoforge'] })] });

    const plan = await planModInstall(FABRIC_1214, MOD, []);

    expect(plan.issues).toEqual([{ kind: 'wrong-loader', supported: ['forge', 'neoforge'] }]);
    // Still installable: the player may know something the metadata does not.
    expect(plan.versionId).toBe('v1');
  });

  it('names the newest Minecraft versions when only the version is wrong', async () => {
    respond({ loaderOnly: [build({ game_versions: ['1.21.5', '1.21.6'] })] });

    const plan = await planModInstall(FABRIC_1214, MOD, []);

    // Newest first. `game_versions` arrives oldest first, so reading it forwards
    // would answer "what does this support?" with the oldest entry — true, and
    // useless, especially for a pack listing seventy-five versions.
    expect(plan.issues).toEqual([{ kind: 'wrong-version', supported: ['1.21.6', '1.21.5'] }]);
  });

  it('caps how many versions it lists rather than printing the whole history', async () => {
    respond({ loaderOnly: [build({ game_versions: ['1.7.10', '1.8', '1.19', '1.20', '1.21'] })] });

    const plan = await planModInstall(FABRIC_1214, MOD, []);

    expect(plan.issues).toEqual([{ kind: 'wrong-version', supported: ['1.21', '1.20', '1.19'] }]);
  });

  it('reports both axes when neither the loader nor the version matches', async () => {
    respond({ unfiltered: [build({ loaders: ['forge'], game_versions: ['1.16.5'] })] });

    const plan = await planModInstall(FABRIC_1214, MOD, []);

    expect(plan.issues).toEqual([
      { kind: 'wrong-loader', supported: ['forge'] },
      { kind: 'wrong-version', supported: ['1.16.5'] },
    ]);
  });

  it('leaves nothing to install when the project publishes nothing', async () => {
    respond({});

    const plan = await planModInstall(FABRIC_1214, MOD, []);

    expect(plan.issues).toEqual([{ kind: 'no-build' }]);
    // The dialog keys "install anyway" off this: offering the button with no
    // file behind it would be a lie.
    expect(plan.versionId).toBeUndefined();
  });

  it('says a vanilla profile has nothing to load a mod', async () => {
    respond({ bothNarrowed: [build()] });

    const plan = await planModInstall(
      { minecraftVersion: '1.21.4', modLoader: 'vanilla' },
      MOD,
      [],
    );

    expect(plan.issues).toContainEqual({ kind: 'needs-loader' });
  });

  it('flags a declared conflict with something already installed', async () => {
    // Embeddium declares itself incompatible with Rubidium, which it replaced.
    // Installing both is a crash that reads like a graphics driver fault.
    respond({
      bothNarrowed: [
        build({
          dependencies: [{ version_id: null, project_id: 'rub', dependency_type: 'incompatible' }],
        }),
      ],
    });
    const installed = [{ id: 'rub', name: 'Rubidium' } as InstalledMod];

    const plan = await planModInstall(FABRIC_1214, MOD, installed);

    expect(plan.issues).toEqual([{ kind: 'conflicts-with', names: ['Rubidium'] }]);
  });

  it('ignores a conflict with something the profile does not have', async () => {
    respond({
      bothNarrowed: [
        build({
          dependencies: [{ version_id: null, project_id: 'rub', dependency_type: 'incompatible' }],
        }),
      ],
    });

    expect((await planModInstall(FABRIC_1214, MOD, [])).issues).toEqual([]);
  });

  it('lists the required dependencies it would install alongside', async () => {
    getModVersions.mockImplementation((id: string): ModrinthVersion[] => {
      if (id === 'p1') {
        return [
          build({
            dependencies: [{ version_id: null, project_id: 'fapi', dependency_type: 'required' }],
          }),
        ];
      }
      return [build({ id: 'dep-v', version_number: '0.115.0' })];
    });
    getProjectTitle.mockResolvedValue('Fabric API');

    const plan = await planModInstall(FABRIC_1214, MOD, []);

    // Not an issue — it is going to be handled — but it must be said. Files
    // appearing in a profile nobody asked for is how a profile stops making sense.
    expect(plan.issues).toEqual([]);
    expect(plan.dependencies).toEqual([{ id: 'fapi', name: 'Fabric API', version: '0.115.0' }]);
  });

  it('does not re-list a dependency the profile already has', async () => {
    respond({
      bothNarrowed: [
        build({
          dependencies: [{ version_id: null, project_id: 'fapi', dependency_type: 'required' }],
        }),
      ],
    });

    const installed = [{ id: 'fapi', name: 'Fabric API' } as InstalledMod];
    const plan = await planModInstall(FABRIC_1214, MOD, installed);

    expect(plan.dependencies).toEqual([]);
    expect(plan.issues).toEqual([]);
  });

  it('warns when a required dependency has no build for this profile', async () => {
    getModVersions.mockImplementation((id: string): ModrinthVersion[] =>
      id === 'p1'
        ? [
            build({
              dependencies: [{ version_id: null, project_id: 'fapi', dependency_type: 'required' }],
            }),
          ]
        : [],
    );
    getProjectTitle.mockResolvedValue('Fabric API');

    const plan = await planModInstall(FABRIC_1214, MOD, []);

    // This is the one that turns into a startup crash: the mod installs, the
    // thing it needs cannot, and the game dies naming a class nobody recognises.
    expect(plan.issues).toEqual([{ kind: 'dependency-no-build', names: ['Fabric API'] }]);
  });

  it('ignores optional and embedded dependencies', async () => {
    respond({
      bothNarrowed: [
        build({
          dependencies: [
            { version_id: null, project_id: 'a', dependency_type: 'optional' },
            { version_id: null, project_id: 'b', dependency_type: 'embedded' },
          ],
        }),
      ],
    });

    const plan = await planModInstall(FABRIC_1214, MOD, []);

    expect(plan.dependencies).toEqual([]);
    expect(plan.issues).toEqual([]);
  });
});

describe('planContentInstall', () => {
  it('asks only about the Minecraft version', async () => {
    respond({ versionOnly: [build({ loaders: ['iris', 'optifine'] })] });

    const plan = await planContentInstall(FABRIC_1214, { id: 'p1', name: 'Some Shader' });

    // A shader's "loaders" are Iris and OptiFine, and a resource pack's is
    // `minecraft`. Neither is the profile's mod loader, so filtering on it would
    // reject everything that exists.
    expect(plan.issues).toEqual([]);
    expect(getModVersions).toHaveBeenCalledWith('p1', '1.21.4', []);
  });

  it('reports a pack built for other Minecraft versions', async () => {
    respond({ unfiltered: [build({ game_versions: ['1.20.1'] })] });

    const plan = await planContentInstall(FABRIC_1214, { id: 'p1', name: 'Some Shader' });

    expect(plan.issues).toEqual([{ kind: 'wrong-version', supported: ['1.20.1'] }]);
    expect(plan.versionId).toBe('v1');
  });

  it('never blames the loader for a pack that has none', async () => {
    respond({});

    const plan = await planContentInstall(FABRIC_1214, { id: 'p1', name: 'Some Shader' });

    expect(plan.issues).toEqual([{ kind: 'no-build' }]);
  });
});

describe('requiredDependencies', () => {
  it('drops entries with no project id', () => {
    // Modrinth allows a dependency pinned by version alone. Without a project
    // there is nothing to look up, and inventing one would install the wrong mod.
    const version = build({
      dependencies: [{ version_id: 'v9', project_id: null, dependency_type: 'required' }],
    });
    expect(requiredDependencies(version, [])).toEqual([]);
  });

  it('carries the pinned version id through', () => {
    const version = build({
      dependencies: [{ version_id: 'v9', project_id: 'p2', dependency_type: 'required' }],
    });
    expect(requiredDependencies(version, [])).toEqual([{ projectId: 'p2', versionId: 'v9' }]);
  });
});
