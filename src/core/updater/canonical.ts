/**
 * The canonical byte form a manifest signature is computed over.
 *
 * This is one half of a cross-repo contract: the other half is
 * `scripts/lib/canonical.mjs` in the raven-packs repo, which signs. The two
 * must produce byte-identical output for every manifest, so this lives on its
 * own — free of Electron and of the verification plumbing around it — and is
 * covered directly by tests.
 */

export interface SignedManifest {
  signature?: string;
  [key: string]: unknown;
}

/**
 * JSON with object keys sorted at *every* level and the `signature` field
 * removed.
 *
 * The sorting has to recurse. An earlier version used
 * `JSON.stringify(rest, Object.keys(rest).sort())`, but passing an array as the
 * second argument makes it a property *allowlist* applied at every nesting
 * level — every entry in `mods[]` serialized as `{}`, so the signature only
 * covered top-level scalars and array lengths. A tampered manifest that swapped
 * every mod for a backdoored jar still verified as "Verified".
 */
export function canonicalize(manifest: SignedManifest): string {
  const { signature: _sig, ...rest } = manifest;

  const sortValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortValue);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((key) => [key, sortValue((value as Record<string, unknown>)[key])]),
      );
    }
    return value;
  };

  return JSON.stringify(sortValue(rest));
}
