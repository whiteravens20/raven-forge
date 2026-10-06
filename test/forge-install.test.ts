// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Installing Forge: an installer fetched from a repository and then executed.
 *
 * Everything around the Java process is the launcher's — which file it takes,
 * what it checks it against, which Java runs it, where, and what the player is
 * told when it does not finish. Here the repository is a local server and the
 * JVM is a shell script that does what the real installer leaves behind.
 */

const posix = process.platform !== 'win32';

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

vi.mock('../src/main/window', () => ({ getMainWindow: () => undefined }));

let base = '';
vi.mock('../src/shared/constants', async (original) => ({
  ...(await original<typeof import('../src/shared/constants')>()),
  get FORGE_MAVEN_ROOT() {
    return `${base}/forge`;
  },
}));

const MC = '1.20.1';
const BUILD = '47.4.10';
const INSTALLER = `/forge/${MC}-${BUILD}/forge-${MC}-${BUILD}-installer.jar`;
const CLIENT = '/client.jar';
const clientBytes = Buffer.from('the vanilla client');

const sha1 = (data: Buffer) => crypto.createHash('sha1').update(data).digest('hex');

vi.mock('../src/core/minecraft/version-manifest', () => ({
  getVersionMeta: async () => ({
    id: MC,
    javaVersion: { majorVersion: 17 },
    downloads: {
      client: { url: `${base}${CLIENT}`, sha1: sha1(clientBytes), size: clientBytes.length },
    },
  }),
}));

type Installer = typeof import('../src/core/modloader/forge-installer');

let root: string;
let server: http.Server;
let installerBytes: Buffer;
/** Path → body, or a status to answer with. */
let served: Record<string, Buffer | string | number>;
let requests: string[];
let mod: Installer;

/** A jar holding the one entry the launcher reads before it runs the installer. */
async function buildInstaller(): Promise<Buffer> {
  const { ZipWriter } = await import('../src/core/packs/zip-writer');
  const file = path.join(root, 'build-installer.jar');
  const zip = await ZipWriter.create(file);
  await zip.addBuffer('version.json', Buffer.from(JSON.stringify({ id: `${MC}-forge-${BUILD}` })));
  await zip.finish();
  const bytes = await fs.readFile(file);
  await fs.rm(file);
  return bytes;
}

// A build from before the installer had anything to run: Forge for 1.7.10.
const OLD_MC = '1.7.10';
const OLD_BUILD = '10.13.4.1614-1.7.10';
const OLD_INSTALLER = `/forge/${OLD_MC}-${OLD_BUILD}/forge-${OLD_MC}-${OLD_BUILD}-installer.jar`;
const OLD_COORDS = `net.minecraftforge:forge:${OLD_MC}-${OLD_BUILD}`;
const OLD_JAR = `net/minecraftforge/forge/${OLD_MC}-${OLD_BUILD}/forge-${OLD_MC}-${OLD_BUILD}.jar`;
const universal = Buffer.from('the forge jar');

/**
 * Such an installer: the Forge jar under the name it has in there, and a
 * profile that says where that jar goes and what the game is started with.
 */
async function serveOldInstaller(versionInfo: Record<string, unknown>): Promise<void> {
  const { ZipWriter } = await import('../src/core/packs/zip-writer');
  const file = path.join(root, 'build-old-installer.jar');
  const zip = await ZipWriter.create(file);
  await zip.addBuffer(
    'install_profile.json',
    Buffer.from(
      JSON.stringify({
        install: { path: OLD_COORDS, filePath: `forge-${OLD_MC}-${OLD_BUILD}-universal.jar` },
        versionInfo,
      }),
    ),
  );
  await zip.addBuffer(`forge-${OLD_MC}-${OLD_BUILD}-universal.jar`, universal);
  await zip.finish();
  const bytes = await fs.readFile(file);
  await fs.rm(file);
  served[OLD_INSTALLER] = bytes;
  served[`${OLD_INSTALLER}.sha1`] = sha1(bytes);
}

