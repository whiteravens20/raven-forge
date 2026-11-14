// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import { shareableAddress } from '../src/core/util/shareable-address';

/**
 * A pack's address goes into the log and into crash reports people attach to
 * public issues. What lets a player into a private pack must not go with it.
 */
describe('shareableAddress', () => {
  it('leaves an address with nothing to hide as it was', () => {
    expect(shareableAddress('https://packs.example/ravens/manifest.json')).toBe(
      'https://packs.example/ravens/manifest.json',
    );
  });

  it('keeps the server and the file, and drops a token in the query', () => {
    const out = shareableAddress('https://packs.example/m.json?token=s3cr3t-pack-key&v=2');
    expect(out).toBe('https://packs.example/m.json?<redacted>');
  });

  it('drops a query that is a token with no name', () => {
    expect(shareableAddress('https://packs.example/m.json?s3cr3t-pack-key')).not.toContain(
      's3cr3t-pack-key',
    );
  });

  it('drops a name and a password before the host', () => {
    const out = shareableAddress('https://raven:hunter22@packs.example:8443/m.json');
    expect(out).toBe('https://<redacted>@packs.example:8443/m.json');
  });

  it('drops a fragment', () => {
    expect(shareableAddress('https://packs.example/m.json#s3cr3t')).toBe(
      'https://packs.example/m.json#<redacted>',
    );
  });

  it('gives nothing of text that is not a web address', () => {
    expect(shareableAddress('raven:hunter22 packs.example')).toBe('<redacted>');
    expect(shareableAddress('not an address at all')).toBe('<redacted>');
    expect(shareableAddress('ftp://raven:hunter22@packs.example/m.json')).toBe('<redacted>');
  });
});
