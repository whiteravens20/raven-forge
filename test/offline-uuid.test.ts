import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { offlineUuid } from '../src/core/auth/offline-uuid';

/**
 * These are compatibility vectors, not regression snapshots.
 *
 * An `online-mode=false` server keys a player's inventory, claims, permissions
 * and rank on this UUID, so it has to agree byte for byte with what Java's
 * `UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes())` produces —
 * that is what the server and every other launcher compute. The values below
 * were generated independently (Python's `hashlib` + `uuid.UUID(bytes=…,
 * version=3)`, which stamps the same bits), so a transcription slip in our
 * byte indices fails here instead of stranding somebody's base.
 */
const VECTORS: Array<[string, string]> = [
  ['Notch', 'b50ad385-829d-3141-a216-7e7d7539ba7f'],
  ['jeb_', 'a762f560-4fce-3236-812a-b80efff0b62b'],
  ['pavlojs', '589cea90-168f-3c77-83db-e9499b90db69'],
  ['Steve', '5627dd98-e6be-3c21-b8a8-e92344183641'],
  ['steve', '53909932-f794-33c0-9329-948045a4c1ce'],
  // Not a legal Minecraft name, but the derivation must not care.
  ['Ex@mple', 'f116ae30-66c9-3331-b950-96c5c4d795fc'],
  ['ąćęł', 'c862b333-36c5-381a-afa2-eb0302611f73'],
  ['', 'fc5bc365-aedf-30a8-8b89-04e462e29bde'],
];

describe('offlineUuid', () => {
  it.each(VECTORS)('matches the JVM for %j', (name, expected) => {
    expect(offlineUuid(name)).toBe(expected);
  });

  it('is case-sensitive — Steve and steve are different players', () => {
    expect(offlineUuid('Steve')).not.toBe(offlineUuid('steve'));
  });

  it('is deterministic across calls', () => {
    expect(offlineUuid('pavlojs')).toBe(offlineUuid('pavlojs'));
  });

  it('stamps version 3 and the IETF variant', () => {
    for (const [name] of VECTORS) {
      const uuid = offlineUuid(name);
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('is not the namespaced RFC 4122 v3 of the same string', () => {
    // The JDK hashes the raw bytes with no namespace prefix. Reaching for a
    // generic v3 helper is the obvious "cleanup" someone will try, and it
    // silently produces a different, server-incompatible UUID.
    const dnsNamespace = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');
    const md5 = crypto
      .createHash('md5')
      .update(Buffer.concat([dnsNamespace, Buffer.from('OfflinePlayer:Notch', 'utf8')]))
      .digest();
    md5[6] = (md5[6] & 0x0f) | 0x30;
    md5[8] = (md5[8] & 0x3f) | 0x80;
    const hex = md5.toString('hex');
    const namespaced = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

    expect(offlineUuid('Notch')).not.toBe(namespaced);
  });
});
