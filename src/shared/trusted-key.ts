// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

/**
 * What a trusted key has to look like before it is stored.
 *
 * An Ed25519 public key is 32 bytes, and the verifier hands exactly those bytes
 * to `nacl.sign.detached.verify`, which throws on any other length. A key of
 * another shape — a PEM line, the longer wrapper OpenSSL exports, a string the
 * clipboard cut short — can therefore never verify anything, while its mere
 * presence on the list switches enforcement on. Together those refused every
 * third-party manifest and named no cause.
 *
 * 32 bytes in standard base64 are always 43 characters and one `=`: ten full
 * groups of three bytes and a last group of two. The pattern is that length and
 * that alphabet and nothing looser, because the verifier's decoder takes
 * nothing looser either — no URL-safe alphabet, no missing padding.
 *
 * Kept free of the schema library on purpose: the settings form checks a key
 * with this before sending it, and the renderer carries no `zod`.
 */
const ED25519_PUBLIC_KEY = /^[A-Za-z0-9+/]{43}=$/;

export function isEd25519PublicKey(value: string): boolean {
  return ED25519_PUBLIC_KEY.test(value);
}

/**
 * A key of the right shape to show in the form — the bytes 0 to 31, so it is
 * plainly nobody's.
 *
 * The placeholder used to be the first characters of an OpenSSL export, which
 * is exactly the format this refuses.
 */
export const EXAMPLE_PUBLIC_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
