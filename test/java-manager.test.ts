import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ProgressEvent } from '../src/shared/ipc-types';

/**
 * The managed Java runtime: found, judged, installed.
 *
 * Everything here runs without a JVM on the machine. `java -version` writes a
 * banner to stderr and exits, so a shell script that prints one *is* a Java
 * runtime as far as this module can tell — which is the point. The module's job
 * is not to be a JVM, it is to decide whether the thing it was handed is one,
 * and to refuse in a way the player can act on when it is not.
 *
 * The install path runs end to end: a real `.tar.gz` built by `tar`, served
 * over a real socket, with the sha256 Adoptium's API would have quoted. Only
 * the two lines that would reach Adoptium are stubbed. What that buys is the
 * step nothing else was checking — that the archive is verified *before* it is
 * unpacked and run, and that a mismatch leaves nothing behind.
 *
 * POSIX only: the fixtures are shell scripts, and the Windows branch downloads
 * a `.zip` it unpacks with bsdtar. Both are the platform's business rather than
 * this module's, and neither can be staged from here.
 */

const posix = process.platform !== 'win32';
const execFileAsync = promisify(execFile);

const { events } = vi.hoisted(() => ({ events: [] as Array<{ channel: string; event: unknown }> }));

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

vi.mock('../src/main/window', () => ({
  getMainWindow: () => ({
    webContents: {
      send: (channel: string, event: unknown) => {
        events.push({ channel, event });
      },
    },
  }),
}));

type Manager = typeof import('../src/core/java/java-manager');

let root: string;
/** What the stubbed Adoptium endpoint answers with, set per test. */
let adoptium: () => Response;
/** Requests the archive server actually received. */
let archiveHits: string[];
let server: http.Server;
let archiveUrl: string;
let archiveBytes: Buffer;

async function loadModule(): Promise<Manager> {
  vi.resetModules();
  const { reloadDataRoot } = await import('../src/core/config/data-root');
  reloadDataRoot();
  return import('../src/core/java/java-manager');
}

/**
 * The sayable form of a refusal, read the way the IPC layer reads it.
 *
 * Imported after `loadModule()` on purpose: `launchRefusal` is an `instanceof`
 * check, and a module registry reset between the throw and the check would give
 * two different `LaunchRefusedError` classes and a silent `undefined`.
 */
async function refusalOf(err: unknown) {
  const { launchRefusal } = await import('../src/core/minecraft/launch-errors');
  return launchRefusal(err);
}

/**
 * A file that answers `-version` the way a JVM does, and nothing else.
 *
 * `execFile` runs it directly, so the shebang is what makes it work; the banner
 * is copied from a real Temurin so the parser sees the shape it was written for.
 */
async function writeFakeJava(binPath: string, version: string): Promise<void> {
  await fs.mkdir(path.dirname(binPath), { recursive: true });
  await fs.writeFile(
    binPath,
    `#!/bin/sh\n` +
      `echo 'openjdk version "${version}" 2024-04-16' >&2\n` +
      `echo 'OpenJDK Runtime Environment Temurin-${version}+9 (build ${version}+9)' >&2\n` +
      `echo 'OpenJDK 64-Bit Server VM Temurin-${version}+9 (build ${version}+9, mixed mode)' >&2\n`,
    { mode: 0o755 },
  );
}

/** A JRE archive shaped the way Adoptium ships one: everything under one top directory. */
async function buildJreArchive(version: string): Promise<Buffer> {
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-jre-stage-'));
  const top = `jdk-${version}-jre`;
  await writeFakeJava(path.join(stage, top, 'bin', 'java'), version);
  await fs.writeFile(path.join(stage, top, 'release'), `JAVA_VERSION="${version}"\n`);
  const out = path.join(stage, 'jre.tar.gz');
  await execFileAsync('tar', ['-czf', out, '-C', stage, top]);
  const bytes = await fs.readFile(out);
  await fs.rm(stage, { recursive: true, force: true });
  return bytes;
}

