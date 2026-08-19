# Privacy Policy — Raven Forge

**English** · [Polski](PRIVACY.pl.md)

**Last updated: 2026-08-18**

This document describes every piece of data Raven Forge stores, every server it
contacts, and what it sends there. It is written from the source code, not from
a template, and each claim below points at something you can go and read.

If you find a difference between this document and what the launcher actually
does, that is a bug — [report it](https://github.com/whiteravens20/raven-forge/issues/new?template=bug_report.md),
and it will be fixed in whichever of the two is wrong.

---

## The short version

- **Raven Forge collects nothing about you.** No analytics, no telemetry, no
  usage statistics, no unique install identifier, no crash uploads.
- **White Ravens has no server that receives your data.** There is no account to
  create with us and no database with your name in it. The feeds and the pack
  catalogue we publish are static files; we cannot see who downloads them.
- **Your Minecraft credentials go to Microsoft and Mojang, and nowhere else.**
  The launcher never sees your Microsoft password — you type it into Microsoft's
  own page.
- **Everything else stays on your computer**, in one folder you can open from
  Settings and delete at any time.
- The launcher makes outbound requests to do its job — download Minecraft, find
  mods, check for updates. Each one is listed below, along with what it reveals.

---

## What Raven Forge does not do

|                                 |                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Analytics or telemetry          | None. There is no reporting endpoint in the code, which is why there is no switch to turn it off.                      |
| Install identifier              | None is generated or sent.                                                                                             |
| Crash reporting to us           | Crash reports are written to a local file. Nothing uploads them; you attach one to an issue if and when you choose to. |
| An account with White Ravens    | Does not exist. Your Minecraft account is with Microsoft.                                                              |
| Selling or sharing data         | There is no data to sell or share.                                                                                     |
| Advertising or tracking scripts | The launcher's own interface loads no remote code at all — its Content-Security-Policy forbids it.                     |

---

## What is stored on your computer

Everything the launcher keeps about you is in one folder, and nothing outside it.
It holds your profiles and their worlds, your launcher settings, your list of
accounts, a record of what the launcher has been doing, and crash reports.

You never have to find that folder by hand: **Settings → Data → Data folder**
opens it on any system, and the in-app privacy page (Info → Privacy) shows the
exact path this install uses. Unless you have moved it, it is:

| Platform | Location                                             |
| -------- | ---------------------------------------------------- |
| Windows  | `%APPDATA%\Raven Forge Launcher`                     |
| Linux    | `~/.config/Raven Forge Launcher`                     |
| macOS    | `~/Library/Application Support/Raven Forge Launcher` |

**Settings → Data → Move…** puts it wherever you like — another drive, usually,
since the game files run to gigabytes. The launcher carries the contents across
and restarts into the new location. Two things stay behind in the folder above,
because they are diagnostics about the launcher rather than data about you, and
because you want them readable on a day the other drive is not plugged in:
`logs/` and `crash-reports/`. A one-line `data-root.json` stays there too,
naming where the rest went.

Inside it:

| Path                          | Contents                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings.json`               | Your preferences — theme, language, proxy address, feed URLs, download concurrency, trusted signing keys.                                                                                         |
| `profiles.json`               | Your profiles: names, Minecraft versions, mod loaders, allocated RAM, manifest URLs, play time and last-played timestamps.                                                                        |
| `profiles/<id>/.minecraft/`   | A real Minecraft game directory per profile — worlds, screenshots, `options.txt`, mods, resource packs, shaders. Minecraft's own files, kept apart per profile.                                   |
| `auth.json`                   | The account list: Minecraft username, UUID, account type, skin URL, and when each was last authenticated. Written with `0600` permissions. **Secrets are not normally in this file** — see below. |
| `logs/main.log`               | The launcher's log, rotated at 5 MB. See "What ends up in the log".                                                                                                                               |
| `crash-reports/`              | One file per crash, redacted, newest 20 kept. See "Crash reports".                                                                                                                                |
| `java/`, `loaders/`, `cache/` | Downloaded Java runtimes, mod loader installers, and cached metadata. Nothing personal.                                                                                                           |
| `data-root.json`              | Present only if you moved the data folder: the path you moved it to, and nothing else. Stays in the location above.                                                                               |

Chromium also keeps its own storage in that folder, including cookies from the
Microsoft sign-in window. Those are cleared when you log a Microsoft account out.

### Where credentials are kept

**Your password is never stored, anywhere.** You type it on Microsoft's page, in
a window of its own; the launcher cannot read it. What it does keep is the pass
Microsoft hands back afterwards, and that goes into the password safe your
operating system provides — the same one your web browser uses. The technical
version of the same statement follows.

Two secrets exist per Microsoft account: the **Microsoft refresh token** (which
can obtain new sessions) and the **Minecraft session token** (which proves to
game servers that you are you).

Both go into your operating system's credential store — Credential Manager on
Windows, Keychain on macOS, libsecret/kwallet on Linux — under the service name
`com.ravenforge.launcher`. They are not written to disk by the launcher itself.

**The exception is stated out loud.** On a machine with no working keyring (a
common Linux case: no `gnome-keyring` or `kwallet` running), the keychain write
fails. Rather than making sign-in impossible, the launcher falls back to storing
them in `auth.json` with `0600` permissions — and tells you it did, with a
warning on the Accounts page naming the exact file. That is your decision to
make, so you are shown it rather than only having it logged.

Offline accounts have no tokens at all. The "access token" for an offline launch
is the literal string `0`.

### What ends up in the log

`logs/main.log` records what the launcher did: which profile launched, which
files were downloaded, which errors occurred. It includes your Minecraft
username (`Authenticated Microsoft account: <name>`) and absolute file paths,
which on Windows contain your account name.

It also echoes **the game's own output verbatim**, and that is the part to be
careful with: a mod can print anything into it, including launch arguments that
contain a live session token. The launcher's own "Launching:" line is truncated
to 200 characters and reaches only the JVM options, never the token — but the
game's output is not filtered.

**So: redact `logs/main.log` before sharing it.** The crash reports below exist
precisely so you do not have to.

---

## Where the launcher connects

Every request below reveals your IP address and the fact that you use Raven
Forge to the server receiving it. That is inherent to making a network request,
not something the launcher adds.

All of it honours the proxy configured in **Settings → Network**.

### Only when you sign in with Microsoft

| Host                                               | What is sent                                                                                                                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `login.microsoftonline.com`                        | Microsoft's own sign-in page opens in a separate window. **You type your credentials into Microsoft's page; the launcher cannot read them.** It receives only an authorization code, which it exchanges for tokens using PKCE. |
| `user.auth.xboxlive.com`, `xsts.auth.xboxlive.com` | The Microsoft access token, to obtain an Xbox Live token.                                                                                                                                                                      |
| `api.minecraftservices.com`                        | The Xbox token, to obtain a Minecraft session. Returns your UUID, username and skin URL.                                                                                                                                       |

The launcher requests exactly two OAuth scopes: `XboxLive.signin` and
`offline_access`. It cannot read your email, your contacts, or anything else in
your Microsoft account.

**Offline mode (Settings → Behaviour) never contacts any of these.**

### To install and run the game

| Host                                                                                                                   | When                              | What is sent                                |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------- |
| `piston-meta.mojang.com`, `resources.download.minecraft.net`, Mojang's library servers                                 | Installing or launching a version | Nothing but the request itself.             |
| `api.adoptium.net`                                                                                                     | Installing a managed Java runtime | The Java version, your OS and architecture. |
| `meta.fabricmc.net`, `meta.quiltmc.org`, `maven.minecraftforge.net`, `files.minecraftforge.net`, `maven.neoforged.net` | Installing a mod loader           | Nothing but the request itself.             |

### To find and install content

| Host                                    | When                                                                  | What is sent                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.modrinth.com`, `cdn.modrinth.com`  | Browsing or installing mods, shaders, resource packs                  | **Your search terms and filters.** Modrinth's API terms require an identifying User-Agent, so requests carry `whiteravens20/raven-forge/<version> (<repo URL>)` — the launcher name and version, not you.                                                                                                                                             |
| `api.modrinth.com`                      | Checking installed mods for updates, or exporting a profile as a pack | **A SHA-512 hash of each mod file in that profile.** That is how Modrinth is asked what a file is and what has replaced it, and it is what lets a jar you added by hand be recognised at all. A hash names a file, not you — but the set of them describes which mods that profile holds, so it is only sent when you press one of those two buttons. |
| Whatever hosts a mod icon or news image | Displaying them                                                       | The request goes to that host. Images are loaded straight from wherever a project publishes them.                                                                                                                                                                                                                                                     |

### To White Ravens

| Host                      | When                                                               | What is sent                    |
| ------------------------- | ------------------------------------------------------------------ | ------------------------------- |
| `whiteravens20.github.io` | The news feed, the announcement feed and the server pack catalogue | Nothing but the request itself. |

These are **static files on GitHub Pages**. We run no server and no logging of
our own — which also means GitHub, not White Ravens, receives and controls those
request logs, under [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-privacy-statement).
We never see them.

Both feed URLs are yours to change or clear in **Settings → Content sources**.
Clearing a field turns that feed off entirely.

### To a manifest you configured

A profile can be bound to a manifest URL — ours, your own server's, or anyone
else's. The launcher fetches it to sync mods. It sends nothing but the request,
along with an `If-None-Match` header carrying the previous response's ETag.
Whoever operates that address sees your IP.

### To GitHub

| Host            | When                                                                          | What is sent                                                                                   |
| --------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GitHub Releases | **Automatically, on every start**, and whenever you press "Check for updates" | Nothing but the request. It reveals your IP, the launcher version and your platform to GitHub. |

See "Known gaps" — there is currently no switch to disable the automatic check.

### Links that hand you to your browser

Some buttons do not connect to anything themselves — they open an address in
your normal browser and stop being the launcher's business at that point. What
that site then sees is a visit from your browser, with whatever cookies and
history it already carries.

| Where                                 | Opens                                           |
| ------------------------------------- | ----------------------------------------------- |
| Accounts → Minecraft account settings | `minecraft.net`                                 |
| The Bedrock Edition notice            | `minecraft.net`                                 |
| Info → About, and the crash reporter  | `github.com` and `whiteravens.net`              |
| A news article's "read on the site"   | Whichever address that article was published at |

The launcher never opens one of these on its own.

---

## Discord status

Off by default. Turned on under **Settings → Behaviour**, the launcher writes to
Discord's own socket on your computer while the game runs, and Discord puts the
profile name, the Minecraft version and the loader on your status.

- Nothing leaves your computer through Raven Forge. The socket is local; what
  Discord does with the status afterwards is Discord's behaviour, and everyone
  who can see your Discord profile can see it.
- **The server address is never sent**, though the launcher knows it. It would
  be published to your entire friends list, and the address is not only yours.
- The status is cleared when the game exits, crashes, or fails to start.
- With the setting off, no socket is opened and nothing is written.

---

## The game is a separate program

Once Minecraft starts, it is its own process, and Raven Forge is no longer in
the middle of anything it does.

- Minecraft contacts Mojang's session servers to verify you when joining
  online-mode servers.
- Multiplayer servers you join see your IP, your username and your UUID.
- **Mods are arbitrary Java code with your user's privileges.** A mod can open
  any network connection it likes, read any file you can read, and send it
  anywhere. Raven Forge verifies that you received the exact file a manifest
  named — it cannot tell you that file is trustworthy.

Only add manifest sources and mods you actually trust. This is covered further
in [SECURITY.md](../SECURITY.md).

---

## Crash reports

When the game exits with an error, the launcher writes one file to
`crash-reports/`. It contains launcher and Java versions, your OS, the profile's
configuration, the installed mod list, Minecraft's own crash report, and the
last 100 lines of game output.

**It is written already redacted.** Before the file is saved, the launcher
removes: any JWT-shaped token, any `--accessToken` / `--clientId` / `--xuid` /
`--uuid` / `--username` / `--session` argument value, the literal access token,
UUID and player name used by that launch, and your home directory path — which
on Windows contains your account name — replaced with `~`.

**Nothing uploads it.** It sits in a folder until you decide otherwise. The card
shown after a crash offers to open it; **Settings → Data → Crash reports** opens
the folder at any time.

The redaction cannot know what a mod chose to print into the game's output, so
read a report through before attaching it to a public issue.

---

## What you can turn off

| Setting                                                       | Effect                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Offline mode** (Settings → Behaviour)                       | Never contacts any authentication server. Singleplayer and LAN only.                        |
| **News / announcement feed URL** (Settings → Content sources) | Clear the field and that feed is never fetched.                                             |
| **Proxy** (Settings → Network)                                | Routes every launcher request through a proxy you control.                                  |
| **Discord status** (Settings → Behaviour)                     | Off by default. On, your Discord profile shows what you are playing.                        |
| Not using the Mods page                                       | Nothing is sent to Modrinth unless you search, install, check for updates or export a pack. |
| Using an offline account                                      | No Microsoft or Xbox server is ever contacted.                                              |

---

## Deleting everything

- **One account:** "Log out" on the Accounts page removes it from `auth.json`
  and deletes its keychain entries. Logging out of a Microsoft account also
  clears the sign-in window's cookies, so the next sign-in starts from a blank
  page rather than recognising you.
- **All launcher data:** quit the launcher and delete the data folder listed
  above. Nothing survives outside it except the OS keychain entries, which are
  removed by logging out first.
- **Uninstalling:** removing the launcher and removing your data are separate
  steps. On Windows the uninstaller asks which you want; on Linux the package
  never touches your home directory. [UNINSTALL.md](UNINSTALL.md) covers both.
- **On our side:** there is nothing to delete. We hold nothing.

---

## Known gaps

Listed on purpose. An honest list beats a clean-looking one.

- **The update check on start cannot be disabled** from Settings. It is a single
  request to GitHub Releases on each launch. A blocked network simply makes it
  fail quietly.
- **Log files are not redacted.** Only crash reports are. See "What ends up in
  the log".
- **Skin images are loaded from Microsoft's texture servers** by URL when the
  Accounts page is shown, which tells that host you opened the page.

---

## Legal position

Raven Forge is a program that runs on your computer. White Ravens operates no
service that receives personal data from it, so with respect to the launcher
there is no data controller on our side and nothing for us to process, retain,
export or erase.

The parties who do receive data are the ones you would expect from the tables
above — Microsoft and Mojang for your account, Modrinth for content you look up,
Adoptium for Java, GitHub for update checks and our published feeds — each under
their own privacy policy and their own terms.

---

## Changes to this policy

This file is versioned in the repository with the code it describes. Its history
is the change log: `git log PRIVACY.md`. Any change that alters what data is
stored or sent will be called out in the release notes.

---

## Contact

- **Issues and questions:** [github.com/whiteravens20/raven-forge/issues](https://github.com/whiteravens20/raven-forge/issues)
- **Security vulnerabilities:** follow [SECURITY.md](../SECURITY.md) — do not open a
  public issue.
- **Would rather not use GitHub:** reach White Ravens through
  [whiteravens.net](https://whiteravens.net).

---

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
