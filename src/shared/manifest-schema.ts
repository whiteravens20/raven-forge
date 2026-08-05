import { z } from 'zod';

// ── Mod Manifest JSON Schema (Zod) ───────────────────────
// This schema validates remote manifests fetched from server admins.
// See docs/MANIFEST-SCHEMA.md for the full specification.

// Integrity fields shared by every downloadable entry.
//
// Both are optional but at least one should be present. sha512 exists because
// Modrinth's API returns sha1/sha512 for every file and *not* sha256 — a pack
// generator that can emit sha512 never has to download a jar just to hash it,
// which is what keeps large packs cheap to build.
const integrityFields = {
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
  sha512: z
    .string()
    .regex(/^[0-9a-f]{128}$/i)
    .optional(),
};

export const modEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  source: z.enum(['modrinth', 'curseforge', 'url', 'local']),
  // Modrinth / CurseForge
  projectId: z.string().optional(),
  // Direct URL
  url: z.string().url().optional(),
  // Local file path
  localPath: z.string().optional(),
  /** Exact file to fetch — lets a manifest pin a build without an API lookup. */
  fileName: z.string().optional(),
  ...integrityFields,
  required: z.boolean().default(true),
  side: z.enum(['client', 'server', 'both']).default('client'),
});

export const resourcePackEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().optional(),
  source: z.enum(['modrinth', 'url', 'local']),
  projectId: z.string().optional(),
  url: z.string().url().optional(),
  fileName: z.string().optional(),
  ...integrityFields,
});

export const shaderEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().optional(),
  source: z.enum(['modrinth', 'url', 'local']),
  projectId: z.string().optional(),
  url: z.string().url().optional(),
  fileName: z.string().optional(),
  ...integrityFields,
});

export const configFileEntrySchema = z.object({
  path: z.string().min(1),
  url: z.string().url(),
  ...integrityFields,
});

export const modManifestSchema = z.object({
  manifestVersion: z.literal(2),
  serverName: z.string().min(1),
  minecraftVersion: z.string().min(1),
  modLoader: z.enum(['vanilla', 'forge', 'neoforge', 'fabric', 'quilt']),
  modLoaderVersion: z.string().optional(),
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
export type ConfigFileEntry = z.infer<typeof configFileEntrySchema>;
export type ModManifest = z.infer<typeof modManifestSchema>;
