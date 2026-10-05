// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  GameExitInfo,
  GameLogLine,
  GlobalSettings,
  MinecraftAccount,
  Profile,
} from '../src/shared/ipc-types';
import type { VersionMeta } from '../src/core/minecraft/types';

/**
 * A whole launch, from Play to the exit card, with a stand-in for Java.
 *
 * Everything between the two is real: the profile's own runtime is probed, the
 * game files are checked on disk, the command line is assembled from a version
 * meta, a process is spawned, its output is read and its exit is judged. Only
 * the process itself is not Minecraft — it is a shell script that answers
 * `-version` like a JVM, writes down the arguments it was started with, and
 * then does whatever the test told it to: print, exit, crash, hang.
 *
 * That is the part worth pinning, because none of it can be watched. A launch
 * that passes the wrong argument still starts; an exit that is misread shows a
 * crash card to somebody who pressed Stop, or nothing at all to somebody whose
 * game was killed under them.
 *
 * What is stubbed is what a launch reaches outside itself: the window it
 * reports to, the settings and the account, the profile store, and Mojang's
 * metadata, which is handed over as a fixture instead of fetched.
 *
 * POSIX only, for the same reason as `java-manager.test.ts`: the stand-in is a
 * shell script.
 */

const posix = process.platform !== 'win32';

const TOKEN =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyYXZlbiIsInh1aWQiOiI3NzcifQ.c2lnbmF0dXJlLWdvZXMtaGVyZQ';

const { state } = vi.hoisted(() => ({
  state: {
    userData: '',
    sent: [] as Array<{ channel: string; args: unknown[] }>,
    logged: [] as string[],
    settings: {} as Partial<GlobalSettings>,
    account: {} as MinecraftAccount,
    profile: undefined as Profile | undefined,
    meta: undefined as VersionMeta | undefined,
    played: [] as Array<{ profileId: string; minutes: number }>,
  },
}));

vi.mock('electron', () => ({
  app: { getPath: () => state.userData, getVersion: () => '0.0.0-test', isPackaged: false },
}));

vi.mock('../src/main/logger', () => {
  const record = (...parts: unknown[]) => {
    state.logged.push(parts.map(String).join(' '));
  };
  return { log: { info: record, warn: record, error: record, debug: record } };
});

vi.mock('../src/main/window', () => ({
  getMainWindow: () => ({
    webContents: {
      send: (channel: string, ...args: unknown[]) => {
        state.sent.push({ channel, args });
      },
    },
    minimize: () => {},
  }),
}));

vi.mock('../src/core/config/settings-manager', () => ({
  getSettings: async () => state.settings,
}));

vi.mock('../src/core/auth/microsoft-auth', () => ({
  getAuthState: async () => ({
    accounts: [state.account],
    activeAccountId: state.account.id,
    isAuthenticating: false,
  }),
  getMinecraftAccessToken: async () => TOKEN,
}));

vi.mock('../src/core/profiles/profile-manager', () => ({
  getProfile: async (id: string) => (state.profile?.id === id ? state.profile : undefined),
  updateProfile: async () => state.profile,
  recordPlaySession: async (profileId: string, minutes: number) => {
    state.played.push({ profileId, minutes });
  },
}));

vi.mock('../src/core/mods/mod-sync', () => ({ syncManifest: async () => {} }));

vi.mock('../src/core/discord/rich-presence', () => ({
  setGamePresence: async () => {},
  clearGamePresence: () => {},
}));

vi.mock('../src/core/minecraft/version-manifest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/minecraft/version-manifest')>()),
  getVersionMeta: async () => state.meta,
}));

type Launcher = typeof import('../src/core/minecraft/game-launcher');

let root: string;
let launcher: Launcher;

const cacheDir = () => path.join(root, 'data', 'cache');
const gameDir = () => path.join(root, 'data', 'profiles', 'p1', '.minecraft');
const javaBin = () => path.join(root, 'runtime', 'bin', 'java');

/** Never fetched: every file a launch checks is already on disk and correct. */
const NOT_FETCHED = 'http://127.0.0.1:9/not-fetched';

/** Put a game file where the launcher looks for it, and say what it hashes to. */
async function place(file: string, body: string): Promise<{ sha1: string; size: number }> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
  return {
    sha1: crypto.createHash('sha1').update(body).digest('hex'),
    size: Buffer.byteLength(body),
  };
}

