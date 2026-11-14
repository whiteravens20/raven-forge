// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

/**
 * Raven Forge Launcher — electron-builder configuration
 * Builds: NSIS installer (Windows), .deb + AppImage (Linux)
 *
 * Always invoke through `npm run dist*`, which passes `-c` explicitly.
 * electron-builder does NOT auto-detect this filename (it looks for
 * `electron-builder.js`/`.yml`), and a bare `electron-builder` silently falls
 * back to defaults — writing into `dist/`, the app's own build output, which
 * then fails with "entry file … is corrupted".
 *
 * Code signing:
 *   Windows: Set CSC_LINK and CSC_KEY_PASSWORD env vars in CI secrets
 *   See docs/SIGNING.md for OV/EV certificate setup
 */

/**
 * Which platform this run packages for: the one named on the command line, or,
 * with none named, the one it runs on.
 *
 * Asked because the product goes by two names. electron-builder builds the
 * `.deb`'s install folder out of the product name and offers no other lever, so
 * "Raven Forge Launcher" put the program in `/opt/Raven Forge Launcher` — a
 * path with spaces, which every script and every `ldd` then has to quote. On
 * Linux the product is therefore named like the package, as the binary, the
 * desktop entry and the data folder already are; what the player reads is the
 * desktop entry's own `Name`, set further down, and is unchanged. Windows keeps
 * the spaced name for the installer's title and the uninstall entry, and gets
 * its folder from build/installer.nsh.
 *
 * One platform per run, then: a run for both would give one of them the other's
 * name.
 */
const args = process.argv.slice(2);
const named = (...flags) => args.some((arg) => flags.includes(arg));
const linuxNamed = named('--linux', '-l');
const otherNamed = named('--win', '--windows', '-w', '--mac', '--macos', '-m', '-o');
if (linuxNamed && otherNamed) {
  throw new Error('Package one platform per run: the product is named differently on Linux.');
}
const forLinux = linuxNamed || (!otherNamed && process.platform === 'linux');

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Take the right to change it away from everyone but its owner, for `target`
 * and everything under it.
 *
 * Electron comes as a zip, and the modes in that zip are open to everyone:
 * unpacked, the program, its libraries and `chrome-sandbox` were `rwxrwxrwx`,
 * and the `.deb` installed them so — owned by root, in `/opt`, and writable by
 * any account on the computer, which could then put a program of its own in the
 * launcher's place for whoever starts it next. Links are passed over: a link
 * has no mode of its own, and following one could reach outside the package.
 */
