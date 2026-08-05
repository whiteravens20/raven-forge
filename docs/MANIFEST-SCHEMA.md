# Server Mod Manifest — Schema v2

Server admins publish a JSON manifest at a stable HTTP/HTTPS URL. The launcher fetches it, validates it against the [Zod schema](../src/shared/manifest-schema.ts), optionally verifies its Ed25519 signature, and reconciles the listed mods/shaders/resource packs against the per-profile `installed.lock`.

## Top-level shape

```json
{
  "manifestVersion": 2,
  "serverName": "string (required)",
  "minecraftVersion": "1.20.4",
  "modLoader": "fabric | quilt | forge | neoforge | vanilla",
  "modLoaderVersion": "0.15.7",
  "mods": [],
  "resourcePacks": [],
  "shaders": [],
  "configFiles": [],
  "signature": "base64 Ed25519 signature (optional)"
}
```

## `mods[]` entries

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Stable identifier — match across versions to enable update detection. |
| `name` | string | yes | Display name. |
| `version` | string | yes | Free-form version label, recorded in `installed.lock`. |
| `source` | `"modrinth" \| "curseforge" \| "url" \| "local"` | yes | Provenance. Also selects the resolver when no `url` is given. |
| `url` | string (URL) | recommended | Direct download URL. **When present the launcher skips resolution entirely** — see below. |
| `fileName` | string | no | Exact filename to write. Defaults to the last path segment of `url`. |
| `projectId` | string | when source = modrinth/curseforge and no `url` | Remote project identifier, resolved against `version` at sync time. |
| `localPath` | string | when source = local | Absolute path on the player's machine — niche, used for LAN / offline. |
| `sha512` | string (128 hex) | recommended | Preferred integrity check. |
| `sha256` | string (64 hex) | alternative | Used when `sha512` is absent. |
| `required` | boolean | default `true` | If `false`, the launcher installs but the user can disable. |
| `side` | `"client" \| "server" \| "both"` | default `"client"` | `server`-only entries are skipped when syncing a client profile. |

### Integrity

At least one of `sha512` / `sha256` should be present; **`sha512` wins when both
are.** The asymmetry is deliberate: Modrinth's API returns `sha1` and `sha512`
but never `sha256`, so a manifest generator that can publish `sha512` never has
to download a jar purely to hash it. That is what makes large packs cheap to
build. An entry with neither hash is accepted without verification.

`installed.lock` always records `sha256` locally, whichever algorithm the
manifest used.

### Resolution and the `url` fast path

An entry carrying `url` is fetched directly — no Modrinth lookup, for any
`source`. Publishing `url` + `fileName` + `sha512` means syncing a 100-mod pack
costs **zero API requests** and keeps working while Modrinth is unreachable.
Setting `source: "modrinth"` alongside `url` is still worthwhile: it preserves
provenance for the UI.

Without `url`, a `modrinth` entry resolves `projectId` through the API and
matches `version` against `version_number` first, then the opaque version `id`.

A `curseforge` entry resolves the same way — `projectId` is the numeric mod id,
and `version` is matched against the numeric file id first, then the file's
display name. Two things differ from Modrinth and matter when publishing:

- **It needs a key the player supplies.** CurseForge issues API keys per
  developer, so the launcher cannot ship one; a pack whose entries resolve
  through CurseForge will not sync for anyone who has not set a key under
  Settings. Publishing `url` + `sha512` avoids the problem entirely.
- **CurseForge publishes no hash stronger than SHA-1.** When a `curseforge`
  entry carries no `sha512`/`sha256` of its own, that SHA-1 is what the download
  is verified against — better than nothing, but a manifest hash is both stronger
  and covered by the manifest signature. Publish one.

Some projects also have third-party downloads disabled by their author. Those
files appear in the API with a null download URL and cannot be fetched by any
launcher; the sync fails with a message saying so.

## `resourcePacks[]` and `shaders[]` entries

Same shape — `id`, `name`, optional `version`, `source` (`modrinth | url | local`), optional `projectId` / `url` / `fileName`, optional `sha512` / `sha256`. Side is always client. The `url` fast path applies here too.

## `configFiles[]` entries

```json
{
  "path": "config/mymod.toml",
  "url": "https://server.com/configs/mymod.toml",
  "sha256": "abc123..."
}
```

Paths are resolved relative to the profile's `.minecraft` directory. The launcher overwrites the file on every sync if the hash does not match.

## Signing

The optional `signature` is the base64-encoded Ed25519 signature of the **canonicalized** manifest. The launcher verifies it against the user's `Settings → Trusted Keys` list. Unsigned manifests are accepted but flagged "Unverified" in the UI.

### Canonical form

The signed byte string is the manifest serialized as JSON with:

1. the `signature` field removed,
2. object keys sorted **at every nesting level** (not just the top level),
3. array order preserved,
4. no insignificant whitespace.

The recursion is load-bearing. An earlier implementation used
`JSON.stringify(rest, Object.keys(rest).sort())`; passing an array as the second
argument makes it a property *allowlist* applied at every level, so every entry
in `mods[]` serialized as `{}` and the signature covered only top-level scalars
plus array lengths — a tampered manifest that swapped every mod for a backdoored
jar still verified. See `canonicalize()` in
[`src/core/updater/manifest-verify.ts`](../src/core/updater/manifest-verify.ts).

### Producing a signature

Signing tools live in the [raven-packs](https://github.com/whiteravens20/raven-packs)
repository, which builds manifests in this format:

```bash
node scripts/keygen.mjs mykey                              # keys/mykey.{key,pub}
node scripts/sign.mjs dist/<slug>/manifest.json keys/mykey.key
```

`scripts/lib/canonical.mjs` there must stay byte-identical to `canonicalize()` here.

## Example

```json
{
  "manifestVersion": 2,
  "serverName": "Raven SMP",
  "minecraftVersion": "1.21.4",
  "modLoader": "fabric",
  "modLoaderVersion": "0.16.10",
  "mods": [
    {
      "id": "sodium",
      "name": "Sodium",
      "version": "0.6.5",
      "source": "modrinth",
      "projectId": "AANobbMI",
      "required": true,
      "side": "client"
    },
    {
      "id": "raven-rules",
      "name": "Raven Server Rules",
      "version": "1.0.0",
      "source": "url",
      "url": "https://files.ravensmp.com/mods/raven-rules-1.0.0.jar",
      "sha256": "9f1c...",
      "required": true,
      "side": "client"
    }
  ],
  "resourcePacks": [],
  "shaders": [],
  "configFiles": [
    {
      "path": "config/raven-rules.toml",
      "url": "https://files.ravensmp.com/configs/raven-rules.toml",
      "sha256": "44a1..."
    }
  ],
  "signature": "MEUCIQDhX..."
}
```