/**
 * The stand-in for the game.
 *
 * Asked for its version it prints a Temurin banner and leaves, which is all the
 * launcher's probe looks at. Started for real it records its arguments and its
 * working directory beside itself, then runs `body`.
 */
async function writeGame(body: string): Promise<void> {
  await fs.mkdir(path.dirname(javaBin()), { recursive: true });
  await fs.writeFile(
    javaBin(),
    [
      '#!/bin/sh',
      'if [ "$1" = "-version" ]; then',
      `  echo 'openjdk version "21.0.3" 2024-04-16' >&2`,
      '  exit 0',
      'fi',
      `printf '%s\\n' "$@" > "$0.args"`,
      'pwd > "$0.cwd"',
      body,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
}

/** Press Play on a profile whose runtime is the stand-in, running `body`. */
async function launch(body: string, profile: Partial<Profile> = {}): Promise<void> {
  await writeGame(body);
  state.profile = {
    id: 'p1',
    name: 'Survival',
    minecraftVersion: '1.21.4',
    modLoader: 'vanilla',
    allocatedRamMb: 1024,
    customJavaPath: javaBin(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...profile,
  };
  await launcher.launchGame({ profileId: 'p1' });
}

const sentOn = (channel: string) =>
  state.sent.filter((s) => s.channel === channel).map((s) => s.args);

/** What the renderer is told when the game is gone. */
async function exitInfo(): Promise<GameExitInfo> {
  await vi.waitFor(() => expect(sentOn('game:exited')).toHaveLength(1), { timeout: 10_000 });
  return sentOn('game:exited')[0][0] as GameExitInfo;
}

/** The command line the game was started with, one argument per element. */
async function gameArgs(): Promise<string[]> {
  const raw = await fs.readFile(`${javaBin()}.args`, 'utf-8');
  return raw.replace(/\n$/, '').split('\n');
}

const gameLines = () => sentOn('game:log').map((args) => args[1] as GameLogLine);

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-launch-'));
  state.userData = path.join(root, 'userData');
  state.sent.length = 0;
  state.logged.length = 0;
  state.played.length = 0;
  state.settings = {
    downloadConcurrency: 4,
    offlineMode: false,
    discordRichPresence: false,
    launcherBehaviorOnLaunch: 'keep-open',
    showLiveConsole: true,
  };
  state.account = {
    id: 'a1',
    // Undashed, which is how Minecraft Services hands a Microsoft account's over.
    uuid: '069a79f444e94726a5befca90e38aaf5',
    username: 'RavenPlayer',
    type: 'microsoft',
  };

  const client = await place(
    path.join(cacheDir(), 'versions', '1.21.4', '1.21.4.jar'),
    'the client jar',
  );
  const index = await place(
    path.join(cacheDir(), 'assets', 'indexes', '19.json'),
    '{"objects":{}}',
  );
  state.meta = {
    id: '1.21.4',
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    assets: '19',
    assetIndex: { id: '19', ...index, totalSize: 0, url: NOT_FETCHED },
    downloads: { client: { ...client, url: NOT_FETCHED } },
    javaVersion: { component: 'java-runtime-delta', majorVersion: 21 },
    libraries: [],
    arguments: {
      game: [
        '--username',
        '${auth_player_name}',
        '--version',
        '${version_name}',
        '--gameDir',
        '${game_directory}',
        '--accessToken',
        '${auth_access_token}',
      ],
      jvm: ['-cp', '${classpath}'],
    },
  };

  process.env.RAVENFORGE_DATA_DIR = path.join(root, 'data');
  vi.resetModules();
  const { reloadDataRoot } = await import('../src/core/config/data-root');
  reloadDataRoot();
  launcher = await import('../src/core/minecraft/game-launcher');
});

afterEach(async () => {
  // A test that failed half way must not leave its stand-in running.
  if (launcher.isGameRunning('p1')) await launcher.killGame('p1');
  delete process.env.RAVENFORGE_DATA_DIR;
  await fs.rm(root, { recursive: true, force: true });
});

describe.skipIf(!posix)('a launch', () => {
  it('starts the game the way the version meta says, in the profile’s own directory', async () => {
    await launch('exit 0');
    await exitInfo();

    const args = await gameArgs();
    expect(args.slice(0, 2)).toEqual(['-Xmx1024M', '-Xms512M']);
    expect(args).toContain('net.minecraft.client.main.Main');
    expect(args.slice(args.indexOf('-cp'), args.indexOf('-cp') + 2)).toEqual([
      '-cp',
      path.join(cacheDir(), 'versions', '1.21.4', '1.21.4.jar'),
    ]);
    // Game arguments follow the main class, with the placeholders filled in.
    expect(args.slice(args.indexOf('net.minecraft.client.main.Main') + 1)).toEqual([
      '--username',
      'RavenPlayer',
      '--version',
      '1.21.4',
      '--gameDir',
      gameDir(),
      '--accessToken',
      TOKEN,
    ]);
    expect((await fs.readFile(`${javaBin()}.cwd`, 'utf-8')).trim()).toBe(
      await fs.realpath(gameDir()),
    );
  });

  it('tells the renderer the game started, and for which profile', async () => {
    await launch('exit 0');
    await exitInfo();
    expect(sentOn('game:started')).toEqual([['p1']]);
  });

  it('passes on what the game prints, with the level the game gave it', async () => {
    await launch(
      [
        `echo '[12:00:00] [Render thread/WARN]: Missing sound for event'`,
        `echo '[12:00:01] [main/INFO]: Stopping!'`,
        'exit 0',
      ].join('\n'),
    );
    await exitInfo();

    expect(gameLines().map(({ level, message }) => ({ level, message }))).toEqual([
      { level: 'warn', message: '[12:00:00] [Render thread/WARN]: Missing sound for event' },
      { level: 'info', message: '[12:00:01] [main/INFO]: Stopping!' },
    ]);
  });
});

describe.skipIf(!posix)('the end of a game', () => {
  it('reports a game that closed normally as exactly that', async () => {
    await launch('exit 0');

    expect(await exitInfo()).toEqual({
      profileId: 'p1',
      exitCode: 0,
      crashed: false,
      logTail: undefined,
      playTimeMinutes: 0,
      reportPath: undefined,
    });
    expect(launcher.isGameRunning('p1')).toBe(false);
    // The profile list shows when it was last played; this is what feeds it.
    expect(state.played).toEqual([{ profileId: 'p1', minutes: 0 }]);
  });

  it('reports a game that exited with an error as a crash, with a file to attach', async () => {
    await launch(
      [`echo '[12:00:00] [main/ERROR]: java.lang.NullPointerException'`, 'exit 1'].join('\n'),
    );

    const info = await exitInfo();
    expect(info.crashed).toBe(true);
    expect(info.exitCode).toBe(1);
    expect(info.logTail).toEqual(['[12:00:00] [main/ERROR]: java.lang.NullPointerException']);

    expect(path.dirname(info.reportPath!)).toBe(path.join(root, 'userData', 'crash-reports'));
    const report = await fs.readFile(info.reportPath!, 'utf-8');
    expect(report).toContain('Exit code: 1');
    expect(report).toContain('java.lang.NullPointerException');
  });

  it('does not call it a crash when the game had closed and only the JVM would not', async () => {
    // Minecraft's shutdown watchdog: the window is gone, a mod's thread keeps
    // the JVM alive, the game halts it and exits non-zero with a crash file.
    //
    // The pause is what a real game cannot avoid and a shell script can: only a
    // crash file newer than the launch counts, and a file written in the same
    // few milliseconds is stamped from the kernel's coarse clock — which can
    // read earlier than the launch that preceded it.
    await launch(
      [
        'sleep 0.2',
        'mkdir -p crash-reports',
        `echo 'Description: Client shutdown from post-main' > crash-reports/crash-client.txt`,
        'exit 1',
      ].join('\n'),
    );

    const info = await exitInfo();
    expect(info.crashed).toBe(false);
    expect(info.reportPath).toBeUndefined();
  });
});

describe.skipIf(!posix)('a game that is running', () => {
  it('refuses to be started a second time', async () => {
    await launch('exec sleep 30');
    expect(launcher.isGameRunning('p1')).toBe(true);

    const { launchRefusal } = await import('../src/core/minecraft/launch-errors');
    const err = await launcher.launchGame({ profileId: 'p1' }).catch((e: unknown) => e);
    expect(launchRefusal(err)).toEqual({ key: 'launchError.alreadyRunning' });
  });

  it('is stopped on request, and is not reported stopped until it has', async () => {
    await launch('exec sleep 30');

    await launcher.killGame('p1');

    expect(launcher.isGameRunning('p1')).toBe(false);
    await exitInfo();
  });
});
