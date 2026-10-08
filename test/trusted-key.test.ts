// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { EXAMPLE_PUBLIC_KEY, isEd25519PublicKey } from '../src/shared/trusted-key';
import { WHITE_RAVENS_PUBLIC_KEY } from '../src/shared/branding';
import { globalSettingsSchema } from '../src/shared/validators';
import { DEFAULT_SETTINGS } from '../src/core/config/defaults';

/**
 * What may be stored as a trusted key.
 *
 * The verifier needs 32 raw bytes and throws on anything else, and a key on the
 * list switches enforcement on whether or not it can verify anything. So a key
 * of the wrong shape, once stored, refused every third-party manifest — and the
 * form took whatever was pasted into it.
 */

/** The same 32 bytes as OpenSSL writes them: twelve bytes of ASN.1 in front. */
function asSpki(publicKey: Uint8Array): string {
  const header = Uint8Array.from([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0,
  ]);
  return encodeBase64(Uint8Array.from([...header, ...publicKey]));
}

const real = encodeBase64(nacl.sign.keyPair().publicKey);

describe('isEd25519PublicKey', () => {
  it('accepts a key the verifier can use', () => {
    for (const key of [real, WHITE_RAVENS_PUBLIC_KEY, EXAMPLE_PUBLIC_KEY]) {
      expect(isEd25519PublicKey(key), key).toBe(true);
      // The claim the pattern makes, checked against the decoder the verifier
      // itself uses rather than restated.
      expect(decodeBase64(key)).toHaveLength(32);
    }
  });

  it('refuses the longer format OpenSSL exports', () => {
    // What the form's placeholder used to show the beginning of.
    const spki = asSpki(decodeBase64(real));
    expect(spki.startsWith('MCowBQYDK2VwAyEA')).toBe(true);
    expect(isEd25519PublicKey(spki)).toBe(false);
  });

  it('refuses everything else that gets pasted', () => {
    const wrong = [
      '',
      'not-a-key',
      real.slice(0, 30),
      real.slice(0, -1),
      `${real}=`,
      ` ${real}`,
      `${real}\n`,
      '-----BEGIN PUBLIC KEY-----',
      // URL-safe alphabet: the verifier's decoder does not read it.
      real.replace(/[+/]/g, '-').replace(/^./, '_'),
      // 31 and 33 bytes, each valid base64 of the wrong length.
      encodeBase64(new Uint8Array(31)),
      encodeBase64(new Uint8Array(33)),
    ];
    for (const value of wrong) expect(isEd25519PublicKey(value), JSON.stringify(value)).toBe(false);
  });
});

describe('the settings schema', () => {
  const key = (publicKey: string, name = 'Somebody') => ({
    name,
    publicKey,
    addedAt: '2026-01-01T00:00:00.000Z',
  });

  it('reads back every stored key, the ones the verifier cannot use among them', () => {
    // Builds before the key check stored whatever was pasted in. Such a key
    // still switches enforcement on, so it is not this parse's to drop: that
    // would switch it off again with nobody having asked. The Settings page
    // marks it, and the player removes it.
    const stored = [key(real), key('not-a-key'), key(asSpki(decodeBase64(real)))];
    const parsed = globalSettingsSchema.parse({
      ...DEFAULT_SETTINGS,
      theme: 'light',
      trustedPublicKeys: stored,
    });
    expect(parsed.theme).toBe('light');
    expect(parsed.trustedPublicKeys).toEqual(stored);
  });

  it('still starts from an empty list when the file names none', () => {
    const { trustedPublicKeys: _none, ...without } = DEFAULT_SETTINGS;
    expect(globalSettingsSchema.parse(without).trustedPublicKeys).toEqual([]);
  });
});
