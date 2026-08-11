import { describe, it, expect } from 'vitest';
import { mergeVersionMeta } from '../src/core/minecraft/version-manifest';
import type { VersionMeta } from '../src/core/minecraft/types';

/**
 * Merging a loader profile onto vanilla decides what ends up on the classpath.
 * Getting it wrong does not throw — the game launches and then crashes, or
 * launches vanilla while claiming to be modded — so every case here is one of
 * those silent-wrong-answer shapes.
 */
const vanilla: VersionMeta = {
  id: '1.21.4',
  type: 'release',
  mainClass: 'net.minecraft.client.main.Main',
  assets: '19',
  assetIndex: { id: '19', sha1: 'a'.repeat(40), size: 1, totalSize: 2, url: 'https://a/idx.json' },
  downloads: { client: { sha1: 'b'.repeat(40), size: 3, url: 'https://a/client.jar' } },
  javaVersion: { component: 'java-runtime-delta', majorVersion: 21 },
  libraries: [
    { name: 'org.ow2.asm:asm:9.6' },
    { name: 'com.google.guava:guava:32.1.2-jre' },
    { name: 'com.mojang:jtracy:1.0.37:natives-linux' },
    { name: 'com.mojang:jtracy:1.0.37:natives-windows' },
  ],
  arguments: {
    game: ['--version', '${version_name}'],
    jvm: ['-Djava.library.path=${natives_directory}'],
  },
};

/** What a Fabric profile JSON actually looks like: partial, with inheritsFrom. */
const fabric: Partial<VersionMeta> = {
  id: 'fabric-loader-0.16.9-1.21.4',
  inheritsFrom: '1.21.4',
  mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
  libraries: [
    { name: 'net.fabricmc:fabric-loader:0.16.9', url: 'https://maven.fabricmc.net/' },
    { name: 'org.ow2.asm:asm:9.7.1', url: 'https://maven.fabricmc.net/' },
  ],
  arguments: { game: [], jvm: [] },
};

describe('mergeVersionMeta', () => {
  const merged = mergeVersionMeta(vanilla, fabric);

  it("takes the child's id — that is the version being launched", () => {
    expect(merged.id).toBe('fabric-loader-0.16.9-1.21.4');
  });

  it("takes the child's mainClass", () => {
    // Inheriting vanilla's would launch an unmodded game that looks modded.
    expect(merged.mainClass).toBe('net.fabricmc.loader.impl.launch.knot.KnotClient');
  });

  it("puts the loader's copy of a shared artifact first and drops the parent's", () => {
    const asm = merged.libraries.filter((l) => l.name.startsWith('org.ow2.asm:asm:'));
    expect(asm).toHaveLength(1);
    expect(asm[0].name).toBe('org.ow2.asm:asm:9.7.1');
  });

  it('keeps parent libraries the child does not override', () => {
    expect(merged.libraries.map((l) => l.name)).toContain('com.google.guava:guava:32.1.2-jre');
  });

  it('keeps per-OS natives apart instead of collapsing them', () => {
    // Keyed on group:artifact alone, the second jtracy entry would be dropped
    // and Windows would launch without its natives.
    const jtracy = merged.libraries.filter((l) => l.name.startsWith('com.mojang:jtracy'));
    expect(jtracy.map((l) => l.name)).toEqual([
      'com.mojang:jtracy:1.0.37:natives-linux',
      'com.mojang:jtracy:1.0.37:natives-windows',
    ]);
  });

  it('never blanks out parent fields the child omits', () => {
    // A loader profile carries no assets or downloads of its own. Spreading the
    // child over the parent would set these to undefined and break asset
    // resolution with no error until the game is already starting.
    expect(merged.assetIndex).toEqual(vanilla.assetIndex);
    expect(merged.assets).toBe('19');
    expect(merged.downloads).toEqual(vanilla.downloads);
    expect(merged.javaVersion).toEqual(vanilla.javaVersion);
  });

  it('applies parent arguments first and child arguments last', () => {
    const withArgs = mergeVersionMeta(vanilla, {
      ...fabric,
      arguments: { game: ['--fabric'], jvm: ['-Dfabric=1'] },
    });
    expect(withArgs.arguments?.game).toEqual(['--version', '${version_name}', '--fabric']);
    expect(withArgs.arguments?.jvm).toEqual([
      '-Djava.library.path=${natives_directory}',
      '-Dfabric=1',
    ]);
  });

  it('clears inheritsFrom so the chain is not walked twice', () => {
    expect(merged.inheritsFrom).toBeUndefined();
  });

  it('lets a child replace the legacy argument string wholesale', () => {
    const legacyParent: VersionMeta = {
      ...vanilla,
      minecraftArguments: '--username ${auth_player_name}',
    };
    expect(
      mergeVersionMeta(legacyParent, { minecraftArguments: '--tweakClass x' }).minecraftArguments,
    ).toBe('--tweakClass x');
    expect(mergeVersionMeta(legacyParent, {}).minecraftArguments).toBe(
      '--username ${auth_player_name}',
    );
  });

  it('does not mutate either input', () => {
    const parentBefore = JSON.stringify(vanilla);
    const childBefore = JSON.stringify(fabric);
    mergeVersionMeta(vanilla, fabric);
    expect(JSON.stringify(vanilla)).toBe(parentBefore);
    expect(JSON.stringify(fabric)).toBe(childBefore);
  });
});
