import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { isSafeFileName, fileNameFromUrl, modEntrySchema } from '../src/shared/manifest-schema';

/**
 * A manifest says *what* to fetch. Where it lands is the launcher's decision.
 *
 * The bug these pin: `fileName` was an unconstrained string that reached
 * `path.join(modsDir, …)`, so `"../../../../../../.bashrc"` in a manifest wrote
 * attacker-controlled bytes to the user's shell profile. The `.mrpack` reader
 * already got this right; the manifest path did not.
 */

describe('isSafeFileName', () => {
  it('accepts ordinary jar and zip names', () => {
    expect(isSafeFileName('sodium-0.6.5.jar')).toBe(true);
    expect(isSafeFileName('Complementary Reimagined r5.5.zip')).toBe(true);
    expect(isSafeFileName('.hidden')).toBe(true);
  });

  it('rejects anything that escapes the directory it is joined to', () => {
    expect(isSafeFileName('../evil.jar')).toBe(false);
    expect(isSafeFileName('../../../../../../.bashrc')).toBe(false);
    expect(isSafeFileName('/etc/passwd')).toBe(false);
    expect(isSafeFileName('..')).toBe(false);
    expect(isSafeFileName('.')).toBe(false);
    expect(isSafeFileName('')).toBe(false);
  });

  it('rejects backslashes on every platform, not only on Windows', () => {
    // `path.join` treats `\` as a separator on Windows, and a manifest is not
    // authored per-platform — so a POSIX-only check would ship the hole to
    // exactly the users who have no shell profile to notice it with.
    expect(isSafeFileName('..\\..\\evil.jar')).toBe(false);
    expect(isSafeFileName('sub\\mod.jar')).toBe(false);
  });

  it('rejects an embedded NUL', () => {
    expect(isSafeFileName('mod.jar\0.txt')).toBe(false);
  });

  it('keeps every accepted name inside the directory it is joined to', () => {
    const dir = '/home/u/.raven-forge/profiles/p/mods';
    for (const name of ['a.jar', '.x', '...jar', 'a b.jar', 'a..b.jar']) {
      expect(isSafeFileName(name)).toBe(true);
      expect(path.join(dir, name).startsWith(`${dir}/`)).toBe(true);
    }
  });
});

describe('modEntrySchema', () => {
  const base = { id: 'sodium', name: 'Sodium', version: '1', source: 'url' as const };

  it('accepts an entry pinning a plain filename', () => {
    expect(modEntrySchema.safeParse({ ...base, fileName: 'sodium.jar' }).success).toBe(true);
  });

  it('refuses the whole entry rather than repairing the name', () => {
    const parsed = modEntrySchema.safeParse({ ...base, fileName: '../../evil.jar' });
    expect(parsed.success).toBe(false);
  });
});

describe('fileNameFromUrl', () => {
  it('takes the last path segment', () => {
    expect(fileNameFromUrl('https://cdn/data/x/sodium-0.6.5.jar', 'sodium', '.jar')).toBe(
      'sodium-0.6.5.jar',
    );
  });

  it('falls back when the URL ends in a slash', () => {
    // `path.basename` returned '' here, and `path.join(dir, '')` is the
    // directory itself — so the download silently targeted `mods/`.
    expect(fileNameFromUrl('https://cdn/data/x/', 'sodium', '.jar')).toBe('sodium.jar');
  });

  it('does not let a percent-encoded separator through', () => {
    expect(fileNameFromUrl('https://cdn/%2e%2e%2fevil.jar', 'sodium', '.jar')).toBe('sodium.jar');
  });

  it('reduces an id that would itself be a path', () => {
    const name = fileNameFromUrl('https://cdn/x/', '../../evil', '.jar');
    expect(isSafeFileName(name)).toBe(true);
    expect(name).not.toContain('/');
  });
});
