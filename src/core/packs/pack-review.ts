// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { isFirstPartyManifestUrl } from '../../shared/branding';
import { MODRINTH_CDN_FILE } from '../../shared/constants';
import { modManifestSchema } from '../../shared/manifest-schema';
import { getSettings } from '../config/settings-manager';
import { versionsByHash } from '../mods/modrinth-api';
import { verifyManifestSignature } from '../updater/manifest-verify';
import type { SignedManifest } from '../updater/canonical';
import { log } from '../../main/logger';
import type { UnknownPackFile } from '../../shared/ipc-types';
import { hashOverrides, type MrpackContents } from './mrpack';

/**
 * What a pack from a file or a link brings that nobody has looked at.
 *
 * A mod is a program, and a pack is somebody's list of programs. Modrinth reviews
 * what it publishes, so what comes from there, or is byte for byte what it
 * published, has been seen by someone. The rest could be anything, and a pack
 * can carry it inside itself or fetch it from any address, so the player is shown
 * it first and decides. A pack found through the launcher's own search and one
 * from the White Ravens catalogue are not asked about: neither is something a
 * stranger handed over.
 *
 * Only what runs is listed. A config or a texture from another host is no more
 * than that, and a list that ran to all of them would not be read.
 */

/** Anything in the folders the game loads code from, and a jar wherever it is. */
const CODE_FILE = /^(?:(?:mods|coremods)\/.+\.(?:jar|zip|litemod)|.+\.jar)$/i;

/** What Modrinth is asked about, and how it is named when it does not know it. */
interface Candidate extends UnknownPackFile {
  sha512?: string;
}

export interface ReviewFindings {
  unknown: UnknownPackFile[];
  /** Modrinth could not be asked, so everything was listed unrecognised. */
  unchecked: boolean;
}

function hostOf(url: string): string {
  return URL.canParse(url) ? new URL(url).host : url;
}

/** One that came from somewhere: identified by its hash, or by where it comes from. */
function fetched(where: string, url: string, sha512?: string): Candidate {
  return { path: where, from: hostOf(url), key: sha512 ?? `${where} ${url}`, sha512 };
}

/** Modrinth is asked by hash, so a jar it published is recognised wherever it comes from. */
async function whatModrinthDoesNotKnow(candidates: Candidate[]): Promise<ReviewFindings> {
  const hashes = candidates.flatMap((file) => (file.sha512 ? [file.sha512] : []));
  if (hashes.length === 0) {
    return { unknown: candidates.map(withoutHash), unchecked: false };
  }

  let known: ReadonlyMap<string, unknown>;
  try {
    known = await versionsByHash(hashes);
  } catch (err) {
    log.warn(`Could not ask Modrinth about the files of a pack: ${String(err)}`);
    return { unknown: candidates.map(withoutHash), unchecked: true };
  }
  return {
    unknown: candidates.filter((file) => !file.sha512 || !known.has(file.sha512)).map(withoutHash),
    unchecked: false,
  };
}

function withoutHash({ path, from, key }: Candidate): UnknownPackFile {
  return { path, from, key };
}

/** A `.mrpack`: what it carries inside itself, and what it fetches from elsewhere. */
export async function reviewMrpack(
  packFile: string,
  pack: MrpackContents,
): Promise<ReviewFindings> {
  // A file the index also names is the index's: that copy is the one that stays.
  const indexed = new Set(pack.files.map((file) => file.path.toLowerCase()));
  const inside = pack.overrides.filter(
    (override) => CODE_FILE.test(override.path) && !indexed.has(override.path.toLowerCase()),
  );
  const hashes = await hashOverrides(packFile, inside);

  return whatModrinthDoesNotKnow([
    ...inside.map((override): Candidate => {
      const sha512 = hashes.get(override.entry);
      return { path: override.path, from: null, key: sha512 ?? override.path, sha512 };
    }),
    ...pack.files
      .filter((file) => CODE_FILE.test(file.path) && !MODRINTH_CDN_FILE.test(file.downloads[0]))
      .map((file) => fetched(file.path, file.downloads[0], file.hashes.sha512)),
  ]);
}

/**
 * A manifest at an address the player pasted.
 *
 * One signed by a key they trust has somebody answerable behind it, which is what
 * the keys are for. The raw parsed JSON is what was signed: see
 * `verifyManifestSignature`.
 */
export async function reviewManifest(raw: unknown, url: string): Promise<ReviewFindings> {
  // The sync refuses it a moment later, and says why better than this could.
  const parsed = modManifestSchema.safeParse(raw);
  if (!parsed.success) return { unknown: [], unchecked: false };

  const { trustedPublicKeys } = await getSettings();
  const verification = verifyManifestSignature(
    raw as SignedManifest,
    trustedPublicKeys,
    isFirstPartyManifestUrl(url),
  );
  if (verification.valid) return { unknown: [], unchecked: false };

  const { mods, configFiles } = parsed.data;
  return whatModrinthDoesNotKnow([
    ...mods.flatMap((mod) =>
      mod.side !== 'server' && mod.source === 'url' && mod.url && !MODRINTH_CDN_FILE.test(mod.url)
        ? [fetched(`mods/${mod.fileName ?? mod.name}`, mod.url, mod.sha512)]
        : [],
    ),
    ...configFiles.flatMap((file) =>
      CODE_FILE.test(file.path) && !MODRINTH_CDN_FILE.test(file.url)
        ? [fetched(file.path, file.url, file.sha512)]
        : [],
    ),
  ]);
}

/** Whether something on the list is news to the player. */
export function needsAsking(findings: ReviewFindings, accepted: readonly string[]): boolean {
  return findings.unknown.some((file) => !accepted.includes(file.key));
}
