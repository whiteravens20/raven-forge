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

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'com.ravenforge.launcher',
  productName: 'Raven Forge Launcher',
  copyright: 'Copyright © 2026 White Ravens',

  directories: {
    output: 'out',
    buildResources: 'build',
  },

  files: [
    'dist/**/*',
    'package.json',
  ],

  // Asar archive for security + performance
  asar: true,
  asarUnpack: [
    // Native modules that can't run from asar
    'node_modules/keytar/**',
  ],

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
    // libxtst6 and libuuid1, which Electron 41 references nowhere, and omits
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
