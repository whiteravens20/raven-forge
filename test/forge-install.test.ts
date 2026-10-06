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

/**
 * Something that answers `-version` as Java 17 and, run as an installer, leaves
 * what one leaves: the version profile under the install root. It also writes
 * down where it was started and how often.
 */
async function writeFakeJava(): Promise<string> {
  const bin = path.join(root, 'jdk', 'bin', 'java');
  const id = `${MC}-forge-${BUILD}`;
  await fs.mkdir(path.dirname(bin), { recursive: true });
  await fs.writeFile(
    bin,
    `#!/bin/sh\n` +
      `if [ "$1" = "-version" ]; then echo 'openjdk version "17.0.9" 2023-10-17' >&2; exit 0; fi\n` +
      `echo "$PWD" >> "${root}/installer-runs"\n` +
      `mkdir -p "$4/versions/${id}"\n` +
      `echo '{"id":"${id}","mainClass":"cpw.mods.bootstraplauncher.BootstrapLauncher"}' ` +
      `> "$4/versions/${id}/${id}.json"\n`,
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

describe.skipIf(!posix)('installing Forge', () => {
  it('runs the installer on the Java the profile names', async () => {
    const javaPath = await writeFakeJava();

    await install({ javaPath });

    expect(await installerRuns()).toHaveLength(1);
    const profile = path.join(root, 'loaders', 'forge', `${MC}-${BUILD}`, 'forge-profile.json');
    expect(JSON.parse(await fs.readFile(profile, 'utf-8'))).toMatchObject({
      id: `${MC}-forge-${BUILD}`,
    });
  });
});
