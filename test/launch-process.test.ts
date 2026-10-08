// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type {
  GameExitInfo,
  GameLogLine,
  GlobalSettings,
  MinecraftAccount,
  Profile,
} from '../src/shared/ipc-types';
import type { VersionMeta } from '../src/core/minecraft/types';
import { STAND_IN_BUILD_MS, standInJava } from './helpers/stand-in-java';

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
 * shell script. The exception is at the very end — stopping a game, which on
 * Windows is another program's doing and is run there with a stand-in that is
 * a program too.
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
    noActiveAccount: false,
    /** The name the account turns out to have when it is signed in again for a token. */
    renamedTo: undefined as string | undefined,
    profile: undefined as Profile | undefined,
    meta: undefined as VersionMeta | undefined,
    played: [] as Array<{ profileId: string; minutes: number }>,
    /** Every time a Forge installer was asked for, and whether as a repair. */
    installs: [] as Array<{ repair: boolean }>,
    /** What that installer does when it is run; nothing unless a test says. */
    installer: undefined as (() => Promise<void>) | undefined,
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
    activeAccountId: state.noActiveAccount ? null : state.account.id,
  }),
  getMinecraftAccessToken: async () => {
    // A token that had run out is got by signing in again, and what comes back
    // from that is saved over the account — a new object, as the store's is.
    if (state.renamedTo) state.account = { ...state.account, username: state.renamedTo };
    return TOKEN;
  },
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
  clearGamePresence: async () => {},
}));

// The installer is a Java program fetched from Forge's repository; when the
// launch asks for it, and how, is what is under test here.
vi.mock('../src/core/modloader/forge-installer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/modloader/forge-installer')>()),
  installForgeLike: async (
    _loader: string,
    _build: string,
    _mcVersion: string,
    _onProgress: unknown,
    options: { repair?: boolean } = {},
  ) => {
    state.installs.push({ repair: options.repair ?? false });
    await state.installer?.();
  },
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
const javaBin = () => path.join(root, 'runtime', 'bin', posix ? 'java' : 'java.exe');

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
async function launch(
  body: string,
  profile: Partial<Profile> = {},
  options: { quickConnect?: boolean } = {},
): Promise<void> {
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
  await launcher.launchGame({ profileId: 'p1', ...options });
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

const gameLines = () => sentOn('game:log').flatMap((args) => args[1] as GameLogLine[]);

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-launch-'));
  state.userData = path.join(root, 'userData');
  state.sent.length = 0;
  state.logged.length = 0;
  state.played.length = 0;
  state.installs.length = 0;
  state.installer = undefined;
  state.noActiveAccount = false;
  state.renamedTo = undefined;
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

  it('puts back together a line the pipe delivered in two pieces', async () => {
    // A pipe is read whenever there is something in it, which is not the same
    // as whenever a line has ended. The second piece used to become a line of
    // its own, with no level on it.
    await launch(
      [
        `printf '[12:00:00] [main/ERROR]: first half,'`,
        'sleep 0.2',
        `printf ' second half\\n'`,
        'exit 0',
      ].join('\n'),
    );
    await exitInfo();

    expect(gameLines().map(({ level, message }) => ({ level, message }))).toEqual([
      { level: 'error', message: '[12:00:00] [main/ERROR]: first half, second half' },
    ]);
  });

  it('puts back together a character the pipe delivered in two pieces', async () => {
    // `ż` is two bytes. Decoded one chunk at a time, each of them is U+FFFD.
    await launch(
      [
        `printf 'za\\305'`,
        'sleep 0.2',
        `printf '\\274\\303\\263\\305\\202\\304\\207 g\\304\\231\\305\\233l\\304\\205\\n'`,
        'exit 0',
      ].join('\n'),
    );
    await exitInfo();

    expect(gameLines().map((line) => line.message)).toEqual(['zażółć gęślą']);
  });

  it('reads the line endings Windows writes', async () => {
    await launch([`printf 'one\\r\\ntwo\\r\\n'`, 'exit 0'].join('\n'));
    await exitInfo();

    expect(gameLines().map((line) => line.message)).toEqual(['one', 'two']);
  });

  it('keeps the last thing a dying game said, though it never finished the line', async () => {
    await launch([`printf 'java.lang.OutOfMemoryError: Java heap space'`, 'exit 1'].join('\n'));

    expect((await exitInfo()).logTail).toEqual(['java.lang.OutOfMemoryError: Java heap space']);
  });

  it('sends the console what was printed together as one message', async () => {
    // A loader prints thousands of lines in its first seconds. One message
    // each had the renderer rebuilding a list thousands of times over.
    await launch([`printf 'one\\ntwo\\nthree\\n'`, 'exit 0'].join('\n'));
    await exitInfo();

    expect(gameLines().map((line) => line.message)).toEqual(['one', 'two', 'three']);
    expect(sentOn('game:log').length).toBeLessThan(3);
  });

  it('sends the console nothing while it is switched off, and still keeps the lines', async () => {
    state.settings.showLiveConsole = false;
    await launch([`echo 'java.lang.IllegalStateException: boom'`, 'exit 1'].join('\n'));

    // The crash card reads the same buffer, and that is not the console's to switch off.
    expect((await exitInfo()).logTail).toEqual(['java.lang.IllegalStateException: boom']);
    expect(sentOn('game:log')).toEqual([]);
  });

  it('keeps an argument with a quoted space in it whole', async () => {
    await launch('exit 0', { javaArgs: '-Dpack.name="Raven Forge" -XX:+UseG1GC' });
    await exitInfo();

    const args = await gameArgs();
    expect(args).toContain('-Dpack.name=Raven Forge');
    expect(args).toContain('-XX:+UseG1GC');
    // What used to happen: the second half went where the main class belongs.
    expect(args).not.toContain('Forge"');
  });

  it('starts the game under the name the account has after signing in again for it', async () => {
    // The account is read when Play is pressed and the token is fetched last,
    // minutes later. A profile renamed since the last sign-in was started under
    // its old name with a token for the new one, and every online server then
    // turned the player away: the name it was told is not the one Mojang vouches for.
    state.renamedTo = 'RavenRenamed';

    await launch('exit 0');
    await exitInfo();

    const args = await gameArgs();
    expect(args[args.indexOf('--username') + 1]).toBe('RavenRenamed');
  });

  it('asks for an account before it fetches anything', async () => {
    const { refusalOf } = await import('../src/core/util/refusal');
    state.noActiveAccount = true;
    // The version itself cannot be read, so a launch that got as far as
    // preparing files would fail on that instead.
    state.meta = undefined;

    const err = await launch('exit 0').catch((e: unknown) => e);

    expect(refusalOf(err)).toEqual({ key: 'launchError.noAccount' });
  });
});

