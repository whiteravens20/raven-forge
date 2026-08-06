import { z } from 'zod';
import { log } from '../../main/logger';
import { WHITE_RAVENS_PACKS_URL } from '../../shared/branding';
import { readJsonCapped } from '../net/json';
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
  generatedAt: z.string().optional(),
  packs: z.array(
    z.object({
      slug: z.string().min(1),
      name: z.string().min(1),
      version: z.string(),
      summary: z.string().default(''),
      minecraft: z.string().min(1),
      loader: z.object({ type: z.string(), version: z.string().optional() }),
      recommendedRamMb: z.number().optional(),
      server: z.object({ ip: z.string(), port: z.number().optional() }).nullable().optional(),
      counts: z
        .object({ mods: z.number(), resourcePacks: z.number(), shaders: z.number() })
        .partial()
        .optional(),
      totalDownloadBytes: z.number().optional(),
      // Null when the catalogue was built without PACK_BASE_URL. A pack with no
      // manifest cannot be installed, so it is dropped rather than listed as
      // something that fails on click.
      manifestUrl: z.string().url().nullable().optional(),
      mrpackUrl: z.string().url().nullable().optional(),
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

  const parsed = catalogueSchema.safeParse(await readJsonCapped(res, 'The pack catalogue'));
  if (!parsed.success) {
    throw new Error(
      'it is malformed — ' +
        parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; '),
    );
  }

  const packs = parsed.data.packs.filter((pack) => Boolean(pack.manifestUrl));
  const dropped = parsed.data.packs.length - packs.length;
  if (dropped > 0) log.warn(`${dropped} pack(s) in the catalogue carry no manifest URL`);

  return packs.map((pack) => ({
    slug: pack.slug,
    name: pack.name,
    version: pack.version,
    summary: pack.summary,
    minecraftVersion: pack.minecraft,
    modLoader: pack.loader.type,
    recommendedRamMb: pack.recommendedRamMb,
    serverIp: pack.server?.ip,
    modCount: pack.counts?.mods ?? 0,
    totalDownloadBytes: pack.totalDownloadBytes ?? 0,
    manifestUrl: pack.manifestUrl!,
  }));
}
