// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import {
  readsClassesOf,
  startsMinecraft,
  type LoaderEntry,
} from '../src/core/modloader/loader-fit';

/**
 * Which Fabric and Quilt builds are offered for a Minecraft version.
 *
 * Their services list every build for every version, and a build that cannot
 * start the game installs all the same — the failure comes later, in the
 * loader, where the launcher has nothing to say about it. So what is offered
 * has to be right before anything is chosen.
 */

/** A build the way the services describe it: a version, and the ASM it runs on. */
const build = (version: string, asm?: string): LoaderEntry => ({
  loader: { version },
  launcherMeta: {
    libraries: {
      common: [
        { name: 'org.ow2.asm:asm-commons:9.9' },
        ...(asm ? [{ name: `org.ow2.asm:asm:${asm}` }] : []),
        { name: 'net.fabricmc:sponge-mixin:0.15.5+mixin.0.8.7' },
      ],
    },
  },
});

describe('readsClassesOf', () => {
  it('follows what each ASM release reads', () => {
    // Fabric 0.14.19 and 0.14.20, either side of Minecraft 1.20.5's Java 21.
    expect(readsClassesOf('9.4', 21)).toBe(false);
    expect(readsClassesOf('9.5', 21)).toBe(true);
    // And either side of Java 25, which Minecraft 26 is compiled for.
    expect(readsClassesOf('9.7.1', 25)).toBe(false);
    expect(readsClassesOf('9.8', 25)).toBe(true);
  });

  it('reads Java 8 with every ASM a loader has shipped', () => {
    expect(readsClassesOf('7.0', 8)).toBe(true);
  });

  it('takes a release between two it knows as the earlier of them', () => {
    // 8.0 added nothing newer than 7.3.1 reads.
    expect(readsClassesOf('8.0', 15)).toBe(true);
    expect(readsClassesOf('8.0', 16)).toBe(false);
  });

  it('does not hold back an ASM newer than any it knows, or a build that names none', () => {
    expect(readsClassesOf('9.12', 31)).toBe(true);
    expect(readsClassesOf(undefined, 25)).toBe(true);
  });
});

describe('startsMinecraft', () => {
  it('leaves out a Fabric build that cannot read the game’s classes', () => {
    // Started for real: 0.16.13 dies on "Unsupported class file major version
    // 69", 0.16.14 reaches the title screen.
    expect(startsMinecraft('fabric', build('0.16.13', '9.7.1'), '26.3', 25)).toBe(false);
    expect(startsMinecraft('fabric', build('0.16.14', '9.8'), '26.3', 25)).toBe(true);
  });

  it('leaves out a Fabric build older than the oldest that was found to start that release', () => {
    // 1.19.1: 0.14.7 reads its Java and ends in an error window; 0.14.8 starts.
    expect(startsMinecraft('fabric', build('0.14.7', '9.3'), '1.19.1', 17)).toBe(false);
    expect(startsMinecraft('fabric', build('0.14.8', '9.3'), '1.19.1', 17)).toBe(true);
    // 1.19 itself starts on 0.14.0, and 1.18.2 on 0.11.7.
    expect(startsMinecraft('fabric', build('0.14.0', '9.3'), '1.19', 17)).toBe(true);
    expect(startsMinecraft('fabric', build('0.13.3', '9.2'), '1.19', 17)).toBe(false);
    expect(startsMinecraft('fabric', build('0.11.7', '9.1'), '1.18.2', 17)).toBe(true);
    expect(startsMinecraft('fabric', build('0.11.6', '9.1'), '1.18.2', 17)).toBe(false);
  });

  it('keeps every Fabric build since 0.4.0 for the versions that run on Java 8', () => {
    expect(startsMinecraft('fabric', build('0.4.0+build.112', '7.1'), '1.16.5', 8)).toBe(true);
    expect(startsMinecraft('fabric', build('0.3.7.111', '7.0'), '1.16.5', 8)).toBe(false);
    // 1.14 came out on 0.3.x, and still starts on it.
    expect(startsMinecraft('fabric', build('0.3.7.111', '7.0'), '1.14.4', 8)).toBe(true);
  });

  it('leaves out a Quilt build from before it could start a Minecraft without mappings', () => {
    // 0.29.0 reads Java 25 and still asks for an intermediary 26.x does not have.
    expect(startsMinecraft('quilt', build('0.29.0', '9.8'), '26.3', 25)).toBe(false);
    expect(startsMinecraft('quilt', build('0.30.0-beta.3', '9.9'), '26.1', 25)).toBe(false);
    expect(startsMinecraft('quilt', build('0.30.0-beta.4', '9.9'), '26.1', 25)).toBe(true);
    expect(startsMinecraft('quilt', build('0.30.1', '9.10.1'), '26.3', 25)).toBe(true);
  });

  it('leaves out a build whose profile sends for a library over plain http', () => {
    // Fabric 0.3.0.74, as its service lists it for every version from 1.14 up.
    const old: LoaderEntry = {
      loader: { version: '0.3.0.74' },
      launcherMeta: {
        libraries: {
          common: [
            { name: 'org.ow2.asm:asm:7.0', url: 'http://repo.maven.apache.org/maven2/' },
            { name: 'net.fabricmc:tiny-remapper:0.1.0.33', url: 'https://maven.fabricmc.net/' },
          ],
        },
      },
    };

    expect(startsMinecraft('fabric', old, '1.14.4', 8)).toBe(false);
  });

  it('keeps that Quilt build for the versions it does start', () => {
    expect(startsMinecraft('quilt', build('0.29.0', '9.8'), '1.21.11', 21)).toBe(true);
  });

  it('offers Quilt from its first build up to 1.19, and from 0.17.1-beta.2 after it', () => {
    expect(startsMinecraft('quilt', build('0.16.0-beta.1', '9.2'), '1.19', 17)).toBe(true);
    expect(startsMinecraft('quilt', build('0.17.1-beta.1', '9.3'), '1.19.1', 17)).toBe(false);
    expect(startsMinecraft('quilt', build('0.17.1-beta.2', '9.3'), '1.19.1', 17)).toBe(true);
    // A release sorts above its own betas, so 0.17.1 is in as well.
    expect(startsMinecraft('quilt', build('0.17.1', '9.3'), '1.20.1', 17)).toBe(true);
  });

  it('applies the newest floor to a release that came after the table was written', () => {
    expect(startsMinecraft('quilt', build('0.29.0', '9.8'), '27.1', 25)).toBe(false);
    // And to a snapshot of one, which is nearer to it than to anything older.
    expect(startsMinecraft('quilt', build('0.29.0', '9.8'), '26.4-snapshot-3', 25)).toBe(false);
  });

  it('goes by the classes alone for a version whose id says nothing of where it stands', () => {
    expect(startsMinecraft('quilt', build('0.29.0', '9.8'), '25w14a', 25)).toBe(true);
    expect(startsMinecraft('quilt', build('0.28.1', '9.7.1'), '25w14a', 25)).toBe(false);
  });
});
