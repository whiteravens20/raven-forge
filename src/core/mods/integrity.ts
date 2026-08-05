import fs from 'node:fs/promises';
import crypto from 'node:crypto';

/** Integrity fields as they appear on any downloadable manifest entry. */
export interface HashedEntry {
  sha256?: string;
  sha512?: string;
  /**
   * The floor, for a manifest that publishes nothing stronger. Weak against a
   * deliberate collision, but it still pins the file against a swapped CDN
   * object, and no check at all is strictly worse.
   */
  sha1?: string;
}

export type HashAlgorithm = 'sha1' | 'sha256' | 'sha512';

export async function hashFile(filePath: string, algorithm: HashAlgorithm): Promise<string> {
  const data = await fs.readFile(filePath);
  return crypto.createHash(algorithm).update(data).digest('hex');
}

export async function sha256File(filePath: string): Promise<string> {
  return hashFile(filePath, 'sha256');
}

/**
 * The hash a downloaded file should be checked against.
 *
 * Strongest available wins. sha512 comes first because Modrinth's API returns
 * sha1/sha512 and not sha256, so it is the one a pack generator can publish
 * without downloading every jar purely to hash it; sha1 is the floor. Returns
 * null when an entry carries no integrity data, in which case the download is
 * accepted as-is.
 */
export function expectedHash(
  entry: HashedEntry,
): { algorithm: HashAlgorithm; value: string } | null {
  if (entry.sha512) return { algorithm: 'sha512', value: entry.sha512.toLowerCase() };
  if (entry.sha256) return { algorithm: 'sha256', value: entry.sha256.toLowerCase() };
  if (entry.sha1) return { algorithm: 'sha1', value: entry.sha1.toLowerCase() };
  return null;
}

/** True when the file on disk already matches what the manifest expects. */
export async function fileMatches(filePath: string, entry: HashedEntry): Promise<boolean> {
  const expected = expectedHash(entry);
  if (!expected) return false;
  try {
    return (await hashFile(filePath, expected.algorithm)) === expected.value;
  } catch {
    return false;
  }
}

/** Verify a freshly downloaded file, deleting it and throwing on mismatch. */
export async function verifyDownload(
  filePath: string,
  entry: HashedEntry,
  label: string,
): Promise<void> {
  const expected = expectedHash(entry);
  if (!expected) return;

  const actual = await hashFile(filePath, expected.algorithm);
  if (actual !== expected.value) {
    await fs.rm(filePath, { force: true });
    throw new Error(
      `${expected.algorithm} mismatch for ${label}: expected ${expected.value}, got ${actual}`,
    );
  }
}