/**
 * Quick connect. Minecraft 1.20 replaced `--server` and `--port` with
 * `--quickPlayMultiplayer` and dropped the old two; given them, a newer game
 * says nothing, starts, and joins no server.
 */
describe.skipIf(!posix)('a quick connect', () => {
  const server = { serverIp: 'mc.whiteravens.net', serverPort: 25570 };
  const gameSide = async () => {
    const args = await gameArgs();
    return args.slice(args.indexOf('net.minecraft.client.main.Main') + 1);
  };

  /** The argument a version from 1.20 on lists for the server to join. */
  const withQuickPlay = () => {
    state.meta = {
      ...state.meta!,
      arguments: {
        ...state.meta!.arguments!,
        game: [
          ...state.meta!.arguments!.game,
          {
            rules: [{ action: 'allow', features: { is_quick_play_multiplayer: true } }],
            value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'],
          },
        ],
      },
    };
  };

  it('tells a version from 1.20 on by the argument it lists for it', async () => {
    withQuickPlay();
    await launch('exit 0', server, { quickConnect: true });
    await exitInfo();

    const args = await gameSide();
    expect(args.slice(-2)).toEqual(['--quickPlayMultiplayer', 'mc.whiteravens.net:25570']);
    expect(args).not.toContain('--server');
    expect(args).not.toContain('--port');
  });

  it('tells an older version by the server and the port it still takes', async () => {
    await launch('exit 0', server, { quickConnect: true });
    await exitInfo();

    const args = await gameSide();
    expect(args.slice(-4)).toEqual(['--server', 'mc.whiteravens.net', '--port', '25570']);
    expect(args).not.toContain('--quickPlayMultiplayer');
  });

  it('takes an address as it was pasted, without the blanks around it', async () => {
    withQuickPlay();
    await launch('exit 0', { ...server, serverIp: ' mc.whiteravens.net ' }, { quickConnect: true });
    await exitInfo();

    expect((await gameSide()).slice(-2)).toEqual([
      '--quickPlayMultiplayer',
      'mc.whiteravens.net:25570',
    ]);
  });

  it('leaves out a port that no server could be listening on', async () => {
    // The editor refuses one; a profile list edited by hand does not go through it.
    withQuickPlay();
    await launch('exit 0', { ...server, serverPort: 70000 }, { quickConnect: true });
    await exitInfo();

    expect((await gameSide()).slice(-2)).toEqual(['--quickPlayMultiplayer', 'mc.whiteravens.net']);
  });

  it('leaves it out for an older version as well', async () => {
    await launch('exit 0', { ...server, serverPort: -5 }, { quickConnect: true });
    await exitInfo();

    const args = await gameSide();
    expect(args.slice(-2)).toEqual(['--server', 'mc.whiteravens.net']);
    expect(args).not.toContain('--port');
  });

  it('names no server for an address that is nothing but blanks', async () => {
    withQuickPlay();
    await launch('exit 0', { ...server, serverIp: '   ' }, { quickConnect: true });
    await exitInfo();

    expect(await gameSide()).not.toContain('--quickPlayMultiplayer');
  });

  it('names no server when Play was pressed and not quick connect', async () => {
    withQuickPlay();
    await launch('exit 0', server);
    await exitInfo();

    const args = await gameSide();
    expect(args).not.toContain('--quickPlayMultiplayer');
    expect(args).not.toContain('--server');
  });

  it('names no server for a profile that has none', async () => {
    withQuickPlay();
    await launch('exit 0', {}, { quickConnect: true });
    await exitInfo();

    expect(await gameSide()).not.toContain('--quickPlayMultiplayer');
  });
});

