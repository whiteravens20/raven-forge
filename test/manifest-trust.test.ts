import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { encodeBase64, decodeUTF8 } from 'tweetnacl-util';
import { canonicalize } from '../src/core/updater/canonical';
import {
  verifyManifestSignature,
  assertManifestTrusted,
} from '../src/core/updater/manifest-verify';
import {
  BUILT_IN_KEYS,
  WHITE_RAVENS_PUBLIC_KEY,
  isFirstPartyManifestUrl,
} from '../src/shared/branding';
import { isSecureContentUrl } from '../src/shared/validators';
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

  it('refuses an unsigned first-party manifest even with no keys configured', () => {
    // The built-in key vouches for every White Ravens pack; an unsigned copy of
    // one has been tampered with in transit, and "the player added no keys of
    // their own" must not be a way past that. This is the fix for the manifest
    // that installed anyway because enforcement keyed off the user list.
    expect(() =>
      assertManifestTrusted({ signed: false, valid: false }, [], 'Ravens', true),
    ).toThrow(/White Ravens pack/);
  });

  it('still installs a verified first-party manifest', () => {
    expect(() =>
      assertManifestTrusted({ signed: true, valid: true }, [], 'Ravens', true),
    ).not.toThrow();
  });

  it('leaves a third-party manifest on the opt-in policy', () => {
    expect(() =>
      assertManifestTrusted({ signed: false, valid: false }, [], 'Ravens', false),
    ).not.toThrow();
  });
});

describe('isFirstPartyManifestUrl', () => {
  it('recognises a manifest served from the packs site', () => {
    expect(
      isFirstPartyManifestUrl(
        'https://whiteravens20.github.io/raven-packs/ravenclassic/manifest.json',
      ),
    ).toBe(true);
  });

  it('does not treat a look-alike host as first-party', () => {
    expect(
      isFirstPartyManifestUrl('https://whiteravens20.github.io.evil.example/raven-packs/x.json'),
    ).toBe(false);
    expect(isFirstPartyManifestUrl('https://evil.example/raven-packs/x.json')).toBe(false);
  });

  it('does not let a different path on the same host inherit the trust', () => {
    expect(isFirstPartyManifestUrl('https://whiteravens20.github.io/other/x.json')).toBe(false);
  });

  it('rejects a garbage URL rather than throwing', () => {
    expect(isFirstPartyManifestUrl('not a url')).toBe(false);
  });
});

describe('isSecureContentUrl', () => {
  it('accepts https', () => {
    expect(isSecureContentUrl('https://example.net/manifest.json')).toBe(true);
  });

  it('rejects plaintext http to a remote host', () => {
    expect(isSecureContentUrl('http://example.net/manifest.json')).toBe(false);
  });

  it('allows http only to loopback, for a pack author testing locally', () => {
    expect(isSecureContentUrl('http://localhost:8080/pack.mrpack')).toBe(true);
    expect(isSecureContentUrl('http://127.0.0.1/pack.mrpack')).toBe(true);
  });

  it('rejects a non-web scheme', () => {
    expect(isSecureContentUrl('file:///etc/passwd')).toBe(false);
    expect(isSecureContentUrl('ftp://example.net/x')).toBe(false);
  });
});
