---
name: Game Crash
about: The game closed with an error, or never started. Attach the crash report the launcher wrote.
title: '[CRASH] '
labels: bug, crash
assignees: ''
---

> **Security vulnerability?** Do not open a public issue.
> Use [private vulnerability reporting](../../security/advisories/new) instead.

## The crash report

The launcher writes one file per crash and offers it on the Home screen — the
**Open report** button on the red card (**Otwórz raport** in Polish). It is also
reachable any time from **Settings → Data → Crash reports**, or directly at:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Raven Forge Launcher\crash-reports\` |
| Linux | `~/.config/Raven Forge Launcher/crash-reports/` |
| macOS | `~/Library/Application Support/Raven Forge Launcher/crash-reports/` |

The newest file is the one for the crash you just had. It already contains the
launcher version, your OS, the profile, Java, the installed mods, Minecraft's
own crash report and the last lines of game output — so you do not have to fill
any of that in by hand.

**Attach the file** (drag it into this box) or paste it below.

<details>
<summary>crash report</summary>

```
paste the file here, or attach it above and delete this block
```

</details>

> The launcher removes the access token, your account UUID, your player name and
> your home directory from that file before writing it. It cannot know about
> anything a mod chose to print, so **have a look through it anyway** — this
> issue is public.

## What were you doing?

Playing / joining a server / loading a world / it crashed while starting up / other:

## Does it happen again?

- [ ] Every time
- [ ] Sometimes
- [ ] Once, so far

## Did anything change just before?

Installed or updated a mod, synced a pack, changed the RAM or Java, updated the
launcher, changed the Minecraft version — or nothing at all.

## Already tried?

- [ ] Launched a fresh profile with the same Minecraft version and no mods
- [ ] Re-synced the pack / reinstalled the mods
- [ ] Not yet

## Anything else

Screenshots, a link to the pack, the server you were on.

---

Would rather not use GitHub? Write to us through
[whiteravens.net](https://whiteravens.net) instead — the same report, sent that
way, is just as welcome.