/**
 * The versions up to 1.7.2, which are started with one line of arguments and
 * expect three things no later version asks for.
 */
describe.skipIf(!posix)('a version from before 1.7.10', () => {
  const sound = 'a cave sound';
  const hash = crypto.createHash('sha1').update(sound).digest('hex');

  beforeEach(async () => {
    const index = await place(
      path.join(cacheDir(), 'assets', 'indexes', 'legacy.json'),
      JSON.stringify({
        virtual: true,
        objects: { 'sounds/ambient/cave1.ogg': { hash, size: sound.length } },
      }),
    );
    await place(path.join(cacheDir(), 'assets', 'objects', hash.slice(0, 2), hash), sound);
    state.meta = {
      ...state.meta!,
      assets: 'legacy',
      assetIndex: { id: 'legacy', ...index, totalSize: 0, url: NOT_FETCHED },
      arguments: undefined,
      minecraftArguments:
        '${auth_player_name} ${auth_session} --gameDir ${game_directory} ' +
        '--assetsDir ${game_assets} --userProperties ${user_properties}',
    };
  });

  const gameSide = async () => {
    const args = await gameArgs();
    return args.slice(args.indexOf('net.minecraft.client.main.Main') + 1);
  };

  it('is given its assets by name, its session as one argument, and properties that parse', async () => {
    await launch('exit 0');
    await exitInfo();

    const named = path.join(cacheDir(), 'assets', 'virtual', 'legacy');
    expect(await gameSide()).toEqual([
      'RavenPlayer',
      `token:${TOKEN}:069a79f444e94726a5befca90e38aaf5`,
      '--gameDir',
      gameDir(),
      '--assetsDir',
      named,
      '--userProperties',
      '{}',
    ]);
    expect(await fs.readFile(path.join(named, 'sounds', 'ambient', 'cave1.ogg'), 'utf-8')).toBe(
      sound,
    );
  });

  it('is given no session when it is started offline', async () => {
    state.settings.offlineMode = true;
    await launch('exit 0');
    await exitInfo();

    expect((await gameSide())[1]).toBe('-');
  });
});

