/**
 * Display names for Modrinth's tag vocabulary.
 *
 * The API speaks lowercase kebab-case (`game-mechanics`, `neoforge`, `8x-`),
 * which is right for a facet key and wrong in a dropdown sitting next to
 * sentence-cased labels. These are Modrinth's terms, not ours, so they are
 * capitalised rather than translated — the same words appear on Modrinth's own
 * site, and a Polish rendering of `vanilla-like` would only make a search
 * result harder to match up with its source.
 */

/** Only where the mechanical rule gets it wrong. */
const SPECIAL: Record<string, string> = {
  neoforge: 'NeoForge',
  optifine: 'OptiFine',
  pbr: 'PBR',
  gui: 'GUI',
  worldgen: 'World generation',
};

/**
 * `game-mechanics` → `Game mechanics`, `neoforge` → `NeoForge`, `8x-` → `8x-`.
 *
 * Only hyphens *between* word characters become spaces, which is what keeps the
 * resolution tags (`512x+`, `8x-`) intact — there the trailing punctuation is
 * the meaning, not a word break.
 */
export function tagLabel(name: string): string {
  const special = SPECIAL[name];
  if (special) return special;

  const spaced = name.replace(/(?<=\w)-(?=\w)/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * A mod loader as its makers write it: `fabric` → `Fabric`, `neoforge` →
 * `NeoForge`.
 *
 * Stored lowercase because that is what Modrinth's facets and the loader APIs
 * expect, and these are proper names — printing `neoforge` next to a version
 * number reads like a field key that leaked into the interface. Same vocabulary
 * as Modrinth's loader facet, so the same rules apply.
 */
export function loaderLabel(loader: string): string {
  return tagLabel(loader);
}
