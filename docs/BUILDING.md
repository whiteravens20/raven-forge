# Building from source

Setting up a checkout, native toolchain included, is in [CONTRIBUTING.md](../CONTRIBUTING.md#development-setup). This page is what comes after: the scripts, the installers, and the two systems behind a release.

## npm scripts

| Script                 | Description                                                      |
| ---------------------- | ---------------------------------------------------------------- |
| `npm run dev`          | Start Electron + Vite dev server (hot reload)                    |
| `npm run build`        | Build main + renderer for production                             |
| `npm run dist`         | Build + package installer (auto-detect platform)                 |
| `npm run dist:win`     | Build + package NSIS installer (Windows)                         |
| `npm run dist:linux`   | Build + package .deb + AppImage (Linux)                          |
| `npm run icons`        | Rasterise `icon.svg` → `icon.png`, `icon.ico`, installer sidebar |
| `npm run lint`         | Run ESLint over `src/` and `test/`                               |
| `npm run lint:fix`     | Run ESLint with auto-fix                                         |
| `npm run typecheck`    | TypeScript type checking (main, renderer, tests)                 |
| `npm test`             | Run the Vitest suite once                                        |
| `npm run test:watch`   | Vitest in watch mode                                             |
| `npm run format`       | Format code with Prettier                                        |
| `npm run format:check` | Check formatting without writing                                 |
| `npm run clean`        | Remove dist/ and out/                                            |

## Building the installers

Every target needs the app built first, which `npm run dist*` does for you.
The app icons are committed, and generated from one drawing — run
`npm run icons` after changing `assets/icons/icon.svg` (it writes `icon.png`,
`icon.ico` and the NSIS sidebar bitmap; it needs a display, so on a headless
box give it an X server), and commit what it wrote.

```bash
# Linux — .deb + AppImage
npm run dist:linux

# Windows — NSIS installer
npm run dist:win
```

Output goes to `out/`, alongside `latest.yml` and a `.blockmap` for
electron-updater.

Set `RAVENFORGE_CLIENT_ID` on the build command to bake in Microsoft login —
see [AZURE-SETUP.md](AZURE-SETUP.md). Without it the installer is
built fine and the launcher works in offline mode.

### Building the Windows installer from Linux

electron-builder shells out to `signtool.exe` and `makensis.exe`, so it needs
wine. Tested against **WineHQ stable 11.0** on Debian 12:

```bash
sudo dpkg --add-architecture i386
sudo mkdir -pm755 /etc/apt/keyrings
sudo wget -O /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key
sudo wget -NP /etc/apt/sources.list.d/ \
  https://dl.winehq.org/wine-builds/debian/dists/bookworm/winehq-bookworm.sources
sudo apt update && sudo apt install --install-recommends winehq-stable

# Initialise the prefix ONCE with the Mono/Gecko prompts disabled.
# Skip this and `wineboot --init` blocks on a dialog, and the build hangs
# forever with no output at all.
WINEDLLOVERRIDES="mscoree,mshtml=" wineboot -u
```

On Ubuntu use the matching `winehq-<codename>.sources` file from the same
directory. The GitHub Actions release workflow sidesteps all of this by
building the Windows target on a `windows-latest` runner.

### The `.deb`'s dependency list

**The `.deb` carries the full dependency list; the AppImage cannot.** `fpm` — the
tool electron-builder builds Debian packages with — does not run
`dpkg-shlibdeps`, so nothing computes that list for you: whatever the
`deb.depends` array in [electron-builder.config.js](../electron-builder.config.js)
omits is simply absent from the package, `apt install ./…` reports success, and
the app dies on a missing `.so`. The array is therefore measured from the built
binary rather than assumed, and the comment above it carries the command to
regenerate it after an Electron bump. Note that `strings` matters as much as
`objdump` there — libsecret, libnotify, libasound, libcups and libgbm are
`dlopen`'d, so a link-time-only audit misses them.

## Code signing

Two separate systems — Authenticode for the Windows installer, Ed25519 for mod manifests. Both are documented in **[SIGNING.md](SIGNING.md)**.

Short version for the installer: add `WIN_CSC_LINK` (base64 of your `.pfx`) and `WIN_CSC_KEY_PASSWORD` as repository secrets and the release workflow signs the `.exe`. Without them the build still succeeds and produces an **unsigned** installer — check the artefacts rather than assuming.

## CI and releases

What runs on a push, every night and on a tag, the required checks, the repository secrets and the supply-chain rules behind them are written down in [.github/CICD.md](../.github/CICD.md).
