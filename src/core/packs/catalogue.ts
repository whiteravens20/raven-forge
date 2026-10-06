// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { z } from 'zod';
import { log } from '../../main/logger';
import { WHITE_RAVENS_PACKS_URL, isFirstPartyManifestUrl } from '../../shared/branding';
import { assertSecureAnswer, readJsonCapped } from '../net/json';
import type { CataloguePack } from '../../shared/ipc-types';

/**
 * The White Ravens pack catalogue.
 *
 * Fetched from a URL compiled into the launcher rather than one the player can
 * set. The catalogue decides which manifest URLs the launcher offers to create
 * profiles from, so a settable address would be a way to point somebody at
 * arbitrary manifests through a screen that says "White Ravens" on it. A player
 * who wants a different pack has the manifest-URL and `.mrpack` routes, where it
 * is their own address and it looks like it.
 */

const catalogueSchema = z.object({
  indexVersion: z.literal(1),
  // Only what the picker shows is named. A field of the wrong type refuses the
  // whole catalogue, so every one listed here that nothing reads is a way for
  // a harmless change on the packs site to empty the list in every launcher.
  packs: z.array(
    z.object({
      slug: z.string().min(1),
      name: z.string().min(1),
      version: z.string(),
      summary: z.string().default(''),
      // Optional, and `summary` stays required-with-a-default beside it. The
      // two exist together because this schema rejects the whole catalogue on
      // a field of the wrong type — a published map where a string was would
      // empty the pack list for every launcher already installed, so the flat
      // field is the one that can never change shape.
      summaryI18n: z.record(z.string(), z.string()).optional(),
      minecraft: z.string().min(1),
      loader: z.object({ type: z.string() }),
      counts: z.object({ mods: z.number() }).partial().optional(),
      totalDownloadBytes: z.number().optional(),
      // Null when the catalogue was built without PACK_BASE_URL. A pack with no
      // manifest cannot be installed, so it is dropped rather than listed as
      // something that fails on click.
      manifestUrl: z.string().url().nullable().optional(),
    }),
  ),
});

/** Every pack White Ravens publishes that can actually be installed. */
export async function listCataloguePacks(): Promise<CataloguePack[]> {
  const res = await fetch(WHITE_RAVENS_PACKS_URL, { signal: AbortSignal.timeout(15000) });
  // Phrased to complete the caller's sentence rather than restate it — the IPC
  // layer already prefixes "Could not load the pack list", and saying it twice
  // is how an error message stops being read.
  if (!res.ok) {
    throw new Error(`the server answered ${res.status} ${res.statusText}`);
  }
  assertSecureAnswer(res);

  const parsed = catalogueSchema.safeParse(await readJsonCapped(res, 'The pack catalogue'));
  if (!parsed.success) {
    throw new Error(
      'it is malformed — ' +
        parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; '),
    );
  }

  const listed = parsed.data.packs.filter((pack) => Boolean(pack.manifestUrl));
  const dropped = parsed.data.packs.length - listed.length;
  if (dropped > 0) log.warn(`${dropped} pack(s) in the catalogue carry no manifest URL`);

  // Only a manifest on the White Ravens packs site. The picker offers these as
  // White Ravens' own, and what makes that true of a pack is the built-in key —
  // which is only demanded of a first-party address. The catalogue itself is
  // not signed: whoever could change that one file, without the key, could
  // otherwise list a manifest of their own under the White Ravens heading and
  // have it installed with no signature asked for.
  const packs = listed.filter((pack) => isFirstPartyManifestUrl(pack.manifestUrl!));
  const foreign = listed.length - packs.length;
  if (foreign > 0) {
    log.warn(`${foreign} pack(s) in the catalogue point outside the White Ravens packs site`);
  }

  return packs.map((pack) => ({
    slug: pack.slug,
    name: pack.name,
    version: pack.version,
    summary: pack.summary,
    summaryI18n: pack.summaryI18n,
    minecraftVersion: pack.minecraft,
    modLoader: pack.loader.type,
    modCount: pack.counts?.mods ?? 0,
    totalDownloadBytes: pack.totalDownloadBytes ?? 0,
    manifestUrl: pack.manifestUrl!,
  }));
}
