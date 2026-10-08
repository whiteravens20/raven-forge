// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushToDisk, writeFileAtomic, writeJsonAtomic } from '../src/core/util/atomic-file';
import { heldByAnotherProgram } from './helpers/hold-file';

const { warnings } = vi.hoisted(() => ({ warnings: [] as string[] }));

vi.mock('../src/main/logger', () => ({
  log: {
    warn: (message: string) => warnings.push(message),
    info: () => {},
    error: () => {},
    debug: () => {},
  },
}));

/**
 * The atomic write, over a real directory.
 *
 * The case that matters is two writes to one file from *this* process, which is
 * what the launcher actually does: the temporary file used to be named after the
 * process id alone, so both writers opened the same one, wrote into it from
 * offset zero, and renamed the mixture into place. Every reader of these files
 * treats a parse failure as "empty", so the result was not a lost write but a
 * silently emptied file.
 */

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-atomic-'));
  warnings.length = 0;
});

/** Have every flush in the next writes answer with this error instead of flushing. */
async function flushAnswers(error: Error): Promise<{ restore: () => void }> {
  const probe = await fs.open(path.join(dir, 'probe'), 'w');
  const handles = Object.getPrototypeOf(probe) as { sync: () => Promise<void> };
  await probe.close();
  await fs.rm(path.join(dir, 'probe'));
  const sync = vi.spyOn(handles, 'sync').mockRejectedValue(error);
  return { restore: () => sync.mockRestore() };
}

