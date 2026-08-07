import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { encodeBase64, decodeUTF8 } from 'tweetnacl-util';
import { canonicalize } from '../src/core/updater/canonical';
import {
  verifyManifestSignature,
  assertManifestTrusted,
  BUILT_IN_KEYS,
} from '../src/core/updater/manifest-verify';
import { WHITE_RAVENS_PUBLIC_KEY } from '../src/shared/branding';
import type { TrustedKey } from '../src/shared/ipc-types';

/**
 * The trust decision the sync path makes before it downloads anything.
 *
 * These are the properties that make the signature scheme worth having at all.
 * The one that matters most is the downgrade case: if an unsigned manifest were
 * merely "not verified" rather than refused, an attacker who can rewrite the
 * manifest would delete the signature and be waved through, and every other
 * check here would be decoration.
 */

const pair = nacl.sign.keyPair();

function trusted(name = 'White Ravens'): TrustedKey[] {
  return [{ name, publicKey: encodeBase64(pair.publicKey), addedAt: '2026-01-01T00:00:00.000Z' }];
}

function sign(manifest: Record<string, unknown>): Record<string, unknown> {
  const signature = nacl.sign.detached(decodeUTF8(canonicalize(manifest)), pair.secretKey);
  return { ...manifest, signature: encodeBase64(signature) };
}

const manifest = {
  manifestVersion: 2,
  serverName: 'Ravens',
  minecraftVersion: '1.21.4',
  modLoader: 'fabric',
  mods: [{ id: 'sodium', name: 'Sodium', url: 'https://cdn/sodium.jar', sha512: 'aa' }],
};

describe('verifyManifestSignature', () => {
  it('accepts a manifest signed by a trusted key', () => {
    const result = verifyManifestSignature(sign(manifest), trusted());
    expect(result).toMatchObject({ signed: true, valid: true, signerName: 'White Ravens' });
  });

  it('rejects a manifest whose content changed after signing', () => {
    const tampered = { ...sign(manifest), mods: [{ id: 'sodium', url: 'https://evil/x.jar' }] };
    expect(verifyManifestSignature(tampered, trusted())).toMatchObject({
      signed: true,
      valid: false,
    });
  });

  it('rejects a signature made by a key that is not trusted', () => {
    const other = nacl.sign.keyPair();
    const signature = nacl.sign.detached(decodeUTF8(canonicalize(manifest)), other.secretKey);
    const result = verifyManifestSignature(
      { ...manifest, signature: encodeBase64(signature) },
      trusted(),
    );
    expect(result).toMatchObject({ signed: true, valid: false });
  });

  it('reports an unsigned manifest as unsigned rather than as invalid', () => {
    expect(verifyManifestSignature(manifest, trusted())).toMatchObject({
      signed: false,
      valid: false,
    });
  });

  it('survives a signature that is not base64 instead of throwing', () => {
    expect(verifyManifestSignature({ ...manifest, signature: '!!!' }, trusted())).toMatchObject({
      signed: true,
      valid: false,
    });
  });

  it('reports an unknown signer as unmatched when the user trusts nobody', () => {
    expect(verifyManifestSignature(sign(manifest), [])).toMatchObject({
      signed: true,
      valid: false,
    });
  });

  it('always carries the publisher key, so first-party packs verify unconfigured', () => {
    // Deleting this key would leave every White Ravens pack reading "matches no
    // trusted key" on a fresh install, which is where nearly every player is.
    expect(BUILT_IN_KEYS.map((k) => k.publicKey)).toContain(WHITE_RAVENS_PUBLIC_KEY);
  });

  it('does not offer the publisher key twice when the user added it too', () => {
    const mine: TrustedKey[] = [
      { name: 'Mine', publicKey: WHITE_RAVENS_PUBLIC_KEY, addedAt: '2026-01-01T00:00:00.000Z' },
    ];
    const result = verifyManifestSignature(sign(manifest), mine);
    // The user's name for it wins; the built-in copy is not consulted again.
    expect(result).toMatchObject({ signed: true, valid: false });
  });
});

describe('assertManifestTrusted', () => {
  it('allows anything through when the user has configured no keys', () => {
    expect(() =>
      assertManifestTrusted({ signed: false, valid: false }, [], 'Ravens'),
    ).not.toThrow();
  });

  it('allows a manifest that verified', () => {
    expect(() =>
      assertManifestTrusted({ signed: true, valid: true }, trusted(), 'Ravens'),
    ).not.toThrow();
  });

  it('refuses an unsigned manifest once keys are configured', () => {
    // The downgrade attack: stripping the signature must not be a way past the
    // check, or configuring a key would buy nothing.
    expect(() =>
      assertManifestTrusted({ signed: false, valid: false }, trusted(), 'Ravens'),
    ).toThrow(/no signature/);
  });

  it('refuses a manifest whose signature does not verify', () => {
    expect(() =>
      assertManifestTrusted(
        { signed: true, valid: false, error: 'Signature does not match any trusted public key' },
        trusted(),
        'Ravens',
      ),
    ).toThrow(/does not match/);
  });
});
