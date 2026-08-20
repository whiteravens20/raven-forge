import { z } from 'zod';

// ── Mod Manifest JSON Schema (Zod) ───────────────────────
// This schema validates remote manifests fetched from server admins.
// See docs/MANIFEST-SCHEMA.md for the full specification.

// Integrity fields shared by every downloadable entry.
//
// All three are optional but at least one should be present. sha512 exists
// because Modrinth's API returns sha1/sha512 for every file and *not* sha256 —
// a pack generator that can emit sha512 never has to download a jar just to
// hash it, which is what keeps large packs cheap to build.
//
// sha1 is the floor, and it is here because `.mrpack` publishes it: a pack
// imported from Modrinth carries a sha1 for every file, and dropping it on the
// way in left those entries with the weaker claim of "no hash at all". Weak
// against a deliberate collision, but it still pins the file against a swapped
// CDN object. `expectedHash` always prefers the strongest one present.
const integrityFields = {
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
  sha512: z
    .string()
    .regex(/^[0-9a-f]{128}$/i)
    .optional(),
  sha1: z
    .string()
    .regex(/^[0-9a-f]{40}$/i)
    .optional(),
};

/**
 * True when a string names a file and nothing else about where it goes.
 *
 * A manifest entry says *what* to fetch; the launcher decides *where* it lands.
 * Without this, `fileName: "../../../../.bashrc"` reached `path.join(modsDir,
 * …)` and a manifest could write attacker-controlled bytes anywhere the
 * launcher can reach. Both separators are rejected on every platform, not just
 * the one the check is running on: `path.join` treats `\` as a separator on
 * Windows, and a manifest is not authored per-platform.
 *
 * Rejected rather than sanitized, on the same reasoning as `safeRelativePath`
 * in the `.mrpack` reader — stripping the `../` turns an escape attempt into a
 * silent write somewhere else, which is a worse outcome than refusing.
 */
export function isSafeFileName(value: string): boolean {
  if (value === '' || value === '.' || value === '..') return false;
  return !/[/\\\0]/.test(value);
}

/**
 * The name to save an entry under when it did not supply one.
 *
 * Taken from the URL, and only if what comes out is a bare filename; otherwise
 * the entry's id, reduced to characters that cannot mean anything to a path.
 *
 * `path.basename(new URL(url).pathname)` was doing this job and has two faults.
 * It returns `''` for a URL ending in a slash — and `path.join(dir, '')` is the
 * directory itself, so such a URL silently targeted `mods/` rather than a file
 * in it. And the `?? \`${id}.jar\`` guard behind it could never fire, because
 * `path.basename` returns a string and never null or undefined.
 */
export function fileNameFromUrl(url: string, fallbackId: string, extension: string): string {
  const last = new URL(url).pathname.split('/').pop() ?? '';
  let decoded = last;
  try {
    // A percent-encoded separator decodes to a real one, which the check below
    // then rejects — which is the point of decoding before checking.
    decoded = decodeURIComponent(last);
  } catch {
    /* malformed escape — judge the raw form */
  }
  if (isSafeFileName(decoded)) return decoded;

  return `${fallbackId.replace(/[^a-zA-Z0-9._-]/g, '_')}${extension}`;
}

/** Exact file to fetch — lets a manifest pin a build without an API lookup. */
const fileNameField = z
  .string()
  .refine(isSafeFileName, {
    message: 'fileName must be a bare filename, with no path separators',
  })
  .optional();

export const modEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  source: z.enum(['modrinth', 'url', 'local']),
  // Modrinth
  projectId: z.string().optional(),
  // Direct URL
  url: z.string().url().optional(),
  // Local file path
  localPath: z.string().optional(),
  fileName: fileNameField,
  ...integrityFields,
  required: z.boolean().default(true),
  side: z.enum(['client', 'server', 'both']).default('client'),
});

const resourcePackEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().optional(),
  source: z.enum(['modrinth', 'url', 'local']),
  projectId: z.string().optional(),
  url: z.string().url().optional(),
  fileName: fileNameField,
  ...integrityFields,
});

const shaderEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().optional(),
  source: z.enum(['modrinth', 'url', 'local']),
  projectId: z.string().optional(),
  url: z.string().url().optional(),
  fileName: fileNameField,
  ...integrityFields,
});

const configFileEntrySchema = z.object({
  path: z.string().min(1),
  url: z.string().url(),
  ...integrityFields,
});

export const modManifestSchema = z.object({
  manifestVersion: z.literal(2),
  serverName: z.string().min(1),
  // Same rule as the profile's: it reaches the filesystem as a path component.
  minecraftVersion: z.string().refine(isSafeFileName, {
    message: 'minecraftVersion must be a plain version id',
  }),
  modLoader: z.enum(['vanilla', 'forge', 'neoforge', 'fabric', 'quilt']),
  // And so does this one, which the line above it had and this one had not:
  // `loaderInstallDir`, the Fabric and Quilt cache directories and
  // `getLoaderProfilePath` all build a path out of it, and the last of those is
  // then read back and parsed as version metadata — which is what supplies
  // `mainClass` and the JVM arguments.
  modLoaderVersion: z
    .string()
    .refine(isSafeFileName, { message: 'modLoaderVersion must be a plain version id' })
    .optional(),
  /**
   * What the pack author says this pack needs, in MB. Used only when the
   * profile is first created — a later sync must not overwrite a number the
   * player has since chosen for themselves. Bounded because it is written by
   * whoever wrote the manifest and ends up on a `-Xmx` line.
   */
  recommendedRamMb: z.number().int().min(512).max(65536).optional(),
  mods: z.array(modEntrySchema).default([]),
  resourcePacks: z.array(resourcePackEntrySchema).default([]),
  shaders: z.array(shaderEntrySchema).default([]),
  configFiles: z.array(configFileEntrySchema).default([]),
  // Optional Ed25519 signature (base64-encoded)
  signature: z.string().optional(),
});

// ── TypeScript types derived from Zod schemas ─────────────
export type ModEntry = z.infer<typeof modEntrySchema>;
export type ResourcePackEntry = z.infer<typeof resourcePackEntrySchema>;
export type ShaderEntry = z.infer<typeof shaderEntrySchema>;
export type ModManifest = z.infer<typeof modManifestSchema>;