const oldProfile = {
  id: `${OLD_MC}-Forge${OLD_BUILD}`,
  inheritsFrom: OLD_MC,
  mainClass: 'net.minecraft.launchwrapper.Launch',
  minecraftArguments:
    '--username ${auth_player_name} --tweakClass cpw.mods.fml.common.launcher.FMLTweaker',
  libraries: [
    { name: OLD_COORDS, url: 'https://maven.minecraftforge.net/' },
    { name: 'net.minecraft:launchwrapper:1.12', serverreq: true },
    {
      name: 'org.scala-lang:scala-library:2.11.1',
      url: 'http://files.minecraftforge.net/maven/',
      checksums: [
        '0e11da23da3eabab9f4777b9220e60d44c1aab6a',
        '1e4df76e835201c6eabd43adca89ab11f225f134',
      ],
    },
  ],
};

const installOld = () => mod.installForgeLike('forge', OLD_BUILD, OLD_MC, () => {});
const oldProfileFile = () =>
  path.join(root, 'loaders', 'forge', `${OLD_MC}-${OLD_BUILD}`, 'forge-profile.json');

/** The one file of the build that the installer makes and nobody serves. */
const PATCHED = `net/minecraftforge/forge/${MC}-${BUILD}/forge-${MC}-${BUILD}-client.jar`;
const patchedClient = () => path.join(root, 'cache', 'libraries', PATCHED);

/**
 * Something that answers `-version` as Java 17 and, run as an installer, leaves
 * what one leaves: the version profile under the install root, and the patched
 * client that profile lists with no address to fetch it from. It also writes
 * down where it was started and how often.
 */
async function writeFakeJava(): Promise<string> {
  const bin = path.join(root, 'jdk', 'bin', 'java');
  const id = `${MC}-forge-${BUILD}`;
  const profile = JSON.stringify({
    id,
    mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
    libraries: [
      {
        name: `net.minecraftforge:forge:${MC}-${BUILD}:client`,
        downloads: { artifact: { path: PATCHED, url: '' } },
      },
    ],
  });
  await fs.mkdir(path.dirname(bin), { recursive: true });
  await fs.writeFile(
    bin,
    `#!/bin/sh\n` +
      `if [ "$1" = "-version" ]; then echo 'openjdk version "17.0.9" 2023-10-17' >&2; exit 0; fi\n` +
      `echo "$PWD" >> "${root}/installer-runs"\n` +
      `mkdir -p "$4/versions/${id}" "$4/libraries/${path.posix.dirname(PATCHED)}"\n` +
      `echo 'the patched client' > "$4/libraries/${PATCHED}"\n` +
      `echo '${profile}' > "$4/versions/${id}/${id}.json"\n`,
    { mode: 0o755 },
  );
  return bin;
}

