// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Library, VersionMeta } from '../src/core/minecraft/types';

/**
 * Which game files a launch reads, fetches and unpacks.
 *
 * Every Play goes through here with the game already installed, so what it does
 * with files that are fine matters more than what it does with missing ones:
 * how much of them it reads, and whether it leaves alone a library that another
 * profile's game has loaded.
 */

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

vi.mock('../src/main/window', () => ({ getMainWindow: () => undefined }));

vi.mock('../src/core/config/settings-manager', () => ({
  getSettings: async () => ({ downloadConcurrency: 4 }),
}));

const { ensureLibraries, ensureAssets } = await import('../src/core/minecraft/asset-downloader');

let dir: string;
let server: http.Server;
let base: string;
let served: Record<string, Buffer>;
let hits: string[];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-game-files-'));
  served = {};
  hits = [];
  server = http.createServer((req, res) => {
    const url = req.url ?? '';
    hits.push(url);
    const body = served[url];
    if (!body) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

const sha1 = (body: Buffer | string) => crypto.createHash('sha1').update(body).digest('hex');
const libs = () => path.join(dir, 'libraries');
const metaOf = (libraries: Library[]) => ({ id: '1.16.5', libraries }) as unknown as VersionMeta;

/** A library the server has, described the way a version lists it. */
function library(name: string, body: string): Library & { file: string } {
  const libPath = `org/example/${name}/1.0/${name}-1.0.jar`;
  served[`/${libPath}`] = Buffer.from(body);
  return {
    file: path.join(libs(), libPath),
    name: `org.example:${name}:1.0`,
    downloads: {
      artifact: {
        path: libPath,
        url: `${base}/${libPath}`,
        sha1: sha1(body),
        size: Buffer.byteLength(body),
      },
    },
  };
}

describe('files a version lists more than once', () => {
  it('are fetched once', async () => {
    // 1.13 to 1.18.2 name each LWJGL jar once per rule set.
    const lwjgl = library('lwjgl', 'the jar');

    const classpath = await ensureLibraries(libs(), metaOf([lwjgl, { ...lwjgl }, { ...lwjgl }]));

    expect(hits).toHaveLength(1);
    // Still on the classpath as often as it was listed; the JVM does not mind.
    expect(classpath).toEqual([lwjgl.file, lwjgl.file, lwjgl.file]);
  });

  it('are fetched once when they are assets sharing one object', async () => {
    const body = Buffer.from('the same sound');
    const hash = sha1(body);
    const index = {
      objects: { 'a.ogg': { hash, size: body.length }, 'b.ogg': { hash, size: body.length } },
    };
    const indexBytes = Buffer.from(JSON.stringify(index));
    const assetsDir = path.join(dir, 'assets');
    await fs.mkdir(path.join(assetsDir, 'indexes'), { recursive: true });
    await fs.writeFile(path.join(assetsDir, 'indexes', '1.16.json'), indexBytes);
    const fetched: string[] = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith('https://resources.download.minecraft.net/'))
        return realFetch(input, init);
      fetched.push(url);
      // Answered from the local server, so the transfer itself is a real one.
      served['/object'] = body;
      return realFetch(`${base}/object`, init);
    });

    try {
      await ensureAssets(assetsDir, {
        id: '1.16.5',
        assetIndex: {
          id: '1.16',
          sha1: sha1(indexBytes),
          size: indexBytes.length,
          totalSize: 0,
          url: '',
        },
      } as unknown as VersionMeta);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetched).toHaveLength(1);
  });
});