function sha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function assetsFor(url: string, checksum: string | undefined): Response {
  const pkg: Record<string, unknown> = { link: url };
  if (checksum !== undefined) pkg.checksum = checksum;
  return new Response(JSON.stringify([{ binary: { package: pkg } }]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-java-'));
  process.env.RAVENFORGE_DATA_DIR = root;
  events.length = 0;
  archiveHits = [];

  if (!posix) return;

  archiveBytes = await buildJreArchive('21.0.3');
  server = http.createServer((req, res) => {
    archiveHits.push(req.url ?? '');
    res.writeHead(200, {
      'content-type': 'application/gzip',
      'content-length': String(archiveBytes.length),
    });
    res.end(archiveBytes);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  archiveUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/OpenJDK21U-jre.tar.gz`;
  adoptium = () => assetsFor(archiveUrl, sha256(archiveBytes));

  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    // Only Adoptium's index is invented. The archive comes down the real
    // downloader, over a real socket, into a real file.
    if (String(input).startsWith('https://api.adoptium.net')) return Promise.resolve(adoptium());
    return realFetch(input, init);
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.RAVENFORGE_DATA_DIR;
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(root, { recursive: true, force: true });
});

describe.skipIf(!posix)('probeJava', () => {
  it('reads the major version out of a runtime banner', async () => {
    const { probeJava } = await loadModule();
    const bin = path.join(root, 'fake', 'bin', 'java');
    await writeFakeJava(bin, '21.0.3');
    expect(await probeJava(bin)).toBe(21);
  });

  it('reads the 1.8 form as 8', async () => {
    const { probeJava } = await loadModule();
    const bin = path.join(root, 'old', 'bin', 'java');
    await writeFakeJava(bin, '1.8.0_392');
    expect(await probeJava(bin)).toBe(8);
  });

  it('answers null for an executable that is not a JVM', async () => {
    const { probeJava } = await loadModule();
    const bin = path.join(root, 'notjava');
    await fs.writeFile(bin, '#!/bin/sh\necho hello\n', { mode: 0o755 });
    expect(await probeJava(bin)).toBeNull();
  });

  it('answers null for a path with nothing at it', async () => {
    const { probeJava } = await loadModule();
    expect(await probeJava(path.join(root, 'absent', 'bin', 'java'))).toBeNull();
  });

  it('answers null for a binary that exits non-zero', async () => {
    const { probeJava } = await loadModule();
    const bin = path.join(root, 'broken');
    await fs.writeFile(bin, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    expect(await probeJava(bin)).toBeNull();
  });
});

describe.skipIf(!posix)('resolveChosenJava', () => {
  it('accepts a runtime that is exactly what the game asked for', async () => {
    const { resolveChosenJava } = await loadModule();
    const bin = path.join(root, 'chosen', 'bin', 'java');
    await writeFakeJava(bin, '21.0.3');
    expect(await resolveChosenJava(bin, 21)).toEqual({
      version: 21,
      path: bin,
      vendor: 'chosen in the profile',
      managed: false,
    });
  });

  it('accepts a newer runtime, which is the player’s call to make', async () => {
    const { resolveChosenJava } = await loadModule();
    const bin = path.join(root, 'newer', 'bin', 'java');
    await writeFakeJava(bin, '24.0.1');
    expect((await resolveChosenJava(bin, 21)).version).toBe(24);
  });

  it('refuses one that is too old, naming both versions for the renderer', async () => {
    const { resolveChosenJava } = await loadModule();
    const bin = path.join(root, 'old', 'bin', 'java');
    await writeFakeJava(bin, '17.0.9');

    const err = await resolveChosenJava(bin, 21).catch((e: unknown) => e);
    expect(await refusalOf(err)).toEqual({
      key: 'launchError.javaTooOld',
      vars: { path: bin, found: 17, required: 21 },
    });
  });

  it('refuses a path that is not a runtime at all', async () => {
    const { resolveChosenJava } = await loadModule();
    const bin = path.join(root, 'notjava');
    await fs.writeFile(bin, '#!/bin/sh\necho hello\n', { mode: 0o755 });

    const err = await resolveChosenJava(bin, 21).catch((e: unknown) => e);
    expect(await refusalOf(err)).toEqual({
      key: 'launchError.javaNotRuntime',
      vars: { path: bin },
    });
  });

  it('keeps an English sentence alongside the key, because that is what the log quotes', async () => {
    const { resolveChosenJava } = await loadModule();
    const bin = path.join(root, 'old', 'bin', 'java');
    await writeFakeJava(bin, '17.0.9');

    const err = (await resolveChosenJava(bin, 21).catch((e: unknown) => e)) as Error;
    expect(err.message).toContain(bin);
    expect(err.message).toMatch(/Java 17/);
  });

  it('does not answer for an ordinary failure', async () => {
    await loadModule();
    expect(await refusalOf(new Error('the disk went away'))).toBeUndefined();
    expect(await refusalOf('not even an error')).toBeUndefined();
  });
});

describe.skipIf(!posix)('ensureJavaVersion', () => {
  const managedJava = () => path.join(root, 'java', 'jre-21', 'bin', 'java');

  it('uses a managed runtime that is already there without going near the network', async () => {
    const { ensureJavaVersion } = await loadModule();
    await writeFakeJava(managedJava(), '21.0.3');

    expect(await ensureJavaVersion(21)).toEqual({
      version: 21,
      path: managedJava(),
      vendor: 'Adoptium Temurin',
      managed: true,
    });
    expect(archiveHits).toEqual([]);
  });

  it('reinstalls when bin/java is there but does not run', async () => {
    // What a extraction interrupted half way through leaves: the launcher
    // binary in place and the rest of the runtime missing. Presence alone used
    // to count as installed, so every later launch took the short path and died
    // inside the JVM instead.
    const { ensureJavaVersion } = await loadModule();
    await fs.mkdir(path.dirname(managedJava()), { recursive: true });
    await fs.writeFile(managedJava(), 'not a program', { mode: 0o755 });

    const result = await ensureJavaVersion(21);
    expect(archiveHits).toHaveLength(1);
    expect(result.managed).toBe(true);
    expect(await execFileAsync(result.path, ['-version']).then(({ stderr }) => stderr)).toContain(
      '21.0.3',
    );
  });

  it('downloads, verifies, unpacks and proves the runtime starts', async () => {
    const { ensureJavaVersion } = await loadModule();

    const result = await ensureJavaVersion(21);

    expect(result.path).toBe(managedJava());
    // `--strip-components=1` has to drop Adoptium's top directory, or bin/java
    // lands one level down and nothing that follows can find it.
    expect((await fs.stat(managedJava())).isFile()).toBe(true);
    await expect(fs.access(path.join(root, 'java', 'jre-21', 'release'))).resolves.toBeUndefined();
    // The archive is cleaned up: it is a few dozen megabytes and of no further use.
    await expect(fs.readdir(path.join(root, 'cache'))).resolves.toEqual([]);
  });

  it('reports the download and then says it is ready', async () => {
    const { ensureJavaVersion } = await loadModule();
    await ensureJavaVersion(21);

    const java = events.filter((e) => e.channel === 'progress:java-download');
    const messages = java.map((e) => (e.event as ProgressEvent).message);
    expect(messages[0]).toEqual({
      key: 'progress.msg.javaDownloading',
      vars: { version: 21 },
    });
    expect(messages.at(-1)).toEqual({ key: 'progress.msg.javaReady', vars: { version: 21 } });
    // Only the last one may say it finished — the renderer removes an entry
    // that reports a full bar.
    expect(java.slice(0, -1).every((e) => (e.event as ProgressEvent).progress < 1)).toBe(true);
  });

  it('refuses an archive whose hash is not the one Adoptium quoted', async () => {
    const { ensureJavaVersion } = await loadModule();
    adoptium = () => assetsFor(archiveUrl, sha256(Buffer.from('a different archive entirely')));

    await expect(ensureJavaVersion(21)).rejects.toThrow(/sha256 mismatch/i);
    // Nothing unpacked and nothing kept: a runtime that failed its check must
    // not be sitting in the cache to be picked up by anything later.
    await expect(fs.readdir(path.join(root, 'cache'))).resolves.toEqual([]);
    await expect(fs.access(path.join(root, 'java', 'jre-21'))).rejects.toThrow();
  });

  it('refuses to install a runtime Adoptium quoted no checksum for', async () => {
    const { ensureJavaVersion } = await loadModule();
    adoptium = () => assetsFor(archiveUrl, undefined);

    await expect(ensureJavaVersion(21)).rejects.toThrow(/cannot be verified/);
    // Refused before the transfer, not after: there is no unverified fallback.
    expect(archiveHits).toEqual([]);
  });

  it('fails when Adoptium lists no binary for this platform', async () => {
    const { ensureJavaVersion } = await loadModule();
    adoptium = () => new Response('[]', { status: 200 });

    await expect(ensureJavaVersion(21)).rejects.toThrow(/listed no JRE 21 binary/);
  });

  it('fails when Adoptium cannot be reached', async () => {
    const { ensureJavaVersion } = await loadModule();
    adoptium = () => new Response('nope', { status: 503 });

    await expect(ensureJavaVersion(21)).rejects.toThrow(/Could not reach Adoptium/);
  });

  it('builds the install directory out of digits, so a version meta cannot pick the path', async () => {
    const { ensureJavaVersion } = await loadModule();
    await writeFakeJava(managedJava(), '21.0.3');

    // The number naming this directory comes from a version meta off the
    // network. Whatever shape it arrives in, it can only ever name `jre-<n>`
    // inside the launcher's own java directory.
    const result = await ensureJavaVersion('../../21' as unknown as number);
    expect(result.path).toBe(managedJava());
  });

  it('stops on a signal that is already aborted', async () => {
    const { ensureJavaVersion } = await loadModule();
    await expect(ensureJavaVersion(21, AbortSignal.abort())).rejects.toThrow(/cancel/i);
    expect(archiveHits).toEqual([]);
  });
});

describe.skipIf(!posix)('detectSystemJava', () => {
  const javaHome = () => process.env.JAVA_HOME;
  let saved: string | undefined;

  beforeEach(() => {
    saved = javaHome();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.JAVA_HOME;
    else process.env.JAVA_HOME = saved;
  });

  it('finds the runtime JAVA_HOME points at', async () => {
    const { detectSystemJava } = await loadModule();
    const home = path.join(root, 'jdk21');
    await writeFakeJava(path.join(home, 'bin', 'java'), '21.0.3');
    process.env.JAVA_HOME = home;

    const found = await detectSystemJava();
    expect(found).toContainEqual({
      version: 21,
      path: path.join(home, 'bin', 'java'),
      vendor: 'system',
      managed: false,
    });
  });

  it('ignores a JAVA_HOME with no runtime under it', async () => {
    const { detectSystemJava } = await loadModule();
    const home = path.join(root, 'empty');
    await fs.mkdir(home, { recursive: true });
    process.env.JAVA_HOME = home;

    const found = await detectSystemJava();
    expect(found.some((i) => i.path.startsWith(home))).toBe(false);
  });

  it('lists no path twice, however many names lead to it', async () => {
    const { detectSystemJava } = await loadModule();
    const home = path.join(root, 'jdk-real');
    await writeFakeJava(path.join(home, 'bin', 'java'), '21.0.3');
    process.env.JAVA_HOME = path.join(root, 'jdk-link');
    await fs.symlink(home, path.join(root, 'jdk-link'));

    const found = await detectSystemJava();
    const resolved = await Promise.all(found.map((i) => fs.realpath(i.path)));
    expect(new Set(resolved).size).toBe(resolved.length);
  });
});