const installerRuns = async (): Promise<string[]> => {
  try {
    return (await fs.readFile(path.join(root, 'installer-runs'), 'utf-8')).trim().split('\n');
  } catch {
    return [];
  }
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-forge-install-'));
  process.env.RAVENFORGE_DATA_DIR = root;
  requests = [];

  installerBytes = await buildInstaller();
  served = {
    [INSTALLER]: installerBytes,
    [`${INSTALLER}.sha1`]: sha1(installerBytes),
    [CLIENT]: clientBytes,
  };
  server = http.createServer((req, res) => {
    const url = req.url ?? '';
    requests.push(`${req.method} ${url}`);
    const body = served[url];
    if (body === undefined || typeof body === 'number') {
      res.statusCode = body ?? 404;
      res.end();
      return;
    }
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  vi.resetModules();
  const { reloadDataRoot } = await import('../src/core/config/data-root');
  reloadDataRoot();
  mod = await import('../src/core/modloader/forge-installer');
});

afterEach(async () => {
  delete process.env.RAVENFORGE_DATA_DIR;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(root, { recursive: true, force: true });
});

const install = (options: Parameters<Installer['installForgeLike']>[4] = {}) =>
  mod.installForgeLike('forge', BUILD, MC, () => {}, options);

describe('installing a Forge build from before 1.12.2’s last', () => {
  it('copies the Forge jar out of the installer and runs nothing', async () => {
    await serveOldInstaller(oldProfile);

    // No Java was named and none is on offer here: asked for one, this fails.
    await installOld();

    const jar = path.join(root, 'cache', 'libraries', OLD_JAR);
    expect(await fs.readFile(jar)).toEqual(universal);
    expect(await fs.readdir(path.dirname(jar))).toEqual([path.basename(jar)]);
    // The installer has done its job, as a later one has.
    expect(await fs.readdir(path.dirname(oldProfileFile()))).toEqual(['forge-profile.json']);
  });

  it('writes a profile the launch can use as it is', async () => {
    await serveOldInstaller(oldProfile);

    await installOld();

    const profile = JSON.parse(await fs.readFile(oldProfileFile(), 'utf-8'));
    expect(profile).toMatchObject({
      inheritsFrom: OLD_MC,
      mainClass: 'net.minecraft.launchwrapper.Launch',
      minecraftArguments: oldProfile.minecraftArguments,
    });
    expect(profile.libraries).toEqual([
      // Its own jar, as something to find and never to fetch: there is no
      // `forge-….jar` at the address the installer's profile gives for it.
      {
        name: OLD_COORDS,
        downloads: {
          artifact: { path: OLD_JAR, url: '', sha1: sha1(universal), size: universal.length },
        },
      },
      oldProfile.libraries[1],
      // A plain-http repository is asked over https; the downloader takes a
      // library over nothing else.
      { ...oldProfile.libraries[2], url: 'https://files.minecraftforge.net/maven/' },
    ]);
  });

  it('counts as installed afterwards, and not once its jar has gone', async () => {
    const { isLoaderProfileComplete } = await import('../src/core/modloader/loader-profile');
    await serveOldInstaller(oldProfile);
    await installOld();
    expect(await isLoaderProfileComplete('forge', OLD_BUILD, OLD_MC)).toBe(true);

    await fs.rm(path.join(root, 'cache', 'libraries', OLD_JAR));
    expect(await isLoaderProfileComplete('forge', OLD_BUILD, OLD_MC)).toBe(false);

    // Which is what has the next launch install it again.
    await installOld();
    expect(await isLoaderProfileComplete('forge', OLD_BUILD, OLD_MC)).toBe(true);
  });

  it('finds the build a pack names by its number alone', async () => {
    // A Modrinth pack for 1.7.10 says `10.13.4.1614`. There is no installer at
    // the address that makes; Forge's list has the build with a branch after it.
    await serveOldInstaller(oldProfile);
    served['/forge/maven-metadata.xml'] = Buffer.from(
      `<metadata><versioning><versions><version>${OLD_MC}-10.13.4.1566-1.7.10</version>` +
        `<version>${OLD_MC}-${OLD_BUILD}</version></versions></versioning></metadata>`,
    );

    await mod.installForgeLike('forge', '10.13.4.1614', OLD_MC, () => {});

    // Kept under the name the profile has for it, which is the one it is asked for by.
    const profile = path.join(
      root,
      'loaders',
      'forge',
      `${OLD_MC}-10.13.4.1614`,
      'forge-profile.json',
    );
    expect(JSON.parse(await fs.readFile(profile, 'utf-8'))).toMatchObject({ inheritsFrom: OLD_MC });
  });

  it('still says a build is not published when the list has nothing by that number either', async () => {
    await serveOldInstaller(oldProfile);
    served['/forge/maven-metadata.xml'] = Buffer.from(
      `<metadata><versioning><versions><version>${OLD_MC}-${OLD_BUILD}</version></versions></versioning></metadata>`,
    );

    await expect(mod.installForgeLike('forge', '10.13.4.9999', OLD_MC, () => {})).rejects.toThrow(
      /does not publish this build/,
    );
  });

  it('refuses, in words the player can act on, a profile that extends nothing', async () => {
    const { refusalOf } = await import('../src/core/util/refusal');
    // The form before 1.7.10, which some of that version's first builds kept.
    await serveOldInstaller({ ...oldProfile, inheritsFrom: undefined });

    const err = await installOld().catch((e: unknown) => e);

    expect(refusalOf(err)).toEqual({
      key: 'launchError.loaderBuildTooOld',
      vars: { loader: `Forge ${OLD_BUILD}` },
    });
    await expect(fs.access(oldProfileFile())).rejects.toThrow();
  });

  it('still says so when an installer is neither kind', async () => {
    const { ZipWriter } = await import('../src/core/packs/zip-writer');
    const file = path.join(root, 'empty-installer.jar');
    const zip = await ZipWriter.create(file);
    await zip.addBuffer('README.txt', Buffer.from('nothing to install'));
    await zip.finish();
    served[OLD_INSTALLER] = await fs.readFile(file);
    served[`${OLD_INSTALLER}.sha1`] = sha1(served[OLD_INSTALLER] as Buffer);

    await expect(installOld()).rejects.toThrow(/contains no version\.json/);
  });
});

describe.skipIf(!posix)('installing Forge', () => {
  it('runs the installer on the Java the profile names, from its own folder', async () => {
    const javaPath = await writeFakeJava();

    await install({ javaPath });

    // Its own folder, so the log the installer writes beside itself does not
    // land wherever the launcher happened to be started from.
    expect(await installerRuns()).toEqual([path.join(root, 'loaders', 'forge', `${MC}-${BUILD}`)]);
    const profile = path.join(root, 'loaders', 'forge', `${MC}-${BUILD}`, 'forge-profile.json');
    expect(JSON.parse(await fs.readFile(profile, 'utf-8'))).toMatchObject({
      id: `${MC}-forge-${BUILD}`,
    });
  });

  it('runs one installer when two launches want the same build', async () => {
    const javaPath = await writeFakeJava();

    await Promise.all([install({ javaPath }), install({ javaPath })]);

    expect(await installerRuns()).toHaveLength(1);
  });

  it('leaves a build that is installed alone', async () => {
    const javaPath = await writeFakeJava();

    await install({ javaPath });
    await install({ javaPath });

    expect(await installerRuns()).toHaveLength(1);
  });

  it('runs the installer again when a file only it can make has gone', async () => {
    // The profile is still there, and used to be all that was asked about: the
    // build counted as installed, and the launch then tried to download the
    // missing file from the empty address the profile gives for it.
    const javaPath = await writeFakeJava();
    await install({ javaPath });
    await fs.rm(patchedClient());

    await install({ javaPath });

    expect(await installerRuns()).toHaveLength(2);
    expect(await fs.readFile(patchedClient(), 'utf-8')).toBe('the patched client\n');
  });

  it('runs the installer over a build that is installed when asked to check it', async () => {
    const javaPath = await writeFakeJava();
    await install({ javaPath });

    await install({ javaPath, repair: true });

    expect(await installerRuns()).toHaveLength(2);
  });

  it('fetches the client jar again when the one on disk is not the real one', async () => {
    // What a launcher closed mid-download used to leave, and every later
    // install then patched: a file of the right name and the wrong content.
    const javaPath = await writeFakeJava();
    const jar = path.join(root, 'cache', 'versions', MC, `${MC}.jar`);
    await fs.mkdir(path.dirname(jar), { recursive: true });
    await fs.writeFile(jar, 'half a jar');

    await install({ javaPath });

    expect(await fs.readFile(jar)).toEqual(clientBytes);
  });

  it('refuses an installer that is not the one the repository vouches for', async () => {
    const javaPath = await writeFakeJava();
    served[`${INSTALLER}.sha1`] = sha1(Buffer.from('some other jar'));

    await expect(install({ javaPath })).rejects.toThrow(/sha1 mismatch/);
    expect(await installerRuns()).toEqual([]);
  });

  it('says the build does not exist rather than offering to skip verification', async () => {
    const javaPath = await writeFakeJava();
    delete served[INSTALLER];
    delete served[`${INSTALLER}.sha1`];

    await expect(install({ javaPath })).rejects.toThrow(/does not publish this build/);
  });

  it('still refuses a real build that has no checksum beside it', async () => {
    const javaPath = await writeFakeJava();
    delete served[`${INSTALLER}.sha1`];

    await expect(install({ javaPath })).rejects.toThrow(/cannot be verified/);
    expect(await installerRuns()).toEqual([]);
  });

  it('reports a repository that cannot be reached as that', async () => {
    const javaPath = await writeFakeJava();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    await expect(install({ javaPath })).rejects.toThrow(/Could not reach 127\.0\.0\.1/);
    // Left listening for `afterEach`, which closes it.
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  it('ends as a cancellation when it is called off', async () => {
    const javaPath = await writeFakeJava();
    const { isCancellation } = await import('../src/core/util/cancellation');

    const err = await install({ javaPath, signal: AbortSignal.abort() }).catch((e: unknown) => e);

    expect(isCancellation(err)).toBe(true);
    expect(await installerRuns()).toEqual([]);
  });
});