async function closeToOthers(target) {
  const found = await fs.lstat(target);
  if (found.isSymbolicLink()) return;
  const mode = found.mode & 0o7777;
  if (mode & 0o022) await fs.chmod(target, mode & ~0o022);
  if (!found.isDirectory()) return;
  for (const name of await fs.readdir(target)) await closeToOthers(path.join(target, name));
}

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'com.ravenforge.launcher',
  productName: forLinux ? 'raven-forge-launcher' : 'Raven Forge Launcher',
  copyright: 'Copyright © 2026 White Ravens',

  directories: {
    output: 'out',
    buildResources: 'build',
  },

  files: [
    'dist/**/*',
    'package.json',
    // What dependencies carry for working on them and the running program never
    // reads: source maps, TypeScript sources (zod ships all of its own, its test
    // suite with them), and the headers and gyp files a native module is built
    // from — keytar is built in node_modules before anything is packed.
    '!node_modules/**/*.{map,ts,mts,cts}',
    '!node_modules/**/*.{h,hpp,c,cc,cpp,gyp,gypi}',
  ],

  // The licence asks that every copy come with its text, and NOTICE that the
  // attribution travel with it. The NSIS licence page shows the first only, and
  // only while installing, so both are copied next to the app as well.
  extraResources: ['LICENSE', 'NOTICE'],

  // Asar archive for security + performance
  asar: true,
  asarUnpack: [
    // Native modules that can't run from asar
    'node_modules/keytar/**',
  ],

  // Before anything is packed: what the packages carry is the unpacked folder
  // as it is, modes and all. Windows keeps no such modes, so there is nothing
  // to take away there. See `closeToOthers` above.
  afterPack: async ({ appOutDir }) => {
    if (process.platform !== 'win32') await closeToOthers(appOutDir);
  },

  // ── What the packaged program refuses to be ──────────────
  // Electron's binary comes with two ways to make any app built on it into
  // something else: `ELECTRON_RUN_AS_NODE` turns it into a plain Node.js that
  // runs whatever script it is handed, and `--inspect` opens a debugger on the
  // main process, the one that holds the accounts and starts programs. Neither
  // is anything the launcher uses, and both are switched off in the binary
  // itself — as fuses, which no flag, variable or setting turns back on.
  //
  // The first is also a plain bug fixed: a terminal that sets
  // `ELECTRON_RUN_AS_NODE` for its own purposes (the one in VS Code does)
  // started the launcher as a Node prompt and not as the launcher.
  //
  // `NODE_OPTIONS` is left alone on purpose. A packaged Electron already takes
  // nothing from it that could load code or open a debugger, and the fuse that
  // would silence it silences `NODE_EXTRA_CA_CERTS` with it — the one way a
  // player behind a proxy that re-signs HTTPS can tell the launcher about the
  // proxy's certificate.
  //
  // The browser inside has a debugger as well, `--remote-debugging-port`, and
  // for that one there is no fuse: the launcher takes it off its own command
  // line as it starts — `refuseRemoteDebugging` in src/main/security.ts.
  //
  // The launcher's own code is one archive, `resources/app.asar`, and two more
  // fuses hold the program to it. Without the archive Electron goes looking for
  // a folder called `resources/app` and runs that instead; with
  // `onlyLoadAppFromAsar` it runs the archive or nothing. With
  // `enableEmbeddedAsarIntegrityValidation` it checks the archive against the
  // digest electron-builder writes into the program as it packs — on Windows
  // and macOS, which is all Electron does it on: a Linux build runs a changed
  // archive as before, and what keeps the archive as it was shipped there is
  // that only root may change it (`closeToOthers`). A program that is not
  // signed can be changed along with its archive, digest and fuses included,
  // so on Windows this is worth most once the program is signed.
  //
  // `npm run dev` and the tests run the Electron in node_modules, which this
  // does not touch.
  electronFuses: {
    runAsNode: false,
    enableNodeCliInspectArguments: false,
    onlyLoadAppFromAsar: true,
    enableEmbeddedAsarIntegrityValidation: true,
  },

  // ── Windows ──────────────────────────────────────────────
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    icon: 'assets/icons/icon.ico',
    // Signing happens only when CSC_LINK is present (CI); electron-builder
    // skips it otherwise, so there is nothing to switch on here.
    // SmartScreen: publish multiple signed builds to build reputation.
    signtoolOptions: {
      signingHashAlgorithms: ['sha256'],
    },
  },

  nsis: {
    // No spaces, because two halves of the update path disagree about what to
    // do with them. GitHub turns a space in an uploaded asset's name into a
    // dot; electron-updater builds its download URL with `name.replace(/ /g,
    // "-")`, matching electron-builder's own publisher, which this repo does
    // not use — the release is assembled by the workflow instead. So
    // `${productName}` produced an asset called `Raven.Forge.Launcher.Setup…`
    // and a `latest.yml` pointing at `Raven-Forge-Launcher-Setup…`, and the
    // updater found the new version and then 404'd fetching it. A name with no
    // space in it survives both transformations unchanged.
    artifactName: 'Raven-Forge-Launcher-Setup-${version}.${ext}',
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Raven Forge Launcher',
    installerIcon: 'assets/icons/icon.ico',
    uninstallerIcon: 'assets/icons/icon.ico',
    installerSidebar: 'build/installer-sidebar.bmp',
    license: 'LICENSE',
    // `deleteAppDataOnUninstall` is deliberately absent: it is all-or-nothing,
    // and several gigabytes of worlds and mods deserve a question rather than a
    // build-time default either way. build/installer.nsh asks it — that file is
    // picked up by name from buildResources, so there is no key for it here.
  },

  // ── Linux ────────────────────────────────────────────────
  linux: {
    target: [
      { target: 'deb', arch: ['x64'] },
      { target: 'AppImage', arch: ['x64'] },
    ],
    icon: 'assets/icons/icon.png',
    category: 'Game',
    synopsis: 'Custom Minecraft: Java Edition launcher',
    description:
      'Raven Forge Launcher — mod management, auto-sync, and server profiles for Minecraft: Java Edition',
    // Without a desktop name Electron picks its own WM_CLASS and the desktop
    // environment cannot match the running window to the installed .desktop
    // entry — generic taskbar icon, pinning does not stick. The name itself
    // lives in package.json (`desktopName`); this only tells electron-builder
    // to name the .desktop file after it and set app_id to match.
    syncDesktopName: true,
    desktop: {
      entry: {
        Name: 'Raven Forge Launcher',
        Comment: 'Custom Minecraft: Java Edition Launcher',
        Categories: 'Game;ActionGame;',
        Keywords: 'minecraft;launcher;mods;',
      },
    },
  },

  // Same reason as the NSIS installer: the AppImage is an updater target, so
  // its name has to survive GitHub's upload and electron-updater's URL builder
  // saying the same thing. The .deb needs no rule — Debian's own naming
  // convention has never allowed a space.
  appImage: {
    artifactName: 'Raven-Forge-Launcher-${version}.${ext}',
  },

  deb: {
    // Every shared library the packaged binary actually needs, measured rather
    // than assumed. `fpm` does not run dpkg-shlibdeps, so nothing fills this in:
    // whatever is missing here is missing from the package, `apt install ./…`
    // succeeds anyway, and the app dies at startup on a missing .so.
    //
    // Regenerate after an Electron major bump, from out/linux-unpacked:
    //   objdump -p raven-forge-launcher | awk '/NEEDED/ {print $2}' | sort -u
    //   strings -a raven-forge-launcher | grep -oE 'lib[a-zA-Z0-9_.-]+\.so[0-9.]*'
    // then map each to its package with `dpkg -S`. The second command matters as
    // much as the first — libsecret, libnotify, libasound, libcups and libgbm are
    // dlopen'd, so they never appear in NEEDED on some builds and a link-time-only
    // audit misses them.
    //
    // Deliberately *not* electron-builder's default list. That one carries libxss1,
    // libxtst6 and libuuid1, which Electron 44 references nowhere, and omits
    // libasound2, libgbm1 and libnss3's own libnspr4, which it does need.
    //
    // Names are the pre-t64 ones on purpose: Ubuntu 24.04's libgtk-3-0t64 and
    // friends all carry `Provides:` for these, so one list resolves on both
    // Debian and Ubuntu.
    depends: [
      // glibc floor. The binary imports GLIBC_2.25; without the bound, apt
      // installs happily onto an older system and the app fails to exec.
      'libc6 (>= 2.25)',
      'libstdc++6', // keytar.node
      // Toolkit and its immediate neighbours.
      'libgtk-3-0',
      'libglib2.0-0',
      'libatk1.0-0',
      'libatk-bridge2.0-0',
      'libatspi2.0-0',
      'libcairo2',
      'libpango-1.0-0',
      'libgdk-pixbuf-2.0-0',
      // X11 / input.
      'libx11-6',
      'libxcb1',
      'libxcomposite1',
      'libxdamage1',
      'libxext6',
      'libxfixes3',
      'libxrandr2',
      'libxkbcommon0',
      // Chromium's own runtime needs.
      'libnss3',
      'libnspr4',
      'libdbus-1-3',
      'libexpat1',
      'libudev1',
      'libgbm1', // GPU buffer manager — not pulled in by anything above
      // Audio, and the one entry that needs an alternative. On Ubuntu 24.04
      // `libasound2` is a virtual name with two providers: real ALSA, renamed to
      // libasound2t64 by the 64-bit time_t transition, and liboss4-salsa-asound2,
      // an OSS compatibility stub. Depending on the bare name lets apt pick the
      // stub — `ldd` is then satisfied and the app still dies at startup on
      // `undefined symbol: snd_device_name_get_hint`. Naming the real package
      // first settles it; Debian and Ubuntu 22.04, where libasound2t64 does not
      // exist, fall through to the second alternative. Every other t64 rename in
      // this list has exactly one provider and needs no such help.
      'libasound2t64 | libasound2',
      'libcups2',
      // dlopen'd by the launcher itself.
      'libsecret-1-0', // the OS keychain, via keytar
      'libnotify4', // desktop notifications
      // shell.openExternal and shell.openPath shell out to xdg-open on Linux;
      // without it "open folder" and every external link silently do nothing.
      'xdg-utils',
    ],
  },

  // ── Auto-update (electron-updater) ──────────────────────
  publish: {
    provider: 'github',
    owner: 'whiteravens20',
    repo: 'raven-forge',
    releaseType: 'release',
  },
};

module.exports = config;
