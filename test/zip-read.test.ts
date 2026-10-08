// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { STOP, eachEntry, openEntry, readZipEntry } from '../src/core/util/zip-read';
import { ZipWriter } from './helpers/zip';

/**
 * The one reader behind every archive the launcher opens: a pack, a loader's
 * installer, a jar of native libraries, a resource pack picked off the disk.
 */

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-zip-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function archive(entries: Record<string, string>): Promise<string> {
  const zip = new ZipWriter();
  for (const [name, body] of Object.entries(entries)) zip.add(name, body);
  const file = path.join(root, 'archive.zip');
  await fs.writeFile(file, zip.toBuffer());
  return file;
}

/** How many files this process holds open, where the system can say. */
async function openFiles(): Promise<number | null> {
  try {
    return (await fs.readdir('/proc/self/fd')).length;
  } catch {
    return null;
  }
}

describe('eachEntry', () => {
  it('goes through the files in order and passes folders over', async () => {
    const file = await archive({ 'a.txt': 'A', 'folder/': '', 'folder/b.txt': 'B', 'c.txt': 'C' });

    const seen: string[] = [];
    await eachEntry(file, async (_zip, entry) => void seen.push(entry.fileName));

    expect(seen).toEqual(['a.txt', 'folder/b.txt', 'c.txt']);
  });

  it('hands over the bytes of a file when asked', async () => {
    const file = await archive({ 'a.txt': 'first', 'b.txt': 'second' });

    const read: Record<string, string> = {};
    await eachEntry(file, async (zip, entry) => {
      const chunks: Buffer[] = [];
      for await (const chunk of await openEntry(zip, entry)) chunks.push(chunk as Buffer);
      read[entry.fileName] = Buffer.concat(chunks).toString('utf-8');
    });

    expect(read).toEqual({ 'a.txt': 'first', 'b.txt': 'second' });
  });

  it('reads no further once told to stop', async () => {
    const file = await archive({ 'a.txt': 'A', 'b.txt': 'B', 'c.txt': 'C' });

    const seen: string[] = [];
    await eachEntry(file, async (_zip, entry) => {
      seen.push(entry.fileName);
      return entry.fileName === 'b.txt' ? STOP : undefined;
    });

    expect(seen).toEqual(['a.txt', 'b.txt']);
  });

  it('closes the archive however the reading ends', async () => {
    const before = await openFiles();
    if (before === null) return; // nowhere to count them
    const file = await archive({ 'a.txt': 'A', 'b.txt': 'B' });

    await eachEntry(file, async () => STOP);
    await expect(
      eachEntry(file, async () => {
        throw new Error('this one will not do');
      }),
    ).rejects.toThrow('this one will not do');
    await eachEntry(file, async () => {});

    expect(await openFiles()).toBe(before);
  });

  it('says so when the file is not an archive at all', async () => {
    const file = path.join(root, 'notes.zip');
    await fs.writeFile(file, 'just some text that somebody renamed');
    await expect(eachEntry(file, async () => {})).rejects.toThrow();
  });
});

describe('readZipEntry', () => {
  it('returns the one file asked for', async () => {
    const file = await archive({ 'install_profile.json': '{}', 'version.json': '{"id":"x"}' });
    expect((await readZipEntry(file, 'version.json'))?.toString('utf-8')).toBe('{"id":"x"}');
  });

  it('answers null for a name that is not there', async () => {
    const file = await archive({ 'a.txt': 'A' });
    expect(await readZipEntry(file, 'version.json')).toBeNull();
  });
});
