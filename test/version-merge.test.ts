// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import { mergeVersionMeta } from '../src/core/minecraft/version-manifest';
import type { Library, Rule, VersionMeta } from '../src/core/minecraft/types';

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

/**
 * Minecraft 1.16.5 as Mojang serves it, cut down to two LWJGL modules.
 *
 * From 1.13 to 1.18.2 a library with natives is not one entry but up to four
 * under the same name: the macOS build and the build for everything else, and
 * then each of those again with a `natives` map pointing into `classifiers`.
 * Nothing but `rules` tells them apart. The order is the file's own — every jar
 * first, every natives entry after — and the macOS entry leads each pair, which
 * is what made "keep the first one" the worst possible rule.
 */
const jar = (path: string) => ({
  path,
  sha1: 'c'.repeat(40),
  size: 1,
  url: `https://libraries.minecraft.net/${path}`,
});
const OSX_ONLY: Rule[] = [{ action: 'allow', os: { name: 'osx' } }];
const NOT_OSX: Rule[] = [{ action: 'allow' }, { action: 'disallow', os: { name: 'osx' } }];

function lwjglJars(artifact: string): Library[] {
  const dir = `org/lwjgl/${artifact}`;
  return [
    {
      name: `org.lwjgl:${artifact}:3.2.1`,
      downloads: { artifact: jar(`${dir}/3.2.1/${artifact}-3.2.1.jar`) },
      rules: OSX_ONLY,
    },
    {
      name: `org.lwjgl:${artifact}:3.2.2`,
      downloads: { artifact: jar(`${dir}/3.2.2/${artifact}-3.2.2.jar`) },
      rules: NOT_OSX,
    },
  ];
}

function lwjglNatives(artifact: string): Library[] {
  const dir = `org/lwjgl/${artifact}`;
  return [
    {
      name: `org.lwjgl:${artifact}:3.2.1`,
      downloads: {
        artifact: jar(`${dir}/3.2.1/${artifact}-3.2.1.jar`),
        classifiers: { 'natives-macos': jar(`${dir}/3.2.1/${artifact}-3.2.1-natives-macos.jar`) },
      },
      natives: { osx: 'natives-macos' },
      rules: OSX_ONLY,
    },
    {
      name: `org.lwjgl:${artifact}:3.2.2`,
      downloads: {
        artifact: jar(`${dir}/3.2.2/${artifact}-3.2.2.jar`),
        classifiers: {
          'natives-linux': jar(`${dir}/3.2.2/${artifact}-3.2.2-natives-linux.jar`),
          'natives-windows': jar(`${dir}/3.2.2/${artifact}-3.2.2-natives-windows.jar`),
        },
      },
      natives: { linux: 'natives-linux', windows: 'natives-windows' },
      rules: NOT_OSX,
    },
  ];
}

const text2speech = 'com/mojang/text2speech/1.11.3/text2speech-1.11.3';

const vanilla1165: VersionMeta = {
  ...vanilla,
  id: '1.16.5',
  assets: '1.16',
  javaVersion: { component: 'jre-legacy', majorVersion: 8 },
  libraries: [
    {
      name: 'org.apache.logging.log4j:log4j-core:2.8.1',
      downloads: {
        artifact: jar('org/apache/logging/log4j/log4j-core/2.8.1/log4j-core-2.8.1.jar'),
      },
    },
    ...lwjglJars('lwjgl'),
    ...lwjglJars('lwjgl-glfw'),
    ...lwjglNatives('lwjgl'),
    ...lwjglNatives('lwjgl-glfw'),
    { name: 'com.mojang:text2speech:1.11.3', downloads: { artifact: jar(`${text2speech}.jar`) } },
    {
      name: 'com.mojang:text2speech:1.11.3',
      downloads: {
        artifact: jar(`${text2speech}.jar`),
        classifiers: {
          'natives-linux': jar(`${text2speech}-natives-linux.jar`),
          'natives-windows': jar(`${text2speech}-natives-windows.jar`),
        },
      },
      natives: { linux: 'natives-linux', windows: 'natives-windows' },
      extract: { exclude: ['META-INF/'] },
    },
  ],
};