describe.skipIf(!posix)('a Forge profile', () => {
  const forge = { modLoader: 'forge', modLoaderVersion: '54.1.0' } as const;
  const PATCHED = 'net/minecraftforge/forge/1.21.4-54.1.0/forge-1.21.4-54.1.0-client.jar';
  const patched = () => path.join(cacheDir(), 'libraries', PATCHED);

  /**
   * What installing Forge leaves: its version profile, and the patched client
   * that profile lists with a hash, a size and no address to fetch it from.
   */
  async function installForge(): Promise<void> {
    const client = await place(patched(), 'the patched client');
    const dir = path.join(root, 'data', 'loaders', 'forge', '1.21.4-54.1.0');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'forge-profile.json'),
      JSON.stringify({
        id: '1.21.4-forge-54.1.0',
        inheritsFrom: '1.21.4',
        mainClass: 'net.minecraftforge.bootstrap.ForgeBootstrap',
        libraries: [
          {
            name: 'net.minecraftforge:forge:1.21.4-54.1.0:client',
            downloads: { artifact: { path: PATCHED, url: '', ...client } },
          },
        ],
      }),
    );
  }

  it('starts on what its install left, without the installer', async () => {
    await installForge();

    await launch('exit 0', forge);
    await exitInfo();

    expect(state.installs).toEqual([]);
    const args = await gameArgs();
    expect(args).toContain('net.minecraftforge.bootstrap.ForgeBootstrap');
    expect(args[args.indexOf('-cp') + 1].split(':')).toContain(patched());
  });

  it('is told where the libraries are, whatever folder it is started in', async () => {
    await installForge();

    await launch('exit 0', forge);
    await exitInfo();

    // Forge 49.0.1 to 49.0.3 look in `./libraries` otherwise, and the game is
    // started in the profile's own folder, which has none.
    expect(await gameArgs()).toContain(`-DlibraryDirectory=${path.join(cacheDir(), 'libraries')}`);
  });

  it('has the installer run again when a file only that can make has gone', async () => {
    await installForge();
    await fs.rm(patched());
    state.installer = async () => {
      await place(patched(), 'the patched client');
    };

    await launch('exit 0', forge);
    await exitInfo();

    expect(state.installs).toEqual([{ repair: false }]);
  });

  it('is refused in words the player can act on when that file cannot be made again', async () => {
    const { refusalOf } = await import('../src/core/util/refusal');
    await installForge();
    await fs.rm(patched());

    // The installer runs and leaves nothing. This used to end as three attempts
    // to download from an empty address, reported in the downloader's words.
    const err = await launch('exit 0', forge).catch((e: unknown) => e);

    expect(refusalOf(err)).toEqual({
      key: 'launchError.loaderFileMissing',
      vars: { file: 'forge-1.21.4-54.1.0-client.jar' },
    });
  });

  it('has the installer check what it made on the launch after a crash', async () => {
    await installForge();
    await launch('exit 1', forge);
    await exitInfo();
    expect(state.installs).toEqual([]);
    state.sent.length = 0;

    await launch('exit 0', forge);
    await exitInfo();

    expect(state.installs).toEqual([{ repair: true }]);
  });

  it('still starts after a crash when the installer cannot be had', async () => {
    await installForge();
    await launch('exit 1', forge);
    await exitInfo();
    state.sent.length = 0;
    state.installer = async () => {
      throw new Error('Could not reach maven.minecraftforge.net to check the installer');
    };

    await launch('exit 0', forge);

    expect((await exitInfo()).crashed).toBe(false);
    expect(state.logged.join('\n')).toContain('Could not check the Forge install again');
  });

  it('is not started after a crash on a patched client that no longer matches', async () => {
    const { refusalOf } = await import('../src/core/util/refusal');
    await installForge();
    await launch('exit 1', forge);
    await exitInfo();
    // Same size, different bytes — and an installer that did not put it right.
    await fs.writeFile(patched(), 'THE PATCHED CLIENT');

    const err = await launch('exit 0', forge).catch((e: unknown) => e);

    expect(refusalOf(err)?.key).toBe('launchError.loaderFileMissing');
  });
});

