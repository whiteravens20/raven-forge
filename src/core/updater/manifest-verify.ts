import nacl from 'tweetnacl';
import { decodeBase64, decodeUTF8 } from 'tweetnacl-util';
import { log } from '../../main/logger';
import { WHITE_RAVENS_PUBLIC_KEY } from '../../shared/branding';
import type { ManifestVerification, TrustedKey } from '../../shared/ipc-types';
import { canonicalize, type SignedManifest } from './canonical';

/**
 * The publisher's own key, always present.
 *
 * Without it the launcher's first-party packs read "no trusted keys" on a fresh
 * install, which is the state nearly every player is in — a signature scheme
 * that verifies nothing until the player pastes a key by hand is a scheme that
 * verifies nothing.
 */
export const BUILT_IN_KEYS: TrustedKey[] = [
  {
    name: 'White Ravens',
    publicKey: WHITE_RAVENS_PUBLIC_KEY,
    addedAt: '1970-01-01T00:00:00.000Z',
  },
];

/** The user's keys plus the publisher's, without duplicating a key they added. */
function keyRing(trustedKeys: TrustedKey[]): TrustedKey[] {
  const builtIn = BUILT_IN_KEYS.filter(
    (k) => !trustedKeys.some((t) => t.publicKey === k.publicKey),
  );
  return [...trustedKeys, ...builtIn];
}

/**
 * Check a manifest's Ed25519 signature against the trusted keys.
 *
 * Pure, synchronous, and takes the manifest *object* rather than a URL. The
 * version that fetched its own copy could only ever report on bytes nobody
 * installed: the sync fetched separately, so a host could serve a signed
 * manifest to the check and a hostile one to the install and the badge would
 * still read "Verified". Whatever is verified has to be the same object the
 * caller is about to act on, which is why this cannot do its own I/O.
 *
 * The object must be the raw parsed JSON, not the schema's output. Zod strips
 * keys it does not know about, and a manifest that carries any would then
 * canonicalize to different bytes than the ones that were signed.
 */
export function verifyManifestSignature(
  manifest: SignedManifest,
  trustedKeys: TrustedKey[],
): ManifestVerification {
  if (!manifest.signature) return { signed: false, valid: false };

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = decodeBase64(manifest.signature);
  } catch {
    return { signed: true, valid: false, error: 'Signature is not valid base64' };
  }

  const keys = keyRing(trustedKeys);
  const message = decodeUTF8(canonicalize(manifest));
  for (const key of keys) {
    try {
      if (nacl.sign.detached.verify(message, signatureBytes, decodeBase64(key.publicKey))) {
        log.info(`Manifest signature verified against trusted key: ${key.name}`);
        return { signed: true, valid: true, signerName: key.name };
      }
    } catch (err) {
      log.warn(`Could not verify against trusted key ${key.name}: ${err}`);
    }
  }

  return {
    signed: true,
    valid: false,
    error: 'Signature does not match any trusted public key',
  };
}

/**
 * Whether a manifest may be installed, given what the user has chosen to trust.
 *
 * The policy, in full:
 *
 * - **No trusted keys configured** — nothing is enforced. This is the default
 *   install and the one most people are on; a launcher that refused every
 *   unsigned manifest out of the box would refuse every pack that exists.
 * - **At least one trusted key configured** — the manifest must carry a
 *   signature that verifies against one of them. Unsigned counts as a failure,
 *   not as an exemption: if stripping the signature were enough to skip the
 *   check, an attacker in a position to modify the manifest would simply strip
 *   it, and the whole scheme would protect nothing.
 *
 * Adding a key is therefore the act of switching enforcement on, which is the
 * only reading under which the feature does what its name says.
 */
export function assertManifestTrusted(
  verification: ManifestVerification,
  trustedKeys: TrustedKey[],
  profileName: string,
): void {
  if (trustedKeys.length === 0 || verification.valid) return;

  const detail = verification.signed
    ? (verification.error ?? 'the signature does not verify')
    : 'it carries no signature at all';
  throw new Error(
    `Refusing to install the manifest for ${profileName}: ${detail}. ` +
      'Trusted keys are configured, so only a signed and verified manifest is installed. ' +
      'Remove the trusted keys in Settings to sync unsigned manifests again.',
  );
}
