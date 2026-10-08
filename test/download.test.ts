// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { downloadToFile } from '../src/core/net/download';

/**
 * The launcher's one download policy, over a real socket.
 *
 * There used to be four of these, with four different answers to "how long may
 * this take", "what happens to the partial file" and "what stops the reader
 * outrunning the disk". Everything that fetches a file now comes through here,
 * so this is the place those answers have to be right.
 */

let dir: string;
let server: http.Server;
let base: string;
let handler: http.RequestListener;

const sha256 = (body: string) => crypto.createHash('sha256').update(body).digest('hex');

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-dl-'));
  handler = (_req, res) => res.end('ok');
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

describe('downloadToFile', () => {
  it('writes the body and creates the parent directory', async () => {
    handler = (_req, res) => res.end('hello');
    const dest = path.join(dir, 'nested', 'file.txt');

    await downloadToFile(`${base}/x`, dest);

    expect(await fs.readFile(dest, 'utf-8')).toBe('hello');
  });

  it('does not leave a file behind when the server refuses', async () => {
    handler = (_req, res) => {
      res.statusCode = 404;
      res.end('nope');
    };
    const dest = path.join(dir, 'missing.jar');

    await expect(downloadToFile(`${base}/x`, dest)).rejects.toThrow(/404/);
    await expect(fs.stat(dest)).rejects.toThrow();
  });

  it('does not leave a partial file behind when the connection dies mid-body', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-length': '1000' });
      res.write('half');
      // Destroying the socket rather than ending the response: the client sees a
      // truncated body, which is exactly the case that used to be saved to disk
      // and then accepted as installed forever after.
      res.socket?.destroy();
    };
    const dest = path.join(dir, 'truncated.jar');

    await expect(downloadToFile(`${base}/x`, dest)).rejects.toThrow();
    await expect(fs.stat(dest)).rejects.toThrow();
  });

  it('leaves the file that was there when the server refuses', async () => {
    // A pack's new `options.txt` answered 503, and the player's own was deleted
    // to make room for it.
    handler = (_req, res) => {
      res.statusCode = 503;
      res.end('try later');
    };
    const dest = path.join(dir, 'options.txt');
    await fs.writeFile(dest, 'fov:110.0');

    await expect(downloadToFile(`${base}/x`, dest)).rejects.toThrow(/503/);
    expect(await fs.readFile(dest, 'utf-8')).toBe('fov:110.0');
  });

  it('leaves the file that was there when the connection dies mid-body', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-length': '1000' });
      res.write('half');
      res.socket?.destroy();
    };
    const dest = path.join(dir, 'mod.jar');
    await fs.writeFile(dest, 'the build already installed');

    await expect(downloadToFile(`${base}/x`, dest)).rejects.toThrow();
    expect(await fs.readFile(dest, 'utf-8')).toBe('the build already installed');
    // And nothing half-written beside it.
    expect(await fs.readdir(dir)).toEqual(['mod.jar']);
  });

  it('refuses a body larger than the cap, by its declared length', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-length': '5000' });
      res.end('x'.repeat(5000));
    };
    const dest = path.join(dir, 'big.zip');

    await expect(downloadToFile(`${base}/x`, dest, { maxBytes: 100 })).rejects.toThrow(
      /declares 5000 bytes/,
    );
    await expect(fs.stat(dest)).rejects.toThrow();
  });

  it('refuses a body larger than the cap even when the server lies about its length', async () => {
    handler = (_req, res) => {
      // No content-length at all, so only the running count can catch it.
      res.writeHead(200, { 'transfer-encoding': 'chunked' });
      res.end('x'.repeat(5000));
    };
    const dest = path.join(dir, 'liar.zip');

    await expect(downloadToFile(`${base}/x`, dest, { maxBytes: 100 })).rejects.toThrow(/limit/);
    await expect(fs.stat(dest)).rejects.toThrow();
  });

  it('reports progress against the declared length', async () => {
    const body = 'x'.repeat(4096);
    handler = (_req, res) => {
      res.writeHead(200, { 'content-length': String(body.length) });
      res.end(body);
    };

    const seen: Array<[number, number | undefined]> = [];
    await downloadToFile(`${base}/x`, path.join(dir, 'p.bin'), {
      onProgress: (received, total) => seen.push([received, total]),
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toEqual([0, body.length]);
    expect(seen.at(-1)).toEqual([body.length, body.length]);
  });

  it('reports no total when the server declares none', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'transfer-encoding': 'chunked' });
      res.end('abc');
    };

    const totals: Array<number | undefined> = [];
    await downloadToFile(`${base}/x`, path.join(dir, 'q.bin'), {
      onProgress: (_received, total) => totals.push(total),
    });

    expect(totals.every((t) => t === undefined)).toBe(true);
  });

  it('stops on an aborted signal and leaves nothing behind', async () => {
    const controller = new AbortController();
    handler = (_req, res) => {
      res.writeHead(200, { 'content-length': '1000000' });
      res.write('x'.repeat(1024));
      setTimeout(() => controller.abort(), 5);
    };
    const dest = path.join(dir, 'cancelled.bin');

    await expect(
      downloadToFile(`${base}/x`, dest, { signal: controller.signal }),
    ).rejects.toThrow();
    await expect(fs.stat(dest)).rejects.toThrow();
  });

  it('refuses a symlink sitting where the file goes, when asked to', async () => {
    if (process.platform === 'win32') return;
    const outside = path.join(dir, 'outside.txt');
    await fs.writeFile(outside, 'original');
    const dest = path.join(dir, 'link.txt');
    await fs.symlink(outside, dest);

    handler = (_req, res) => res.end('overwritten');

    await expect(downloadToFile(`${base}/x`, dest, { noFollow: true })).rejects.toThrow();
    expect(await fs.readFile(outside, 'utf-8')).toBe('original');
    // Refused, not replaced: the link is still the link somebody made.
    expect((await fs.lstat(dest)).isSymbolicLink()).toBe(true);
  });

  describe('a body with a hash to match', () => {
    const verify = (body: string) => ({ hashes: { sha256: sha256(body) }, label: 'mod.jar' });

    it('takes its place when it matches', async () => {
      handler = (_req, res) => res.end('the right bytes');
      const dest = path.join(dir, 'mod.jar');

      await downloadToFile(`${base}/x`, dest, { verify: verify('the right bytes') });

      expect(await fs.readFile(dest, 'utf-8')).toBe('the right bytes');
    });

    it('never takes its place when it does not, and says which hash failed', async () => {
      handler = (_req, res) => res.end('something else entirely');
      const dest = path.join(dir, 'mod.jar');
      await fs.writeFile(dest, 'the build already installed');

      await expect(
        downloadToFile(`${base}/x`, dest, { verify: verify('the right bytes') }),
      ).rejects.toThrow(/^sha256 mismatch for mod\.jar/);

      // Checked after it was written, the wrong file had already replaced this
      // one, and deleting it then left the profile with neither.
      expect(await fs.readFile(dest, 'utf-8')).toBe('the build already installed');
      expect(await fs.readdir(dir)).toEqual(['mod.jar']);
    });

    it('accepts a body nothing was published for', async () => {
      handler = (_req, res) => res.end('unverifiable');
      const dest = path.join(dir, 'pack.zip');

      await downloadToFile(`${base}/x`, dest, { verify: { hashes: {}, label: 'pack.zip' } });

      expect(await fs.readFile(dest, 'utf-8')).toBe('unverifiable');
    });

    it('does not let two downloads of one file write into each other', async () => {
      // Both are hashed as they arrive, which only proves anything about the
      // file if nobody else is writing to it at the same time.
      const bodies: Record<string, string> = {
        '/a': 'a'.repeat(64 * 1024),
        '/b': 'b'.repeat(64 * 1024),
      };
      handler = (req, res) => {
        const body = bodies[req.url ?? ''];
        res.writeHead(200, { 'content-length': String(body.length) });
        // In two halves with a pause between, so both transfers are under way
        // before either has finished.
        res.write(body.slice(0, body.length / 2));
        setTimeout(() => res.end(body.slice(body.length / 2)), 20);
      };
      const dest = path.join(dir, 'shared.jar');

      await Promise.all([
        downloadToFile(`${base}/a`, dest, { verify: verify(bodies['/a']) }),
        downloadToFile(`${base}/b`, dest, { verify: verify(bodies['/b']) }),
      ]);

      expect([bodies['/a'], bodies['/b']]).toContain(await fs.readFile(dest, 'utf-8'));
    });
  });

  /**
   * A rename orders names and says nothing of what is behind them: a power cut
   * in the seconds after it can leave the name on an empty file. A state file
   * is sent to the disk before it gets its name for that reason, and a
   * download is too — unless whoever asked for it looks at its size or its hash
   * again every time it is about to be used, as a launch does with the game's
   * own files, thousands at a time.
   */
  describe('getting the bytes to the disk', () => {
    /** Watch every flush and every rename, and say in what order they came. */
    async function watching(flush?: () => Promise<void>) {
      const probe = await fs.open(path.join(dir, 'probe'), 'w');
      const handles = Object.getPrototypeOf(probe) as { sync: () => Promise<void> };
      await probe.close();
      await fs.rm(path.join(dir, 'probe'));
      const order: string[] = [];
      const flushed = handles.sync;
      const sync = vi.spyOn(handles, 'sync').mockImplementation(function (this: unknown) {
        order.push('bytes sent to the disk');
        return flush ? flush() : flushed.call(this);
      });
      const renamed = fs.rename;
      const rename = vi.spyOn(fs, 'rename').mockImplementation((from, to) => {
        order.push('file given its name');
        return renamed(from, to);
      });
      return {
        order,
        restore: () => {
          sync.mockRestore();
          rename.mockRestore();
        },
      };
    }

    const refusing = (code: string) => () =>
      Promise.reject(Object.assign(new Error(`${code}: could not flush, fsync`), { code }));

    it('is done before the file is given its name', async () => {
      handler = (_req, res) => res.end('a mod');
      const dest = path.join(dir, 'mod.jar');
      const seen = await watching();

      try {
        await downloadToFile(`${base}/x`, dest);
      } finally {
        seen.restore();
      }

      expect(seen.order).toEqual(['bytes sent to the disk', 'file given its name']);
      expect(await fs.readFile(dest, 'utf-8')).toBe('a mod');
    });

    it('is left out for a file the caller checks again before every use', async () => {
      handler = (_req, res) => res.end('an asset');
      const dest = path.join(dir, 'asset');
      const seen = await watching();

      try {
        await downloadToFile(`${base}/x`, dest, { checkedAgain: true });
      } finally {
        seen.restore();
      }

      expect(seen.order).toEqual(['file given its name']);
      expect(await fs.readFile(dest, 'utf-8')).toBe('an asset');
    });

    it('does not stop a file arriving where the filesystem cannot be told to flush', async () => {
      handler = (_req, res) => res.end('a mod');
      const dest = path.join(dir, 'mod.jar');
      const seen = await watching(refusing('EINVAL'));

      try {
        await downloadToFile(`${base}/x`, dest);
      } finally {
        seen.restore();
      }

      expect(await fs.readFile(dest, 'utf-8')).toBe('a mod');
    });

    it('leaves the file that was there when the disk will not take the new one', async () => {
      handler = (_req, res) => res.end('the new build');
      const dest = path.join(dir, 'mod.jar');
      await fs.writeFile(dest, 'the old build');
      const seen = await watching(refusing('EIO'));

      try {
        await expect(downloadToFile(`${base}/x`, dest)).rejects.toThrow(/EIO/);
      } finally {
        seen.restore();
      }

      expect(await fs.readFile(dest, 'utf-8')).toBe('the old build');
      expect(await fs.readdir(dir)).toEqual(['mod.jar']);
    });
  });

  describe('secure transport', () => {
    // The bytes this guards are loaded as code — a mod jar, a config a manifest
    // ships — so a plaintext hop is a place to swap the file no hash may catch.
    it('refuses plaintext http to a remote host before it sends a request', async () => {
      let hit = false;
      handler = (_req, res) => {
        hit = true;
        res.end('should-not-run');
      };
      // A non-loopback http URL is refused outright — nothing is fetched.
      await expect(
        downloadToFile('http://cdn.example.net/mod.jar', path.join(dir, 'a.jar'), { secure: true }),
      ).rejects.toThrow(/https/i);
      expect(hit).toBe(false);
    });

    it('refuses a non-web scheme', async () => {
      await expect(
        downloadToFile('file:///etc/passwd', path.join(dir, 'b'), { secure: true }),
      ).rejects.toThrow(/https/i);
    });

    it('still allows loopback http, for a pack author serving one locally', async () => {
      handler = (_req, res) => res.end('local-bytes');
      const dest = path.join(dir, 'ok.jar');
      await downloadToFile(`${base}/x`, dest, { secure: true });
      expect(await fs.readFile(dest, 'utf-8')).toBe('local-bytes');
    });
  });
});
