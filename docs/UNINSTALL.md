# Uninstalling Raven Forge

Removing the launcher and removing your data are two separate things, and on
every platform they stay separate unless you say otherwise. Worlds, mods and the
Java runtimes the launcher downloaded add up to several gigabytes, so this page
says exactly what goes and what stays.

**Log out first if you signed in with Microsoft.** Deleting files does not touch
the OS keychain — see [Tokens in the keychain](#tokens-in-the-keychain) at the
bottom. It is the one thing no uninstaller on any platform will clean up for you.

---

## Where the data lives

| Platform | Data folder                                          |
| -------- | ---------------------------------------------------- |
| Windows  | `%APPDATA%\Raven Forge Launcher`                     |
| Linux    | `~/.config/Raven Forge Launcher`                     |
| macOS    | `~/Library/Application Support/Raven Forge Launcher` |

That single folder holds everything: `settings.json`, `profiles.json`, one
`.minecraft` per profile, the downloaded Minecraft assets, the mod loaders and
the Java runtimes. [PRIVACY.md](PRIVACY.md) breaks it down file by file.

**Settings → Data → Data folder** opens it, so you never have to find it by
hand — as long as the launcher is still installed. Open it before you uninstall
if you plan to keep anything.

> **If you moved the data folder, no uninstaller will find it.**
> **Settings → Data → Move…** puts the data anywhere you like, and every
> uninstaller below — including the Windows "delete my data" option and
> `apt purge` — only ever looks at the default location. A moved folder is left
> exactly where you put it, with everything in it. Read the path from
> **Settings → Data** (or from `data-root.json`, which stays behind in the
> default folder and names it) and delete it by hand if you want it gone.

Two smaller things live outside it:

| Path                                                                                                     | What it is                                                                                              |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `%LOCALAPPDATA%\raven-forge-launcher-updater` (Windows), `~/.cache/raven-forge-launcher-updater` (Linux) | The auto-updater's download cache. Holds a full installer, so it is not small. Safe to delete any time. |
| OS keychain, service `com.ravenforge.launcher`                                                           | Microsoft refresh tokens and Minecraft session tokens. See below.                                       |

---

## Windows

The uninstaller — **Settings → Apps**, or `Uninstall Raven Forge Launcher.exe`
in the install folder (by default `%LOCALAPPDATA%\Programs\Raven Forge Launcher`,
unless you chose another one during setup) — asks one question:

> **Keep your Raven Forge data?**
> Profiles, mods, worlds, downloaded Minecraft files and Java runtimes live in:
> `%APPDATA%\Raven Forge Launcher`

- **Yes** — the program is removed, the data folder is left exactly as it is.
  Install Raven Forge again later and every profile, world and setting is back
  where it was; a reinstall reads the same folder and does not reset it.
- **No** — the data folder is deleted, along with the updater's download cache.
  There is no undo and it does not go through the Recycle Bin.

Either way the program files, the Start menu and desktop shortcuts and the
registry entries go.

Two cases skip the question deliberately:

- **An auto-update.** It runs the uninstaller silently to replace the old
  version, and your data is precisely what has to survive that.
- **A silent uninstall** (`uninstall.exe /S`), which has no window to show a
  dialog in. Add `--delete-app-data` if you want the data gone in that case:

  ```
  "%LOCALAPPDATA%\Programs\Raven Forge Launcher\Uninstall Raven Forge Launcher.exe" /S --delete-app-data
  ```

## Linux — .deb

```bash
sudo apt remove raven-forge-launcher
```

This removes `/opt/Raven Forge Launcher`, the `/usr/bin` symlink, the desktop
entry and the AppArmor profile. **Your data folder is not touched, and `apt
purge` does not touch it either.** That is not an oversight: a Debian package is
not allowed to delete files in a user's home directory, because a package is
installed once for a machine while the data belongs to each account separately.

To remove the data as well:

```bash
rm -rf ~/.config/"Raven Forge Launcher" ~/.cache/raven-forge-launcher-updater
```

## Linux — AppImage

There is no uninstaller: the AppImage is a single file, so delete it. Your data
folder stays, and the command above removes it.

If you let the file integrate itself into your menu (or use `appimaged` /
AppImageLauncher), a menu entry is left behind pointing at a file that no longer
exists. The generated name varies by integrator, so match on the contents rather
than guessing at it:

```bash
grep -rl 'Raven Forge' ~/.local/share/applications/ | xargs -r rm
```

The matching icon is dropped somewhere under `~/.local/share/icons/` with the
same generated name, and is harmless if you leave it.

## macOS

Not applicable yet — there is no macOS build. The path in the table above is
what one would use, and is already what the launcher would pick.

---

## Tokens in the keychain

Signing in with Microsoft stores the refresh token and the Minecraft session
token in the OS keychain — Credential Manager on Windows, GNOME Keyring or
KWallet on Linux — under the service name `com.ravenforge.launcher`. They are
deliberately not in the data folder, which is why **deleting files does not
remove them**.

The clean way is to log out on the Accounts page **before** uninstalling: that
deletes the keychain entries and clears the sign-in window's cookies. If the
launcher is already gone, open your keychain manager and delete the
`com.ravenforge.launcher` entries by hand.

Whatever you do locally, you can also revoke the launcher's access to your
Microsoft account at <https://account.live.com/consent/Manage>. That works from
any machine and does not need the launcher installed.

---

## Nothing on our side

There is no account to close and no server-side copy to request the deletion of.
The launcher stores everything on your machine and sends us nothing — see
[PRIVACY.md](PRIVACY.md).