describe.skipIf(!posix)('a profile on a loader build that is not offered', () => {
  // Forge for 1.16.5 from before 36.2.26: installed because a pack named it,
  // and stopped by a constructor the Java 8 of today no longer has.
  const onForge = (build: string) =>
    ({ minecraftVersion: '1.16.5', modLoader: 'forge', modLoaderVersion: build }) as const;

  /** That build as its install leaves it, beside the game it extends. */
  async function installForge(build: string): Promise<void> {
    await place(path.join(cacheDir(), 'versions', '1.16.5', '1.16.5.jar'), 'the client jar');
    const made = `net/minecraftforge/forge/1.16.5-${build}/forge-1.16.5-${build}.jar`;
    const jar = await place(path.join(cacheDir(), 'libraries', made), 'forge itself');
    const dir = path.join(root, 'data', 'loaders', 'forge', `1.16.5-${build}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'forge-profile.json'),
      JSON.stringify({
        id: `1.16.5-forge-${build}`,
        inheritsFrom: '1.16.5',
        mainClass: 'cpw.mods.modlauncher.Launcher',
        libraries: [
          {
            name: `net.minecraftforge:forge:1.16.5-${build}`,
            downloads: { artifact: { path: made, url: '', ...jar } },
          },
        ],
      }),
    );
  }

  const crash = [`echo 'java.lang.NoSuchMethodError: ManifestEntryVerifier'`, 'exit 1'].join('\n');

  it('is started all the same, and says what it is in the report its crash leaves', async () => {
    await installForge('36.2.20');

    await launch(crash, onForge('36.2.20'));

    const info = await exitInfo();
    expect(info.crashed).toBe(true);
    expect(await fs.readFile(info.reportPath!, 'utf-8')).toContain(
      'Mod loader: forge 36.2.20 — not a build the launcher offers for this Minecraft version',
    );
  });

  it('is not what a crash on an offered build is called', async () => {
    await installForge('36.2.34');

    await launch(crash, onForge('36.2.34'));

    const report = await fs.readFile((await exitInfo()).reportPath!, 'utf-8');
    expect(report).toContain('Mod loader: forge 36.2.34\n');
    expect(report).not.toContain('not a build the launcher offers');
  });
});

describe.skipIf(!posix)('a profile with no Forge in it', () => {
  it('is not given Forge’s library property', async () => {
    await launch('exit 0');
    await exitInfo();

    expect((await gameArgs()).some((arg) => arg.startsWith('-DlibraryDirectory='))).toBe(false);
  });
});

describe.skipIf(!posix)('the launch after a crash', () => {
  const marker = () => path.join(root, 'data', 'profiles', 'p1', '.recheck-game-files');

  it('reads every game file back, once', async () => {
    // A file that went bad on disk still has its size, which is all an
    // ordinary launch looks at.
    const jar = path.join(cacheDir(), 'versions', '1.21.4', '1.21.4.jar');
    await launch('exit 1');
    await exitInfo();
    await expect(fs.access(marker())).resolves.toBeUndefined();

    await fs.writeFile(jar, 'THE CLIENT JAR');
    state.sent.length = 0;
    // Same size, different bytes, and nowhere to fetch the real one from: only a
    // launch that reads the file notices, and it fails on the download.
    await expect(launcher.launchGame({ profileId: 'p1' })).rejects.toThrow(/Failed to download/);
  });

  it('goes back to checking sizes once that launch has got through', async () => {
    await launch('exit 1');
    await exitInfo();
    state.sent.length = 0;

    await launch('exit 0');
    await exitInfo();

    await expect(fs.access(marker())).rejects.toThrow();
  });

  it('is not asked for by a game that simply closed', async () => {
    await launch('exit 0');
    await exitInfo();

    await expect(fs.access(marker())).rejects.toThrow();
  });
});

/**
 * Log4Shell. Minecraft 1.7.2 to 1.18 resolve `${jndi:…}` in anything they log,
 * chat included, unless they are started with a configuration that stops it.
 */
describe.skipIf(!posix)('a game whose log4j looks things up', () => {
  const CONFIG = '-Dlog4j.configurationFile=';

  /** Give the version this log4j, already on disk like every other file. */
  async function withLog4j(version: string): Promise<void> {
    const libPath = `org/apache/logging/log4j/log4j-core/${version}/log4j-core-${version}.jar`;
    const jar = await place(path.join(cacheDir(), 'libraries', libPath), `log4j-core ${version}`);
    state.meta!.libraries = [
      {
        name: `org.apache.logging.log4j:log4j-core:${version}`,
        downloads: { artifact: { path: libPath, url: NOT_FETCHED, ...jar } },
      },
    ];
  }

  it('is started with the configuration that stops it', async () => {
    await withLog4j('2.8.1');
    await launch('exit 0');
    await exitInfo();

    const config = (await gameArgs()).find((arg) => arg.startsWith(CONFIG))?.slice(CONFIG.length);
    expect(config).toBe(path.join(cacheDir(), 'log4j', 'client-no-lookups.xml'));
    expect(await fs.readFile(config!, 'utf-8')).toContain('%msg{nolookups}');
  });

  it('gets the stricter one when its log4j cannot switch lookups off', async () => {
    await withLog4j('2.0-beta9');
    await launch('exit 0');
    await exitInfo();

    const config = (await gameArgs()).find((arg) => arg.startsWith(CONFIG))?.slice(CONFIG.length);
    expect(config).toBe(path.join(cacheDir(), 'log4j', 'client-regex-filter.xml'));
    expect(await fs.readFile(config!, 'utf-8')).toContain('RegexFilter');
  });

  it('is left to a configuration the player names themselves', async () => {
    // The JVM keeps the last `-D` it is given for a property, so the launcher's
    // has to come first for the profile's own to be the one that counts.
    await withLog4j('2.8.1');
    await launch('exit 0', { javaArgs: `${CONFIG}/opt/pack/log4j2.xml` });
    await exitInfo();

    const configs = (await gameArgs()).filter((arg) => arg.startsWith(CONFIG));
    expect(configs).toHaveLength(2);
    expect(configs.at(-1)).toBe(`${CONFIG}/opt/pack/log4j2.xml`);
  });

  it('is not what a current version is, and that one is started as it always was', async () => {
    await withLog4j('2.24.1');
    await launch('exit 0');
    await exitInfo();

    expect((await gameArgs()).filter((arg) => arg.startsWith(CONFIG))).toEqual([]);
    await expect(fs.access(path.join(cacheDir(), 'log4j'))).rejects.toThrow();
  });
});

/**
 * The token the game is started with is a live credential for the player's
 * Minecraft account, and Minecraft 1.8.9 prints it on every start.
 */
describe.skipIf(!posix)('the session token', () => {
  const SESSION = '[12:00:00] [Client thread/INFO]: (Session ID is token:';
  const printsIt = `echo '${SESSION}${TOKEN}:069a79f444e94726a5befca90e38aaf5)'`;

  it('is kept out of the launcher’s log, the live console and the buffer behind both', async () => {
    await launch([printsIt, 'echo ready', 'exec sleep 30'].join('\n'));
    await vi.waitFor(() => expect(launcher.getLogTail('p1')).toContain('ready'));

    const redacted = `${SESSION}<redacted>:069a79f444e94726a5befca90e38aaf5)`;
    expect(launcher.getLogTail('p1')).toEqual([redacted, 'ready']);
    // A moment later: the console is sent what has gathered, not each line.
    await vi.waitFor(() =>
      expect(gameLines().map((line) => line.message)).toEqual([redacted, 'ready']),
    );
    // The line is still logged — it is the token that is not.
    expect(state.logged).toContain(`[MC:Survival] ${redacted}`);
    expect(state.logged.join('\n')).not.toContain(TOKEN);
  });

  it('is kept out of what a crash leaves behind', async () => {
    await launch([printsIt, 'exit 1'].join('\n'));

    const info = await exitInfo();
    expect(info.logTail).toEqual([`${SESSION}<redacted>:069a79f444e94726a5befca90e38aaf5)`]);
    expect(JSON.stringify(info)).not.toContain(TOKEN);
    expect(await fs.readFile(info.reportPath!, 'utf-8')).not.toContain(TOKEN);
  });

  it('is not mistaken for the "0" an offline launch passes instead', async () => {
    state.account = { ...state.account, type: 'offline' };
    await launch(
      [`echo '[12:00:00] [main/INFO]: Loaded 0 advancements in 10 ms'`, 'exit 0'].join('\n'),
    );
    await exitInfo();

    expect((await gameArgs()).at(-1)).toBe('0');
    expect(gameLines().map((line) => line.message)).toEqual([
      '[12:00:00] [main/INFO]: Loaded 0 advancements in 10 ms',
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

    expect(path.dirname(info.reportPath!)).toBe(path.join(root, 'data', 'crash-reports'));
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

  it('reports a game that was killed under the player as a crash, and says by what', async () => {
    // The kernel's out-of-memory killer, in effect: SIGKILL, and so no exit
    // code at all — which used to be read as a game that closed normally.
    await launch([`echo '[12:00:00] [main/INFO]: Loading world'`, 'kill -KILL $$'].join('\n'));

    const info = await exitInfo();
    expect(info.crashed).toBe(true);
    expect(info.logTail).toEqual(['[12:00:00] [main/INFO]: Loading world']);

    const report = await fs.readFile(info.reportPath!, 'utf-8');
    expect(report).toContain('Killed by signal: SIGKILL');
    expect(report).toContain('Exit code: —');
  });
});

describe.skipIf(!posix)('a game that is running', () => {
  it('refuses to be started a second time', async () => {
    await launch('exec sleep 30');
    expect(launcher.isGameRunning('p1')).toBe(true);

    const { refusalOf } = await import('../src/core/util/refusal');
    const err = await launcher.launchGame({ profileId: 'p1' }).catch((e: unknown) => e);
    expect(refusalOf(err)).toEqual({ key: 'launchError.alreadyRunning' });
  });

  it('is stopped on request, and is not reported stopped until it has', async () => {
    await launch('exec sleep 30');

    await launcher.killGame('p1');

    expect(launcher.isGameRunning('p1')).toBe(false);
    await exitInfo();
  });

  it('is not reported as crashed for having been stopped', async () => {
    // What a JVM does with the SIGTERM that Stop sends: it runs its shutdown
    // hooks and exits 143. That is a non-zero exit, and it is not a crash.
    await launch(
      ["trap 'kill $pid; exit 143' TERM", 'sleep 30 &', 'pid=$!', 'echo ready', 'wait $pid'].join(
        '\n',
      ),
    );
    await vi.waitFor(() => expect(gameLines().map((l) => l.message)).toContain('ready'));

    await launcher.killGame('p1');

    expect(await exitInfo()).toMatchObject({ exitCode: 143, crashed: false });
    expect((await exitInfo()).reportPath).toBeUndefined();
    await expect(fs.readdir(path.join(root, 'data', 'crash-reports'))).rejects.toThrow();
  });

  it('is not reported as crashed when the stop kills it outright either', async () => {
    await launch('exec sleep 30');

    await launcher.killGame('p1');

    expect((await exitInfo()).crashed).toBe(false);
  });
});

/**
 * Stopping a game on Windows, which has no signal to ask with.
 *
 * Stop there is `taskkill` without `/F`: the request a click on the X in the
 * game's window makes. The launcher starts it by the path Windows keeps it at,
 * and whether that works is something only a Windows shows — so these two run
 * there and nowhere else, against a stand-in that has a window, and one that
 * has none.
 */
describe.skipIf(posix)('a game that is running, on Windows', () => {
  let standIn: string;

  beforeAll(async () => {
    standIn = await standInJava();
  }, STAND_IN_BUILD_MS);

  afterAll(async () => {
    if (standIn) await fs.rm(path.dirname(standIn), { recursive: true, force: true });
  });

  /** Press Play on a profile whose runtime is the stand-in, and wait for it to say it is up. */
  async function start(does: 'window' | 'wait', says: RegExp): Promise<void> {
    await fs.mkdir(path.dirname(javaBin()), { recursive: true });
    await fs.copyFile(standIn, javaBin());
    await fs.writeFile(`${javaBin()}.does`, does);
    state.profile = {
      id: 'p1',
      name: 'Survival',
      minecraftVersion: '1.21.4',
      modLoader: 'vanilla',
      allocatedRamMb: 1024,
      customJavaPath: javaBin(),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await launcher.launchGame({ profileId: 'p1' });
    await vi.waitFor(
      () =>
        expect(
          gameLines()
            .map((l) => l.message)
            .join('\n'),
        ).toMatch(says),
      {
        timeout: 20_000,
      },
    );
  }

  // With room for a window that is slow to come up: the wait for it is longer
  // than the five seconds a test is given.
  it('is asked to close through its window, and leaves of its own accord', async () => {
    await start('window', /The window is up/);

    await launcher.killGame('p1');

    // Zero is the game closing its own window. One that had to be ended has no
    // exit code of its own to give.
    expect(await exitInfo()).toMatchObject({ exitCode: 0, crashed: false });
    expect(launcher.isGameRunning('p1')).toBe(false);
  }, 40_000);

  it('is ended outright when it has no window to be asked through', async () => {
    // `taskkill` reports nothing wrong about a program with no window: it has
    // asked, and there was nobody to hear. So this is the long way round — the
    // ten seconds a game is given to close, and then the end of it.
    await start('wait', /Staying, with no window/);

    await launcher.killGame('p1');

    const ended = await exitInfo();
    expect(ended.crashed).toBe(false);
    expect(ended.exitCode).not.toBe(0);
    expect(launcher.isGameRunning('p1')).toBe(false);
  }, 40_000);
});