const errno = (code: string) =>
  Object.assign(new Error(`${code}: could not flush, fsync`), { code });

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('writeFileAtomic', () => {
  it('leaves the file readable as one of the two documents, never a mixture', async () => {
    const file = path.join(dir, 'installed.lock');
    // Different lengths on purpose: interleaving a short document into a long
    // one leaves trailing bytes of the long one, which is the shape that used to
    // survive as unparseable JSON.
    const long = Array.from({ length: 400 }, (_, i) => ({ id: `mod-${i}`, enabled: true }));
    const short = [{ id: 'only', enabled: false }];

    await Promise.all([writeJsonAtomic(file, long), writeJsonAtomic(file, short)]);

    const parsed = JSON.parse(await fs.readFile(file, 'utf-8')) as unknown[];
    expect([long.length, short.length]).toContain(parsed.length);
  });

  it('survives many concurrent writes to the same file', async () => {
    const file = path.join(dir, 'settings.json');
    await Promise.all(Array.from({ length: 30 }, (_, i) => writeJsonAtomic(file, { round: i })));

    const parsed = JSON.parse(await fs.readFile(file, 'utf-8')) as { round: number };
    expect(parsed.round).toBeGreaterThanOrEqual(0);
    expect(parsed.round).toBeLessThan(30);
  });

  it('leaves no temporary files behind', async () => {
    const file = path.join(dir, 'profiles.json');
    await Promise.all(Array.from({ length: 10 }, (_, i) => writeJsonAtomic(file, { i })));

    const left = (await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'));
    expect(left).toEqual([]);
  });

  it('creates the parent directory', async () => {
    const file = path.join(dir, 'nested', 'deeper', 'state.json');
    await writeJsonAtomic(file, { ok: true });
    expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toEqual({ ok: true });
  });

  it('applies the requested mode, including over a file that already exists', async () => {
    if (process.platform === 'win32') return;
    const file = path.join(dir, 'auth.json');
    await fs.writeFile(file, 'stale', { mode: 0o644 });

    await writeFileAtomic(file, 'fresh', 0o600);

    expect(await fs.readFile(file, 'utf-8')).toBe('fresh');
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });

  it('has the bytes on the disk before the file is given its name', async () => {
    // A rename is atomic about names and says nothing of contents: with the
    // name recorded first, a power cut leaves it on an empty file, which every
    // reader of a state file would then move aside and start without.
    const probe = await fs.open(path.join(dir, 'probe'), 'w');
    const handles = Object.getPrototypeOf(probe) as { sync: () => Promise<void> };
    await probe.close();
    const order: string[] = [];
    const flushed = handles.sync;
    const sync = vi.spyOn(handles, 'sync').mockImplementation(function (this: unknown) {
      order.push('bytes sent to the disk');
      return flushed.call(this);
    });
    const renamed = fs.rename;
    const rename = vi.spyOn(fs, 'rename').mockImplementation((from, to) => {
      order.push('file given its name');
      return renamed(from, to);
    });

    try {
      await writeFileAtomic(path.join(dir, 'state.json'), '{"a":1}');
    } finally {
      sync.mockRestore();
      rename.mockRestore();
    }

    expect(order).toEqual(['bytes sent to the disk', 'file given its name']);
    expect(await fs.readFile(path.join(dir, 'state.json'), 'utf-8')).toBe('{"a":1}');
  });

  it.each(['EIO', 'ENOSPC', 'EDQUOT', 'EROFS'])(
    'leaves the file that was there when the disk will not take the bytes (%s)',
    async (code) => {
      const file = path.join(dir, 'state.json');
      await fs.writeFile(file, 'old');
      const flush = await flushAnswers(errno(code));

      try {
        await expect(writeFileAtomic(file, 'new')).rejects.toThrow(code);
      } finally {
        flush.restore();
      }

      expect(await fs.readFile(file, 'utf-8')).toBe('old');
      expect(await fs.readdir(dir)).toEqual(['state.json']);
    },
  );

  it.each(['EINVAL', 'ENOTSUP', 'ENOSYS', 'EISDIR'])(
    'writes the file all the same where the filesystem cannot be told to flush (%s)',
    async (code) => {
      // Held to a flush there, the launcher could save nothing at all: no
      // setting, no profile, no sign-in.
      const file = path.join(dir, 'state.json');
      await fs.writeFile(file, 'old');
      const flush = await flushAnswers(errno(code));

      try {
        await writeFileAtomic(file, 'new');
      } finally {
        flush.restore();
      }

      expect(await fs.readFile(file, 'utf-8')).toBe('new');
      expect(await fs.readdir(dir)).toEqual(['state.json']);
    },
  );

  it('says so in the log, and says it once', async () => {
    vi.resetModules();
    const fresh = await import('../src/core/util/atomic-file');
    const flush = await flushAnswers(errno('ENOTSUP'));

    try {
      await fresh.writeFileAtomic(path.join(dir, 'one.json'), '1');
      await fresh.writeFileAtomic(path.join(dir, 'two.json'), '2');
    } finally {
      flush.restore();
    }

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(dir);
    expect(warnings[0]).toContain('ENOTSUP');
  });

  it('lets through what this system really answers for a place that cannot be flushed', async () => {
    // Not a stand-in: the null device, asked by the system this runs on. Linux
    // answers EINVAL. Whatever the answer is here, it has to be one of those
    // the write goes on after — or there is nothing to go on after at all.
    const nowhere = await fs.open(os.devNull, 'w');
    try {
      const answer = await nowhere.sync().then(
        () => 'flushed',
        (err: NodeJS.ErrnoException) => err.code ?? String(err),
      );
      console.log(`a flush of ${os.devNull} on ${process.platform}: ${answer}`);

      await expect(flushToDisk(nowhere, os.devNull)).resolves.toBeUndefined();
    } finally {
      await nowhere.close();
    }
  });

  it('removes the temporary file when the write cannot be renamed into place', async () => {
    // A directory where the file should go: the rename fails, and the point is
    // that a full disk does not leave a `.tmp` beside every state file.
    const file = path.join(dir, 'blocked');
    await fs.mkdir(file);

    await expect(writeFileAtomic(file, 'x')).rejects.toThrow();
    const left = (await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'));
    expect(left).toEqual([]);
  });

  /**
   * Windows will not let a file be replaced while anything has it open, and
   * says so with an error where every other system says nothing. What has it
   * open is as a rule gone in a moment — an antivirus reading the file, another
   * write replacing it — so the write waits for that moment. These two run on a
   * Windows and nowhere else: a file held by another program is not something
   * that can be staged anywhere it does not matter.
   */
  describe.skipIf(process.platform !== 'win32')(
    'on Windows, a file something else has open',
    () => {
      it('is waited for, and replaced once it is let go', async () => {
        const file = path.join(dir, 'state.json');
        await fs.writeFile(file, 'old');
        const letGo = await heldByAnotherProgram(file);

        let written = false;
        const write = writeFileAtomic(file, 'new').then(() => {
          written = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        // Still held, so still waiting: nothing was forced and nothing failed.
        expect(written).toBe(false);
        await letGo();
        await write;

        expect(await fs.readFile(file, 'utf-8')).toBe('new');
        expect(await fs.readdir(dir)).toEqual(['state.json']);
      }, 30_000);

      it('is not waited for when it is a folder, which lets go of nothing', async () => {
        const file = path.join(dir, 'blocked');
        await fs.mkdir(file);
        const began = Date.now();

        await expect(writeFileAtomic(file, 'x')).rejects.toThrow();

        // The waits for a held file come to a couple of seconds. This is not one.
        expect(Date.now() - began).toBeLessThan(1000);
      });

      it('is left as it was when it is never let go, and the write says so', async () => {
        const file = path.join(dir, 'state.json');
        await fs.writeFile(file, 'old');
        const letGo = await heldByAnotherProgram(file);

        try {
          await expect(writeFileAtomic(file, 'new')).rejects.toThrow(/EPERM|EBUSY|EACCES/);
        } finally {
          await letGo();
        }

        expect(await fs.readFile(file, 'utf-8')).toBe('old');
        expect(await fs.readdir(dir)).toEqual(['state.json']);
      }, 30_000);
    },
  );
});
