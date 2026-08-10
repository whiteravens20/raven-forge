import nacl from 'tweetnacl';
import { decodeBase64, decodeUTF8 } from 'tweetnacl-util';
import { log } from '../../main/logger';
import { trustedKeyRing } from '../../shared/branding';
import type { ManifestVerification, TrustedKey } from '../../shared/ipc-types';
import { canonicalize, type SignedManifest } from './canonical';

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

  const keys = trustedKeyRing(trustedKeys);
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
 * - **First-party manifest** — one served from the White Ravens packs site
 *   (`firstParty`). Always held to the built-in key, whatever the player has
 *   configured. The publisher signs every one of these, the key that vouches
 *   for them ships in the launcher, and the badge already verifies against it;
 *   letting an unsigned or tampered first-party manifest install because the
 *   player never pasted a key of their own would mean the built-in key vouches
 *   for the badge but guards nothing. A network attacker on the manifest's
 *   transport is exactly who this stops.
 * - **No trusted keys configured, manifest not first-party** — nothing is
 *   enforced. This is the default install and the one most people are on; a
 *   launcher that refused every unsigned third-party pack out of the box would
 *   refuse every pack that exists.
 * - **At least one trusted key configured** — the manifest must carry a
 *   signature that verifies against one of them. Unsigned counts as a failure,
 *   not as an exemption: if stripping the signature were enough to skip the
 *   check, an attacker in a position to modify the manifest would simply strip
 *   it, and the whole scheme would protect nothing.
 *
 * Adding a key switches enforcement on for everything; a first-party address
 * has it on already. Either way the feature does what its name says.
 */
export function assertManifestTrusted(
  verification: ManifestVerification,
  trustedKeys: TrustedKey[],
  profileName: string,
  firstParty = false,
): void {
  if (verification.valid) return;
  if (!firstParty && trustedKeys.length === 0) return;

  const detail = verification.signed
    ? (verification.error ?? 'the signature does not verify')
    : 'it carries no signature at all';
  const policy = firstParty
    ? 'This is a White Ravens pack, so it must be signed by the built-in key — a copy failing that check has been tampered with in transit or is not genuine.'
    : 'Trusted keys are configured, so only a signed and verified manifest is installed. ' +
      'Remove the trusted keys in Settings to sync unsigned manifests again.';
  throw new Error(`Refusing to install the manifest for ${profileName}: ${detail}. ${policy}`);
}
