// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

/**
 * Which builds of Fabric and Quilt start which Minecraft version.
 *
 * Neither loader says. Asked for the builds for one Minecraft version, their
 * metadata services answer with every build there has ever been — 253 of Fabric
 * and 307 of Quilt, the same list for 1.14 as for 26.3 — and a profile is
 * served for any pair. Most pairs do not start: of the 253 Fabric builds listed
 * for 26.3, 18 do. Offered to choose from, the rest were profiles that
 * installed without a word and then died in the loader, some of them behind an
 * error window of the loader's own that left the launcher showing a game in
 * progress.
 *
 * Forge and NeoForge need none of this: a build of theirs is made for one
 * Minecraft version and is listed under it.
 *
 * Three things decide it here, and a build has to pass all of them.
 */

import { isReleaseAtLeast } from '../../shared/minecraft-version';
import { compareLoaderVersionsDesc } from '../../shared/loader-version';

export type MetaLoader = 'fabric' | 'quilt';

/** As much of a metadata entry as says which libraries the build runs on. */
export interface LoaderEntry {
  loader: { version: string; stable?: boolean };
  launcherMeta?: {
    libraries?: Partial<Record<'common' | 'client', Array<{ name?: string; url?: string }>>>;
  };
}

/** The libraries a build puts on the game's classpath. */
function librariesOf(entry: LoaderEntry): Array<{ name?: string; url?: string }> {
  const { common = [], client = [] } = entry.launcherMeta?.libraries ?? {};
  return [...common, ...client];
}

// ── What the loader can read ───────────────────────────────

/**
 * The newest Java whose class files each ASM release reads, from its own
 * `Opcodes`: the highest `V<n>` constant in the jar of that release. These are
 * the releases the two loaders have shipped; one between two rows reads what
 * the earlier row does.
 *
 * A loader reads the game's classes before it starts the game — to find out
 * which version it has been given, and to remap it — and it does so with the
 * ASM its profile lists. A class file newer than that ASM knows of is refused
 * with "Unsupported class file major version", and that is the end of the
 * launch. So a build whose ASM stops short of the Java a Minecraft version is
 * compiled for cannot start it, and that much can be read off what the two
 * services publish, with nothing here to keep up to date as loaders move on.
 */
const ASM_READS_JAVA: ReadonlyArray<readonly [asm: string, java: number]> = [
  ['7.0', 12],
  ['7.1', 13],
  ['7.2', 14],
  ['7.3.1', 15],
  ['9.0', 16],
  ['9.1', 17],
  ['9.2', 18],
  ['9.3', 19],
  ['9.4', 20],
  ['9.5', 21],
  ['9.6', 22],
  ['9.7.1', 24],
  ['9.8', 25],
  ['9.9', 26],
  ['9.10.1', 27],
];

const ASM = 'org.ow2.asm:asm:';

/** The ASM a build's profile puts on the classpath, when it names one. */
function asmOf(entry: LoaderEntry): string | undefined {
  return librariesOf(entry)
    .find((library) => library.name?.startsWith(ASM))
    ?.name?.slice(ASM.length);
}

/**
 * Whether an ASM release reads the class files of a Java version.
 *
 * An ASM newer than any in the table reads whatever it is asked about: the
 * table says what the old ones cannot do, not what the next one will. A build
 * that names no ASM at all is given the benefit of the doubt for the same
 * reason — this is here to take out what is known not to work.
 */
export function readsClassesOf(asm: string | undefined, java: number): boolean {
  if (!asm) return true;
  const [newest] = ASM_READS_JAVA[ASM_READS_JAVA.length - 1];
  if (compareLoaderVersionsDesc(asm, newest) < 0) return true;
  // The last row that is not newer than this ASM; the rows are oldest first.
  const row = ASM_READS_JAVA.findLast(([release]) => compareLoaderVersionsDesc(asm, release) <= 0);
  return row !== undefined && row[1] >= java;
}

// ── What the launcher will fetch ───────────────────────────

/**
 * Whether a build's profile sends for a library over plain http.
 *
 * Fabric's 27 oldest builds do, the ones from before Minecraft 1.14 was out. A
 * library goes straight onto the game's classpath and is fetched over https or
 * not at all, so such a build installs only on a machine that happens to hold
 * its libraries already — which is how one of them once passed for working
 * here.
 */
function namesPlainHttp(entry: LoaderEntry): boolean {
  return librariesOf(entry).some((library) => library.url?.startsWith('http://'));
}

// ── What was found by starting the game ────────────────────

/**
 * From each Minecraft release named, the oldest build that starts it.
 *
 * The two rules above take out most of what cannot work and not all of it: a
 * build can read the game's classes, fetch every library, and still not start
 * the game. Nothing published says which, so these were found the only way
 * there is — by starting the game. Every release each loader lists was started
 * with the oldest build still offered for it, 48 of them for Fabric and 44 for
 * Quilt, and where that build failed the first one that works was searched
 * for. These are the releases where that moved the floor past the rules:
 *
 * - Fabric 0.4.0 is the first to apply its own patches to 1.15.
 * - 1.18 needs 0.11.7, though 0.11.2 already reads its Java.
 * - From 1.19 the game ships an LWJGL with a class for Java 19 in it, which
 *   stops every Fabric before 0.14.0 in its remapper.
 * - 1.19.1 needs Fabric 0.14.8 and Quilt 0.17.1-beta.2; an older one of
 *   either ends in an error window of its own.
 * - Quilt before 0.30.0-beta.4 asks for the mappings that a Minecraft shipped
 *   unobfuscated — 26.1 and later — does not have.
 *
 * A row holds until the next row's release, and the last one for everything
 * after it. That is deliberate in both directions: nothing older has been
 * tried on a later release, so nothing older is offered for one; and a release
 * that comes out after this was written keeps the newest floor until somebody
 * has started it with less.
 */
const FIRST_STARTING: Record<MetaLoader, ReadonlyArray<readonly [from: string, build: string]>> = {
  fabric: [
    ['1.15', '0.4.0+build.112'],
    ['1.18', '0.11.7'],
    ['1.19', '0.14.0'],
    ['1.19.1', '0.14.8'],
  ],
  quilt: [
    ['1.19.1', '0.17.1-beta.2'],
    ['26.1', '0.30.0-beta.4'],
  ],
};

/** The measured floor for a Minecraft version, when it is one the table can place. */
function firstStarting(loader: MetaLoader, mcVersion: string): string | undefined {
  return FIRST_STARTING[loader].findLast(([from]) => isReleaseAtLeast(mcVersion, from))?.[1];
}

/**
 * Whether a build of a loader starts a Minecraft version, as far as can be
 * told without starting it.
 */
export function startsMinecraft(
  loader: MetaLoader,
  entry: LoaderEntry,
  mcVersion: string,
  java: number,
): boolean {
  if (!readsClassesOf(asmOf(entry), java) || namesPlainHttp(entry)) return false;
  const floor = firstStarting(loader, mcVersion);
  return !floor || compareLoaderVersionsDesc(entry.loader.version, floor) <= 0;
}
