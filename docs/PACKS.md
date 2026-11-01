# Mods and packs

Where the launcher gets mods from, which pack formats it reads, and what it does with them. The manifest a server publishes is specified in [MANIFEST-SCHEMA.md](MANIFEST-SCHEMA.md), and how it is signed in [SIGNING.md](SIGNING.md).

## Mod sources

| Source         | API key    | Notes                                                                                                                                       |
| -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Modrinth**   | not needed | The primary source. Search, version lookup and downloads all go through the [public API](https://docs.modrinth.com/). Publishes `sha512`.   |
| **Direct URL** | —          | For custom or private mods, via the manifest's `"source": "url"` field. Skips API lookups entirely and keeps working when a source is down. |
| **Local file** | —          | A jar you already have, via `"source": "local"`.                                                                                            |

**CurseForge is deliberately not supported.** Its API key is issued per developer
after a manual application, and the [3rd Party API terms](https://support.curseforge.com/support/solutions/articles/9000207405-curse-forge-3rd-party-api-terms-and-conditions)
make it non-transferable and unshareable — so a key can neither be shipped in a
public binary nor be expected from a player. Since **16 July 2026** CurseForge's
CDN also rejects unauthenticated downloads (`401 A valid api-key is required`),
which closes the last route that did not need one. A CurseForge-only mod has to
be downloaded by hand and added as a local file.

## Pack formats

A new profile can start from a whole pack rather than an empty form.

| Route                  | Format                                                                                                                                                              | Keeps updating?                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **White Ravens packs** | The catalogue at [`raven-packs`](https://github.com/whiteravens20/raven-packs), which publishes a `packs.json` index beside each pack's manifest                    | Yes — the profile stores the manifest URL and every sync reconciles against it |
| **A link**             | Either a Raven Forge manifest v2 or a `.mrpack` — including the link behind Modrinth's Download button                                                              | A manifest, yes; a `.mrpack`, no                                               |
| **`.mrpack` file**     | [Modrinth's modpack format](https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack) — a zip holding `modrinth.index.json` and `overrides/` | No — an import is a snapshot of one version                                    |

One field takes both kinds of link, and which one arrived is decided from the
bytes at the address rather than from the file extension: Modrinth's CDN ends
its URLs in `.mrpack`, but a signed or proxied link need not, and it is the
content that decides what a thing is. A manifest is stored on the profile and
re-read on every sync; a `.mrpack` is unpacked once, exactly like the file route.

`.mrpack` is the only open, cross-launcher pack format the launcher reads; Prism,
ATLauncher, MultiMC and the Modrinth app produce and consume the same files. An
import is converted into a manifest and installed through the ordinary sync path,
so it gets the same hash verification, removal of dropped mods and resource-pack
ordering as a server pack. CurseForge's pack zip is not read, for the reason above: its
files cannot be fetched without a key.

Paths inside a pack are checked before anything is written. An entry that tries
to leave the game directory is refused outright rather than trimmed and installed
somewhere else.
