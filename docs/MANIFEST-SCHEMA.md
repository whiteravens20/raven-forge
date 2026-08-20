# Server Mod Manifest — Schema v2

Server admins publish a JSON manifest at a stable HTTP/HTTPS URL. The launcher fetches it, validates it against the [Zod schema](../src/shared/manifest-schema.ts), checks its Ed25519 signature, and reconciles the listed mods/shaders/resource packs against the per-profile `installed.lock`.

## Top-level shape

```json
{
  "manifestVersion": 2,
  "serverName": "string (required)",
  "minecraftVersion": "1.20.4",
  "modLoader": "fabric | quilt | forge | neoforge | vanilla",
  "modLoaderVersion": "0.15.7",
  "recommendedRamMb": 6144,
  "mods": [],
  "resourcePacks": [],
  "shaders": [],
  "configFiles": [],
  "signature": "base64 Ed25519 signature (optional)"
}
```

`recommendedRamMb` is optional and bounded to 512–65536. It is applied **only
when the profile is created**, so a later sync never overwrites a figure the
player has since chosen; a manifest without one leaves the launcher's own
default alone.

## `mods[]` entries

| Field       | Type                             | Required                            | Notes                                                                                                                                                                                                |
| ----------- | -------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | string                           | yes                                 | Stable identifier — match across versions to enable update detection.                                                                                                                                |
| `name`      | string                           | yes                                 | Display name.                                                                                                                                                                                        |
| `version`   | string                           | yes                                 | Free-form version label, recorded in `installed.lock`.                                                                                                                                               |
| `source`    | `"modrinth" \| "url" \| "local"` | yes                                 | Provenance. Also selects the resolver when no `url` is given.                                                                                                                                        |
| `url`       | string (URL)                     | recommended                         | Direct download URL. **When present the launcher skips resolution entirely** — see below.                                                                                                            |
| `fileName`  | string                           | no                                  | Exact filename to write — a bare name, with no `/`, `\\` or path segments. Defaults to the last path segment of `url`. A value carrying a path is rejected outright, and the whole manifest with it. |
| `projectId` | string                           | when source = modrinth and no `url` | Modrinth project identifier, resolved against `version` at sync time.                                                                                                                                |
| `localPath` | string                           | when source = local                 | Absolute path on the player's machine — niche, used for LAN / offline.                                                                                                                               |
| `sha512`    | string (128 hex)                 | recommended                         | Preferred integrity check.                                                                                                                                                                           |
| `sha256`    | string (64 hex)                  | alternative                         | Used when `sha512` is absent.                                                                                                                                                                        |
| `required`  | boolean                          | default `true`                      | If `false`, the launcher installs but the user can disable.                                                                                                                                          |
| `side`      | `"client" \| "server" \| "both"` | default `"client"`                  | `server`-only entries are skipped when syncing a client profile.                                                                                                                                     |

### Integrity

At least one of `sha512` / `sha256` / `sha1` should be present; the **strongest
one present wins**, in that order. The asymmetry is deliberate: Modrinth's API
returns `sha1` and `sha512` but never `sha256`, so a manifest generator that can
publish `sha512` never has to download a jar purely to hash it. That is what
makes large packs cheap to build. `sha1` is the floor, and exists because a
`.mrpack` publishes it for every file. An entry with none of the three is
accepted **without verification** — the launcher does not invent a hash to check
against.

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

**There is no `curseforge` source.** CurseForge's API key is issued per
developer after a manual application and its terms make the key
non-transferable, so it can neither be shipped nor asked of a player; since
16 July 2026 its CDN rejects unauthenticated downloads too. A CurseForge-hosted
file therefore cannot be resolved from a manifest at all — not even as
`source: "url"`, because that URL is on the same authenticated CDN. Publish the
mod from Modrinth, mirror the jar somewhere you control, or leave it to a manual
install.

## `resourcePacks[]` and `shaders[]` entries

Same shape — `id`, `name`, optional `version`, `source` (`modrinth | url | local`), optional `projectId` / `url` / `fileName`, optional `sha512` / `sha256` / `sha1`. Side is always client. The `url` fast path applies here too.

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

The optional `signature` is the base64-encoded Ed25519 signature of the
**canonicalized** manifest. It is checked against the key ring inside the sync,
on the exact document that is about to be installed and before anything is
downloaded — not in a separate fetch, which would only ever report on bytes
nobody installed.

The key ring is the user's `Settings → Trusted Keys` plus the **White Ravens
publisher key compiled into the launcher**, which is why a first-party pack
reads "Verified" on an install where nothing has been configured — and why one
that fails to verify is refused there too.

What happens next depends on where the manifest came from and on whether the
user trusts any key:

| Manifest                        | Signed and valid           | Signed but unmatched | Unsigned                     |
| ------------------------------- | -------------------------- | -------------------- | ---------------------------- |
| first-party (White Ravens)      | installs, badge "Verified" | **refused**          | **refused**                  |
| third-party, no keys configured | installs, badge "Verified" | installs, flagged    | installs, flagged "Unsigned" |
| third-party, one or more keys   | installs, badge "Verified" | **refused**          | **refused**                  |

**A first-party pack is enforced whatever the settings say.** It is served from a
White Ravens address and the key that signs it ships inside the launcher, so
there is no case in which an unverifiable copy of one is genuine — it has been
tampered with in transit, or it is not ours. Configuring a trusted key of your
own extends the same treatment to everything else.

Refusing the unsigned case is the point of the scheme: if deleting the
`signature` field were enough to skip the check, anyone able to rewrite the
manifest would simply delete it.

### Canonical form

The signed byte string is the manifest serialized as JSON with:

1. the `signature` field removed,
2. object keys sorted **at every nesting level** (not just the top level),
3. array order preserved,
4. no insignificant whitespace.

The recursion is load-bearing. An earlier implementation used
`JSON.stringify(rest, Object.keys(rest).sort())`; passing an array as the second
argument makes it a property _allowlist_ applied at every level, so every entry
in `mods[]` serialized as `{}` and the signature covered only top-level scalars
plus array lengths — a tampered manifest that swapped every mod for a backdoored
jar still verified. See `canonicalize()` in
[`src/core/updater/canonical.ts`](../src/core/updater/canonical.ts), which is kept
free of the verification plumbing around it precisely so it can be tested
directly against the signing half in raven-packs.

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
