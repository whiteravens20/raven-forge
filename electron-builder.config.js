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
    depends: ['libnotify4', 'libxss1', 'libsecret-1-0'],
    fpm: ['--after-install=build/postinst.sh'],
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
