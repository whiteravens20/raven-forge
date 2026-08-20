---
name: Bug Report
about: Report a reproducible bug in Raven Forge
title: '[BUG] '
labels: bug
assignees: ''
---

> **Security vulnerability?** Do not open a public issue.
> Use [private vulnerability reporting](../../security/advisories/new) instead.

> **Did the game crash?** Use the [Game Crash](?template=crash_report.md) form
> instead — the launcher has already written a report with everything it needs.

> **Before pasting logs:** launcher logs can contain a live Minecraft access
> token, your username and your UUID. **Redact them.** (The launcher's own crash
> reports are written with those already removed.)

## Bug Description

A clear and concise description of what the bug is.

## Steps to Reproduce

1.
2.
3.

## Expected Behavior

## Actual Behavior

Include the exact error message shown in the app, if any.

## Environment

| Field                        | Value                                                   |
| ---------------------------- | ------------------------------------------------------- |
| Raven Forge version          | e.g. 0.1.0 (Info page)                                  |
| Operating System             | e.g. Windows 11 24H2 / Debian 12 / Ubuntu 24.04         |
| Install method               | installer (.exe) / .deb / .AppImage / built from source |
| Node.js (source builds only) | e.g. 24.x                                               |

## Profile Configuration

| Field                | Value                                     |
| -------------------- | ----------------------------------------- |
| Minecraft version    | e.g. 1.21.4                               |
| Mod loader + version | e.g. Fabric 0.19.3 / Quilt / Vanilla      |
| Java                 | auto-downloaded / system, and the version |
| Account type         | Microsoft / offline                       |
| Manifest source      | signed / unsigned / none                  |

## Where does it fail?

- [ ] App start / window
- [ ] Login (Microsoft or offline)
- [ ] Profile creation or editing
- [ ] Manifest sync (mods, configs, resource packs, shaders)
- [ ] Mod search / install (Modrinth)
- [ ] Java download or selection
- [ ] Game launch
- [ ] The game starts but behaves wrongly (wrong mods, wrong version)
- [ ] Auto-update
- [ ] UI / theme / layout

## Logs

<!-- Settings → the log viewer, or:
     Windows: %APPDATA%\Raven Forge Launcher\logs\
     Linux:   ~/.config/Raven Forge Launcher/logs/
     REDACT any --accessToken value, username and UUID before pasting. -->

```
paste the relevant fragment here
```

## Screenshots

## Additional Context
