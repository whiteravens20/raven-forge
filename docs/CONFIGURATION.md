# Configuration

Almost everything is set under Settings in the launcher. This page covers what needs more than a label there: the two feeds, which addresses White Ravens publishes, what a fork has to change, and the environment variables.

## News feed and announcements

A fresh install points at White Ravens' published feeds (listed under [Live endpoints](#live-endpoints)). Both are yours to change — under Settings, or in `settings.json` in the data folder (Settings → Data shows where that is). Clearing a field switches that section off rather than restoring the default.

> **Note:** An empty `newsFeedUrl` or `announcementFeedUrl` shows an empty section — the launcher has no placeholder copy to fall back on, because demo text presented as a server's announcements is worse than nothing.

### News feed

```json
{
  "newsFeedUrl": "https://your-server.com/api/news.json"
}
```

Expected response format:

```json
[
  {
    "id": "1",
    "title": "Server Update 1.21",
    "excerpt": "We've updated to 1.21 with new mods!",
    "body": "## What changed\n- Mekanism 10.7\n- New spawn\n\nSee **Profiles** to sync.",
    "url": "https://your-server.com/blog/update-121",
    "imageUrl": "https://your-server.com/images/news-1.jpg",
    "publishedAt": "2026-03-15T12:00:00Z"
  }
]
```

Only `id`, `title`, `excerpt` and `publishedAt` are required. Clicking a card opens `body` **inside the launcher**, so a feed needs no website behind it; `url` is an optional "open in browser" link rather than the way in.

`body` accepts a small Markdown subset — `## headings`, `- lists`, `**bold**`, `*italic*`, `` `code` `` and `[links](https://…)`. It is parsed into elements, never into HTML, so a feed cannot inject markup. Anything outside the subset renders as the literal text you wrote.

### Announcements

```json
{
  "announcementFeedUrl": "https://your-server.com/api/announcements.json"
}
```

Expected response format:

```json
[
  {
    "id": "1",
    "message": "Maintenance scheduled for Saturday 10 PM UTC",
    "type": "warning",
    "title": "Scheduled maintenance",
    "body": "The server goes down at 22:00 UTC for about two hours.\n\n- World backup\n- Mod updates",
    "url": "https://your-server.com/status",
    "dismissible": true
  }
]
```

`title` and `body` are optional and use the same Markdown subset as news. A banner is only clickable when it has one of `body` or `url` — a dialog that repeats the banner's own sentence teaches people the click is not worth making.

### In more than one language

A feed is one file, written in whatever language you write in, and that is what every player reads unless an entry says it again in theirs:

```json
{
  "id": "1",
  "title": "White Ravens Classic jest online",
  "excerpt": "Pierwszy serwer White Ravens przyjmuje graczy.",
  "publishedAt": "2026-08-18T12:00:00Z",
  "translations": {
    "en": {
      "title": "White Ravens Classic is online",
      "excerpt": "The first White Ravens server is taking players."
    }
  }
}
```

Nothing here is required, and it goes as far as you take it: a feed in one language changes nothing, and you can translate one entry, or one field of one entry. What a translation leaves out is shown as the entry has it, and a player whose language no entry was translated into reads what you wrote. So a launcher that gains a language asks nothing of anybody's feed, and a translation you add for a language the launcher does not have yet simply waits for it.

The keys are language codes: `en`, `pl`, and `pt-BR` if you need one for a region (a player on `pt-BR` gets `pt` when that is all there is). A news entry can translate `title`, `excerpt`, `body` and `url`; an announcement `message`, `title`, `body` and `url`. A translation that does not parse is dropped on its own and costs nothing else. A launcher older than this ignores the field and shows the entry as written, so a feed can start carrying translations before its players have updated.

The launcher asks for the same file whichever language it is set to, so a feed can sit on static hosting and the server is not told what language anybody reads in.

## Live endpoints

White Ravens publishes both feeds — and the pack manifests — from the sibling
[raven-packs](https://github.com/whiteravens20/raven-packs) repository, which
doubles as a working reference for each format:

| Setting                                 | URL                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| News feed                               | `https://whiteravens20.github.io/raven-packs/raven-forge/news.json`          |
| Announcement feed                       | `https://whiteravens20.github.io/raven-packs/raven-forge/announcements.json` |
| Pack catalogue                          | `https://whiteravens20.github.io/raven-packs/packs.json`                     |
| Profile manifest (White Ravens Classic) | `https://whiteravens20.github.io/raven-packs/ravenclassic/manifest.json`     |

Manifests published there are Ed25519-signed, and the White Ravens public key is
compiled into the launcher, so those packs read **Verified** with nothing to
configure. It is shipped rather than downloaded on purpose: a key fetched
alongside the manifest it vouches for proves nothing, because whoever can
rewrite one can rewrite the other.

**Settings → Trusted Keys** lists that built-in key first — unremovable, and
labelled as shipped with the launcher, because it is the reason a White Ravens
pack reads Verified on an install where you added nothing.

A White Ravens pack is held to that key whatever you have configured: one whose
signature does not verify is refused, not flagged. There is no honest reason for
a first-party manifest to fail the check.

Adding a key of your own extends the same rule to everything else: from then on
the launcher refuses to install any manifest not signed by a key you trust,
unsigned ones included. Until you add one, third-party signatures are reported
but not enforced, which is what keeps packs from anywhere else installable.

## Environment variables

| Variable                    | What it does                                                                                                                                                                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAVENFORGE_DATA_DIR`       | Where the data lives, for a portable install. It outranks the folder chosen under Settings → Data, which then cannot be changed there. On Linux it has to be on a disk that can hold a symbolic link: on FAT32 or exFAT the embedded browser cannot make its lock there, and the launcher closes as it starts. |
| `RAVENFORGE_CLIENT_ID`      | The Azure application behind Microsoft sign-in, at build time or at run time. Without one the launcher works in offline mode ([AZURE-SETUP.md](AZURE-SETUP.md)).                                                                                                                                               |
| `RAVENFORGE_DISCORD_APP_ID` | The Discord application behind the optional status, at build time or at run time ([DISCORD-SETUP.md](DISCORD-SETUP.md)).                                                                                                                                                                                       |

## Forking

Every address the launcher ships pointing at White Ravens lives in one file,
[`src/shared/branding.ts`](../src/shared/branding.ts): the two feed defaults and
the pack catalogue behind _Play on the White Ravens servers_. Change those three
constants and a fork inherits none of our infrastructure. Nothing else in the
codebase hardcodes a `whiteravens20` URL.

The two feed values are only _defaults_ — they seed a first launch and an
install that predates them, and any player can point them elsewhere. The
catalogue URL is deliberately not settable: its entries become manifest URLs
that profiles get created from, so a settable address would turn a screen badged
White Ravens into a way to serve somebody arbitrary manifests. The manifest-URL
and `.mrpack` import routes exist for everything else, and there the address is
plainly the player's own.

## UI language

Polish and English ship in `src/renderer/i18n/`, one JSON file each; switch under Settings → Appearance. A new language is a file translated from `en.json`, loaded once it has every message and its code is added to `LOCALES` in `src/shared/locale.ts`. See [CONTRIBUTING.md](../CONTRIBUTING.md#translations).
