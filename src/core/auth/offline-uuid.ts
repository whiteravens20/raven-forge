import crypto from 'node:crypto';

/**
 * The offline-mode UUID every other launcher and every server computes for a
 * name — Java's `UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes())`.
 *
 * It has to be this exact derivation, not a random one. An `online-mode=false`
 * server identifies players *by UUID*, so a random UUID files the player's
 * inventory, claims, permissions and rank under an identity no other launcher
 * produces — and deleting and re-adding the account here would strand all of it.
 *
 * Java hashes the raw bytes with MD5 and then stamps version 3 and the IETF
 * variant in place. That is not quite RFC 4122 v3 (no namespace UUID is
 * prepended), so this mirrors the JDK rather than using a generic v3 helper.
 *
 * It lives apart from the rest of auth because it is the one piece of it that
 * is pure, is a compatibility contract with software we do not control, and can
 * therefore be pinned by tests without dragging in Electron or the keychain.
 */
export function offlineUuid(username: string): string {
  const md5 = crypto.createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const hex = md5.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