/** Fabric's profile for it: its own libraries, none of them the game's. */
const fabric1165: Partial<VersionMeta> = {
  id: 'fabric-loader-0.19.5-1.16.5',
  inheritsFrom: '1.16.5',
  mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
  libraries: [
    { name: 'org.ow2.asm:asm:9.10.1', url: 'https://maven.fabricmc.net/' },
    { name: 'net.fabricmc:intermediary:1.16.5', url: 'https://maven.fabricmc.net/' },
    { name: 'net.fabricmc:fabric-loader:0.19.5', url: 'https://maven.fabricmc.net/' },
  ],
  arguments: { game: [], jvm: ['-DFabricMcEmu= net.minecraft.client.main.Main '] },
};

describe('mergeVersionMeta on a version that lists a library several times', () => {
  const merged = mergeVersionMeta(vanilla1165, fabric1165);

  it('keeps every entry the parent gives one library, not just the first', () => {
    // The first is the macOS one. Keeping only that left Linux and Windows with
    // no LWJGL at all once the rules had been applied.
    const lwjgl = merged.libraries.filter((l) => l.name.startsWith('org.lwjgl:lwjgl:'));
    expect(lwjgl.map((l) => [l.name, l.rules, l.natives])).toEqual([
      ['org.lwjgl:lwjgl:3.2.1', OSX_ONLY, undefined],
      ['org.lwjgl:lwjgl:3.2.2', NOT_OSX, undefined],
      ['org.lwjgl:lwjgl:3.2.1', OSX_ONLY, { osx: 'natives-macos' }],
      ['org.lwjgl:lwjgl:3.2.2', NOT_OSX, { linux: 'natives-linux', windows: 'natives-windows' }],
    ]);
  });

  it('keeps the natives of every library that has them', () => {
    // The entry with the `natives` map always comes after the plain jar of the
    // same name, so it was the one dropped — on 1.13 to 1.14.3 the jars survived
    // and the game died in LWJGL for want of a `.so`.
    const withNatives = merged.libraries.filter((l) => l.natives?.linux).map((l) => l.name);
    expect(withNatives).toEqual([
      'org.lwjgl:lwjgl:3.2.2',
      'org.lwjgl:lwjgl-glfw:3.2.2',
      'com.mojang:text2speech:1.11.3',
    ]);
  });

  it('adds the loader in front and takes nothing of the parent away', () => {
    expect(merged.libraries.map((l) => l.name)).toEqual([
      ...fabric1165.libraries!.map((l) => l.name),
      ...vanilla1165.libraries.map((l) => l.name),
    ]);
  });

  it('lets the loader replace a library, in every form the parent listed it', () => {
    // Its own log4j replaces the game's one entry; its own LWJGL module means
    // all four of the game's entries for that module go, not just one of them.
    const child: Partial<VersionMeta> = {
      ...fabric1165,
      libraries: [
        { name: 'org.apache.logging.log4j:log4j-core:2.15.0', url: 'https://maven.example/' },
        { name: 'org.lwjgl:lwjgl-glfw:3.3.1', url: 'https://maven.example/' },
      ],
    };
    const names = mergeVersionMeta(vanilla1165, child).libraries.map((l) => l.name);

    expect(names.filter((n) => n.includes(':log4j-core:'))).toEqual([
      'org.apache.logging.log4j:log4j-core:2.15.0',
    ]);
    expect(names.filter((n) => n.startsWith('org.lwjgl:lwjgl-glfw:'))).toEqual([
      'org.lwjgl:lwjgl-glfw:3.3.1',
    ]);
    // The module the loader said nothing about is untouched.
    expect(names.filter((n) => n.startsWith('org.lwjgl:lwjgl:'))).toHaveLength(4);
  });

  it('does not drop a library the loader itself lists twice', () => {
    // A loader profile is free to use the same per-OS shape Mojang does.
    const child: Partial<VersionMeta> = {
      ...fabric1165,
      libraries: [...lwjglJars('lwjgl-openal')],
    };
    const openal = mergeVersionMeta(vanilla1165, child).libraries.filter((l) =>
      l.name.startsWith('org.lwjgl:lwjgl-openal:'),
    );
    expect(openal.map((l) => l.rules)).toEqual([OSX_ONLY, NOT_OSX]);
  });
});
