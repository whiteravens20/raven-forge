# Installing Raven Forge

Every release is on the [releases page](https://github.com/whiteravens20/raven-forge/releases/latest). This page says what each file runs on and what it needs. Going the other way is [UNINSTALL.md](UNINSTALL.md): what each platform's uninstaller removes, and what happens to your profiles and worlds.

## Which file

| Target         | File                                       | Size    | Runs on                                    |
| -------------- | ------------------------------------------ | ------- | ------------------------------------------ |
| NSIS installer | `Raven-Forge-Launcher-Setup-<version>.exe` | ~109 MB | **Windows 11** and Windows 10 (1809+), x64 |
| Debian package | `raven-forge-launcher_<version>_amd64.deb` | ~98 MB  | **Debian 12+**, **Ubuntu 22.04+**, x64     |
| AppImage       | `Raven-Forge-Launcher-<version>.AppImage`  | ~123 MB | Any x64 Linux with glibc ≥ 2.25            |

The Linux floor is the Electron binary's own: it links `GLIBC_2.25`, which the
`.deb` declares as `libc6 (>= 2.25)` so apt refuses the install rather than
letting it fail at startup. Windows 7/8/8.1 are not supported; Electron dropped
them.

The `.deb` is installed and started on Debian 12, Ubuntu 22.04 and Ubuntu 24.04.
Nothing older is claimed: Electron supports a release of a distribution for as
long as its maker does, and on Ubuntu 20.04 the package does not install at all
— one of the libraries it asks for goes by another name there.

## Windows 11 / 10

Run the `Setup .exe`. It is a per-user install by default, so no administrator prompt, and it lets you pick the directory.
Unsigned builds trip SmartScreen ("Windows protected your PC"): **More info**, then **Run anyway**. [SIGNING.md](SIGNING.md) says why, and what signing would and would not change.

## Debian / Ubuntu (.deb)

```bash
sudo apt install ./raven-forge-launcher_<version>_amd64.deb
```

Use `apt`, not `dpkg -i` — `dpkg` installs the package without resolving
anything, and every library it needs then goes missing. `apt` pulls all of them,
sets up the `/usr/bin/raven-forge-launcher` symlink, configures `chrome-sandbox`
(the renderer runs with `sandbox: true`, so it needs one of the two sandboxes),
and on Ubuntu 24.04+ installs the AppArmor profile that lets the user-namespace
sandbox work.

## AppImage

Nothing resolves dependencies for you here: an AppImage carries no dependency
metadata at all, and the file bundles Electron but not the system libraries it
links. Install these first, then `chmod +x` and run it:

```bash
# Debian / Ubuntu / Mint
sudo apt install libgtk-3-0 libnss3 libgbm1 libsecret-1-0 libnotify4 xdg-utils libfuse2 fuse
sudo apt install libasound2t64 || sudo apt install libasound2

# Fedora
sudo dnf install gtk3 nss mesa-libgbm libsecret libnotify xdg-utils fuse-libs fuse alsa-lib

# Arch
sudo pacman -S --needed gtk3 nss mesa libsecret libnotify xdg-utils fuse2 alsa-lib
```

The rest of the list — cairo, pango, the X libraries, cups — comes in with GTK on
all three. `alsa-lib` needs the fallback line on Debian and Ubuntu because 24.04
renamed the package to `libasound2t64` and left `libasound2` as a virtual name
with two providers, which apt will not install by name.

`libfuse2` and `fuse` belong to the AppImage runtime rather than to the launcher,
and one without the other gets you nowhere: `libfuse2` is the library, while
`fusermount` — the helper that actually mounts the image — ships in `fuse`, which
`libfuse2` only _suggests_. A current desktop looks equipped and is not, because
what it installs is `fuse3`, whose helper is named `fusermount3` and is not the
one a type-2 AppImage looks for. Without the helper the file stops at _"fuse:
failed to exec fusermount"_, without the library at _"AppImages require FUSE to
run"_ — both before any of our code runs. Arch ships both in `fuse2`, so one
package covers it there.

Missing `xdg-utils` is the quiet one — the app starts fine and then "open folder"
and every external link silently do nothing, because `shell.openExternal` shells
out to `xdg-open` on Linux.

One further caveat: **Ubuntu 23.10 and later** restrict unprivileged user
namespaces through AppArmor, and an AppImage cannot carry a SUID `chrome-sandbox`
because it is mounted as your own user. Electron apps therefore fail to start
there. Prefer the `.deb` on Ubuntu — it ships an AppArmor profile and its
post-install step loads it. If you need the AppImage, write a profile for it, or
relax the restriction system-wide:

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

Debian does not apply that restriction, so the AppImage runs as-is.

## Updating

A Windows install and an AppImage update themselves: the launcher asks GitHub for a newer release at every start and offers it, and nothing is downloaded until you say so. A `.deb` belongs to the package manager, so the launcher leaves it alone: download the newer `.deb` and install it the same way, over the old one. Profiles, worlds, accounts and settings stay where they are.

## Checking what you downloaded

Each release carries `SHA256SUMS.txt` and a signed build provenance for its three installers. In the folder you downloaded to, with the [GitHub CLI](https://cli.github.com/) for the second line:

```bash
sha256sum --ignore-missing -c SHA256SUMS.txt
gh attestation verify raven-forge-launcher_<version>_amd64.deb --repo whiteravens20/raven-forge
```

The second command exits with an error for a file that this repository's release workflow did not build. The release's `sbom.cdx.json` lists every package inside the installers.
