import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  expectedHash,
  fileMatches,
  hashFile,
  verifyDownload,
} from '../src/core/mods/integrity';

// `expectedHash` only picks between fields, so these are well-formed but
// arbitrary. Anything that has to match a real file uses `real.*` below.
const CONTENT = 'raven';
const SHA1 = 'a'.repeat(40);
const SHA256 = 'b'.repeat(64);
const SHA512 = 'c'.repeat(128);

let dir: string;
let file: string;
let real: { sha1: string; sha256: string; sha512: string };

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-integrity-'));
  file = path.join(dir, 'mod.jar');
  await fs.writeFile(file, CONTENT);
  real = {
    sha1: await hashFile(file, 'sha1'),
    sha256: await hashFile(file, 'sha256'),
    sha512: await hashFile(file, 'sha512'),
  };
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('expectedHash', () => {
  it('prefers the strongest algorithm available', () => {
    expect(expectedHash({ sha1: SHA1, sha256: SHA256, sha512: SHA512 })).toEqual({
      algorithm: 'sha512',
      value: SHA512,
    });
    expect(expectedHash({ sha1: SHA1, sha256: SHA256 })).toEqual({
      algorithm: 'sha256',
      value: SHA256,
    });
    // The floor, for a manifest that publishes nothing stronger.
    expect(expectedHash({ sha1: SHA1 })).toEqual({ algorithm: 'sha1', value: SHA1 });
  });

  it('lowercases the expected value', () => {
    expect(expectedHash({ sha256: SHA256.toUpperCase() })?.value).toBe(SHA256);
  });

  it('returns null when an entry carries no integrity data at all', () => {
    // Documented behaviour: such a download is accepted as-is. If this ever
    // starts throwing instead, that is a deliberate policy change, not a bug fix.
    expect(expectedHash({})).toBeNull();
  });
});

describe('fileMatches', () => {
  it('is true when the file on disk matches', async () => {
    await expect(fileMatches(file, { sha512: real.sha512 })).resolves.toBe(true);
    await expect(fileMatches(file, { sha256: real.sha256 })).resolves.toBe(true);
    await expect(fileMatches(file, { sha1: real.sha1 })).resolves.toBe(true);
  });

  it('ignores case in the manifest value', async () => {
    await expect(fileMatches(file, { sha256: real.sha256.toUpperCase() })).resolves.toBe(true);
  });

  it('checks the strongest hash, not the first one that happens to match', async () => {
    // A manifest with a correct sha1 and a wrong sha512 must not pass.
    await expect(fileMatches(file, { sha1: real.sha1, sha512: SHA512 })).resolves.toBe(false);
  });

  it('is false for a missing file rather than throwing', async () => {
    await expect(fileMatches(path.join(dir, 'nope.jar'), { sha256: real.sha256 })).resolves.toBe(
      false,
    );
  });

  it('is false when the entry has no hashes', async () => {
    // Unlike verifyDownload, "no hash" here means "cannot confirm", so the
    // caller re-downloads instead of trusting whatever is on disk.
    await expect(fileMatches(file, {})).resolves.toBe(false);
  });
});

describe('verifyDownload', () => {
  it('accepts a matching file and leaves it in place', async () => {
    await expect(verifyDownload(file, { sha512: real.sha512 }, 'mod.jar')).resolves.toBeUndefined();
    await expect(fs.readFile(file, 'utf8')).resolves.toBe(CONTENT);
  });

  it('deletes the file and throws on a mismatch', async () => {
    const bad = path.join(dir, 'tampered.jar');
    await fs.writeFile(bad, 'not raven');

    await expect(verifyDownload(bad, { sha512: real.sha512 }, 'tampered.jar')).rejects.toThrow(
      /sha512 mismatch for tampered\.jar/,
    );
    // The point of the whole exercise: a bad file must not survive on disk
    // where a later run could pick it up as cached.
    await expect(fs.access(bad)).rejects.toThrow();
  });

  it('names the algorithm it actually used in the error', async () => {
    const bad = path.join(dir, 'tampered-sha1.jar');
    await fs.writeFile(bad, 'not raven');
    await expect(verifyDownload(bad, { sha1: real.sha1 }, 'tampered-sha1.jar')).rejects.toThrow(
      /^sha1 mismatch/,
    );
  });

  it('accepts a file with no hash to check against', async () => {
    await expect(verifyDownload(file, {}, 'mod.jar')).resolves.toBeUndefined();
  });
});
