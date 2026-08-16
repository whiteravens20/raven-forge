# Discord status: registering your own Discord application

Raven Forge can put the running profile on the player's Discord status — "Playing
Raven Forge", with the profile name, the Minecraft version and the loader
underneath. To do that it needs a **Discord application ID** of its own.

This build does not ship one. Without it the setting still appears and can still
be switched on; the launcher writes one line to the log

> Discord Rich Presence: no application ID compiled in, skipping.

and starts the game exactly as it otherwise would. Nothing else changes. If you
do not want the feature, you can close this page.

---

## Why Raven Forge needs this at all

Discord shows what someone is playing in two unrelated ways.

The first is **automatic detection**: Discord scans running processes and
matches them against its own games database, where Minecraft Java is registered
against `javaw.exe` — the executable the official launcher runs. Raven Forge
runs `java` from a JRE it downloaded itself, so Discord sees an anonymous JVM and
says nothing. That is not something we can fix from our side without renaming our
executable to impersonate another launcher.

The second is **Rich Presence**, which is what this page sets up: the application
connects to Discord's socket on the same machine and declares the activity
itself. It is entirely local — no network request leaves the computer, and there
is no token, no OAuth and nothing to keep secret.

The status will read **your application's name**, not "Minecraft". Naming the
Discord application after Mojang's game to inherit its icon would be trading on
their trademark, and is not something this project will do.

---

## Is the application ID a secret?

No, and it is worth understanding rather than taking on faith.

Every application that speaks Discord's IPC protocol sends its ID in the opening
handshake, so any user can read it out of their own socket traffic. It carries no
authority: it names an application on a status line and nothing more. There is no
client secret involved, nothing is authorised by it, and nothing can be done with
somebody else's ID beyond making a status say their application's name.

**It is still not committed**, and the reason is forks rather than secrecy.
Hardcoded, anyone who rebuilt this repo unchanged would ship builds declaring
_our_ application: their players' statuses would read "Playing Raven Forge" and
the portal's usage figures would be theirs mixed with ours. Injected at build
time, a fork inherits nothing and simply gets the feature switched off — the same
reasoning as [AZURE-SETUP.md](AZURE-SETUP.md), where the ID is likewise public.

---

## Registering the application

1. Sign in at the [Discord Developer Portal](https://discord.com/developers/applications)
   with the account that should own it. For White Ravens that is the
   organisation account, not a personal one — the application outlives whoever
   set it up.
2. **New Application**, name it `Raven Forge`. The name is what every player's
   status will read, so it is the one field worth getting right the first time.
3. On **General Information**, copy the **Application ID** — 17–20 digits, no
   dashes.
4. Hand it to the build as `RAVENFORGE_DISCORD_APP_ID`. Nothing is edited in the
   source; `scripts/inject-build-ids.mjs` bakes it into `dist/` and rejects a
   value that is not a snowflake rather than shipping a build that silently
   cannot connect.

```bash
# a dev run
RAVENFORGE_DISCORD_APP_ID=123456789012345678 npm run dev

# a packaged build
RAVENFORGE_DISCORD_APP_ID=123456789012345678 npm run dist:linux
```

For releases, set it as the repository **secret**
`RAVENFORGE_DISCORD_APP_ID`; [release.yml](../.github/workflows/release.yml)
passes it through. Unlike the Azure client ID, a missing one does not fail the
release — the status feature is optional, so the build simply ships without it.

That is the whole functional part. Switch the setting on under **Settings →
Behaviour** and start a profile with Discord running.

---

## Artwork (optional)

The status shows an image next to the text if the application has one.

Under **Rich Presence → Art Assets**, upload a square image, at least 512×512,
named exactly **`raven-forge`**. The launcher asks for that key; an application
with no asset by that name simply shows no image, which is why this step can wait
and why an empty portal breaks nothing.

Discord caches art aggressively — a newly uploaded asset can take several minutes
to appear, and a replaced one longer.

---

## What players see, and what they do not

Deliberately not sent: **the server address**. The launcher knows it, and it
would be published to the player's entire friends list — unlike the profile name,
the address is not only theirs to publish. There is no setting to turn it on.

Sent, while the game runs:

| Field   | Example                   |
| ------- | ------------------------- |
| Details | `White Ravens Classic`    |
| State   | `Minecraft 26.2 · Fabric` |
| Elapsed | counted from launch       |

The status is cleared when the game exits, crashes, or fails to start, and when
the launcher itself is killed — Discord drops the activity with the connection.

---

## When it does not work

The feature is fail-soft by design: every failure below is one line in
`logs/main.log` and a launch that proceeds normally.

One caveat stated plainly: the socket paths were developed and exercised on
Linux. The Windows named pipe (`\\.\pipe\discord-ipc-0` through `-9`) is
Discord's documented location and is covered by a unit test, but it has not been
confirmed against a real Windows Discord install. If the status works on Linux
and not on Windows, that is the first thing to check.

| Symptom                            | Cause                                                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no application ID compiled in`    | `RAVENFORGE_DISCORD_APP_ID` was not set for this build or this run. Step 4.                                                                                 |
| `no Discord IPC socket found`      | Discord is not running, or only the browser client is — the desktop application is what opens the socket.                                                   |
| Nothing appears, no log line       | The setting is off, or the player has **Settings → Activity Privacy → Display current activity as a status message** disabled in Discord itself.            |
| A mod's status shows instead       | Presence mods (CraftPresence, Simple Discord RPC) declare their own activity, and Discord shows one at a time. Expected — turn off whichever you want less. |
| Works for you, not on someone's PC | Flatpak and Snap keep the socket inside their sandbox. The launcher already looks there; a differently packaged Discord may put it somewhere else again.    |
