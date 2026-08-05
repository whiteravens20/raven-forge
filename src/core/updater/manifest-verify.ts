import nacl from 'tweetnacl';
import { decodeBase64, decodeUTF8 } from 'tweetnacl-util';
import { log } from '../../main/logger';
import { getProfile } from '../profiles/profile-manager';
import { getSettings } from '../config/settings-manager';
import type { ManifestVerification } from '../../shared/ipc-types';
import { canonicalize, type SignedManifest } from './canonical';

export async function verifyProfileManifest(profileId: string): Promise<ManifestVerification> {
  const profile = await getProfile(profileId);
  if (!profile) return { signed: false, valid: false, error: 'Profile not found' };
  if (!profile.manifestUrl) {
    return { signed: false, valid: false, error: 'Profile has no manifest URL' };
  }

  let manifest: SignedManifest;
  try {
    const res = await fetch(profile.manifestUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = (await res.json()) as SignedManifest;
  } catch (err) {
    return { signed: false, valid: false, error: `Failed to fetch manifest: ${err}` };
  }

  if (!manifest.signature) {
    return { signed: false, valid: false };
  }

  const settings = await getSettings();
  if (settings.trustedPublicKeys.length === 0) {
    return {
      signed: true,
      valid: false,
      error: "No trusted keys configured — add the server admin's public key in Settings",
    };
  }

  const message = decodeUTF8(canonicalize(manifest));
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = decodeBase64(manifest.signature);
  } catch {
    return { signed: true, valid: false, error: 'Signature is not valid base64' };
  }

  for (const key of settings.trustedPublicKeys) {
    try {
      const publicKeyBytes = decodeBase64(key.publicKey);
      if (nacl.sign.detached.verify(message, signatureBytes, publicKeyBytes)) {
        log.info(`Manifest signature verified against trusted key: ${key.name}`);
        return { signed: true, valid: true, signerName: key.name };
      }
    } catch (err) {
      log.warn(`Failed to verify against key ${key.name}: ${err}`);
    }
  }

  return {
    signed: true,
    valid: false,
    error: 'Signature does not match any trusted public key',
  };
}
