import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ProgressEvent, ProgressMessage } from '../src/shared/ipc-types';
import type { VersionMeta } from '../src/core/minecraft/types';

/**
 * What the launcher says it is doing to the game files.
 *
 * Preparing a launch is two passes over the same list — check what is on disk,
 * then fetch what failed the check — and only the second one is a download. The
 * first is the whole of a launch that has nothing to fetch, and it used to run
 * behind a frozen bar labelled "Downloading game assets", so every Play on a
 * fully installed profile looked like Minecraft being downloaded again. These
 * tests pin the labels to the pass that is actually running.
 */

const events: ProgressEvent[] = [];

vi.mock('../src/main/window', () => ({
  getMainWindow: () => ({
    webContents: {
      send: (_channel: string, event: ProgressEvent) => {
        events.push(event);
      },
    },
  }),
}));

vi.mock('../src/core/config/settings-manager', () => ({
  getSettings: async () => ({ downloadConcurrency: 4 }),
}));

const { ensureLibraries } = await import('../src/core/minecraft/asset-downloader');

let dir: string;
let server: http.Server;
let base: string;
let served: Record<string, string>;

beforeEach(async () => {
  events.length = 0;
  served = {};
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-progress-'));
  server = http.createServer((req, res) => {
    const body = served[req.url ?? ''];
    if (body === undefined) {
      res.statusCode = 404;
      res.end('missing');
      return;
    }
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

const sha1 = (body: string) => crypto.createHash('sha1').update(body).digest('hex');

/** One library entry plus the bytes it is meant to hold. */
function library(name: string, body: string) {
  const libPath = `org/example/${name}/1.0/${name}-1.0.jar`;
  return {
    body,
    libPath,
    entry: {
      name: `org.example:${name}:1.0`,
      downloads: {
        artifact: {
          path: libPath,
          url: `${base}/${libPath}`,
          sha1: sha1(body),
          size: Buffer.byteLength(body),
        },
      },
    },
  };
}

function metaOf(libs: ReturnType<typeof library>[]): VersionMeta {
  return { id: '1.21.4', libraries: libs.map((l) => l.entry) } as unknown as VersionMeta;
}

/** Put a library on disk exactly as its entry declares it. */
async function place(lib: ReturnType<typeof library>): Promise<void> {
  const dest = path.join(dir, lib.libPath);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, lib.body);
}

const keyOf = (message: ProgressMessage): string | undefined =>
  'key' in message ? message.key : undefined;

const keys = () => events.map((e) => keyOf(e.message));

describe('game file progress', () => {
  it('says it is checking, not downloading, when nothing has to be fetched', async () => {
    const libs = [library('alpha', 'aaa'), library('beta', 'bbbb')];
    for (const lib of libs) await place(lib);

    await ensureLibraries(dir, metaOf(libs));

    expect(keys()).toContain('progress.msg.checkingLibraries');
    expect(keys()).not.toContain('progress.msg.libraries');
    expect(keys()).not.toContain('progress.msg.downloadComplete');
  });

  it('ends a launch with nothing missing by saying so', async () => {
    const libs = [library('alpha', 'aaa')];
    for (const lib of libs) await place(lib);

    await ensureLibraries(dir, metaOf(libs));

    const last = events.at(-1);
    expect(last?.progress).toBe(1);
    expect(keyOf(last!.message)).toBe('progress.msg.gameFilesReady');
  });

  it('calls it a download only once there is one', async () => {
    const present = library('alpha', 'aaa');
    const missing = library('beta', 'bbbb');
    await place(present);
    served[`/${missing.libPath}`] = missing.body;

    await ensureLibraries(dir, metaOf([present, missing]));

    expect(keys()).toContain('progress.msg.checkingLibraries');
    expect(keys()).toContain('progress.msg.libraries');
    const last = events.at(-1);
    expect(last?.progress).toBe(1);
    expect(keyOf(last!.message)).toBe('progress.msg.downloadComplete');
    await expect(fs.readFile(path.join(dir, missing.libPath), 'utf-8')).resolves.toBe(missing.body);
  });

  it('never lets the checking pass report a finished operation', async () => {
    // A progress of 1 is how the renderer is told an operation is over, and it
    // then removes the entry. The check finishing is not the job finishing.
    const libs = Array.from({ length: 40 }, (_, i) => library(`lib${i}`, `body-${i}`));
    for (const lib of libs) await place(lib);

    await ensureLibraries(dir, metaOf(libs));

    const checking = events.filter((e) => keyOf(e.message) === 'progress.msg.checkingLibraries');
    expect(checking.length).toBeGreaterThan(0);
    for (const event of checking) expect(event.progress).toBeLessThan(1);
  });

  it('counts the files it has checked, not the ones it has downloaded', async () => {
    const libs = Array.from({ length: 5 }, (_, i) => library(`lib${i}`, `body-${i}`));
    for (const lib of libs) await place(lib);

    await ensureLibraries(dir, metaOf(libs));

    const checking = events.filter((e) => keyOf(e.message) === 'progress.msg.checkingLibraries');
    for (const event of checking) {
      expect(event.filesTotal).toBe(libs.length);
      expect(event.filesCompleted).toBeLessThanOrEqual(libs.length);
    }
  });
});
