# What Raven Forge does

The whole list. The [README](../README.md) keeps the short one.

## Profiles and packs

- **Server Profiles** — per-server instance configs with pinned MC version, mod loader, and remote manifest
- **Pack Install** — start a profile from a White Ravens pack, a `.mrpack` file, a manifest URL, or an empty form
- **Modpacks On Modrinth** — search public modpacks from the new-profile dialog and install one as a new profile
- **Mod Auto-Sync** — fetch server manifest → check its signature → diff → parallel download → verify each hash → install
- **Pack Export** — write a profile back out as a `.mrpack`: a small file of references, with anything Modrinth does not host carried inside it
- **Repair** — a profile made from a pack file checks its files against that pack and downloads whatever is missing
- **Duplicate** — a copy of a profile with its mods, settings and worlds; the world backups stay with the original
- **Leftover Files** — deleting a profile can keep its files; they are listed, and can be put back or deleted for good

## Mods, shaders and resource packs

- **Mod Browser** — search Modrinth from the launcher, filtered to your profile
- **Compatibility Checks** — warns before an install that does not fit the profile, and pulls in required dependencies
- **Mods From A File** — add a jar you already have: it is checked to be for the profile's loader, recognised by its contents when Modrinth publishes that very build — so its updates and the mods it needs are handled like any other — and listed as a plain file when not
- **Mod Updates** — checks what you installed by hand against Modrinth by file hash, so a jar you added from a file is recognised too, and updates them in place
- **Shaders & Resource Packs** — found on Modrinth or added from a zip you already have, checked to be the kind of pack the game will read, then ordered and removed per profile

## Loaders, Java and versions

- **Mod Loader Engine** — auto-install Fabric, Quilt, Forge and NeoForge, or run Vanilla. Each from the first Minecraft version it can be installed for — Fabric 1.14, Quilt 1.14.4, Forge 1.7.10, NeoForge 1.20.1 — through to the newest release. Only the loader builds that start the chosen Minecraft version are offered for it; a profile that holds another, because a pack named it, is told so when it fails to start; and a loader install that has lost files is put right at the next launch
- **Java Management** — auto-download the Adoptium Temurin JRE the game actually asks for; Mojang's version metadata names the major (Java 25 for 26.2, 21 for 1.21, and so on), with a table covering versions old enough not to state one. A profile may name a JVM of its own instead — picked from the ones found on this machine or from a file — and the launcher checks it says what it needs to before the game gets it
- **Snapshots** — Mojang's weekly test builds are one toggle away in the version picker, off by default, and a profile already on one opens with them shown

## Playing

- **Microsoft Auth** — full OAuth 2.0 → Xbox Live → Minecraft JWT chain + offline mode
- **Offline When Sign-In Is Down** — when the sign-in servers cannot be reached, a launch offers to play offline instead of reading as an expired session
- **Quick Connect** — a profile can name a server, and the game joins it when it starts
- **The Window The Game Starts In** — a size and a windowed/fullscreen choice per profile, both optional. Fullscreen is written into the game's own settings rather than passed as an argument, so switching it back off works as well as switching it on
- **Game Language** — set per profile and written into the game's own settings, or left to the game
- **Two Profiles At Once** — two profiles can run side by side, on one Minecraft version too
- **Stop The Game** — a running profile can be stopped from the launcher: SIGTERM first, SIGKILL after ten seconds, and it does not report success until the process has actually gone
- **Live Console** — optional: the game's output on the home page while it runs, with the session token taken out
- **Crash Reports** — one file per crash with versions, mods and the game's own report, written with tokens and account details already stripped out
- **Discord Status** — optional, off by default: shows the running profile, version and loader on your Discord status, never the server address ([setup](DISCORD-SETUP.md))

## Your computer and your data

- **Data Folder You Choose** — profiles, assets and the managed JREs are gigabytes; point them at another drive from Settings and the launcher carries what is already there, or picks up a folder it used before. `RAVENFORGE_DATA_DIR` decides instead for a portable install
- **Everything It Writes, Listed** — Settings → Data shows every place the launcher writes to, with its size measured on disk and a button that opens it, and says what is kept in the system's credential store
- **RAM That Fits The Machine** — the allocation slider is bounded by the memory this computer actually has, recommends a size for it, and the launcher refuses a heap the machine cannot back rather than failing later
- **World Backups** — copy a profile's worlds aside, restore them again, and get asked before a Minecraft version change touches them
- **Auto-Update** — launcher self-updates via GitHub Releases (electron-updater). It asks at every start unless you switch that off, downloads when you say so, and the download can be cancelled
- **A Proxy For Everything** — HTTP, HTTPS or SOCKS4/5, for every connection the launcher makes: downloads, sign-in and images
- **No Telemetry** — nothing is measured, nothing is reported back; the app itself lists what it stores and every server it contacts ([privacy policy](PRIVACY.md))

## Look and language

- **Bilingual UI** — Polish and English, opening in the system's language and switchable in Settings
- **Three Themes** — dark, OLED black and light
- **Modern UI** — dark gaming-grade design, animated voxel hero scenes (drone flight, Nether forge, mine, tech workshop), news feed, frameless window
- **News And Announcements** — read inside the launcher, from feeds you can point anywhere or switch off ([configuration](CONFIGURATION.md#news-feed-and-announcements))
