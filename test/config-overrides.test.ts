import { describe, it, expect } from 'vitest';
import { configVersion, shouldApplyConfigOverride } from '../src/core/mods/config-overrides';

/**
 * A pack's config overrides are a starting point, not a policy. The player owns
 * the file afterwards, and the one thing that must never happen is a sync
 * quietly handing their settings back to the pack.
 */

const packVersion = { sha256: 'a'.repeat(64) };
const nextPackVersion = { sha256: 'b'.repeat(64) };

describe('shouldApplyConfigOverride', () => {
  it('writes the file when the profile does not have it yet', () => {
    expect(shouldApplyConfigOverride(packVersion, undefined, false)).toBe(true);
  });

  it('writes it again when the file was deleted after being delivered', () => {
    const delivered = configVersion(packVersion)!;
    expect(shouldApplyConfigOverride(packVersion, delivered, false)).toBe(true);
  });

  it('leaves an edited file alone once the pack has delivered its version', () => {
    // Exactly the options.txt case: Minecraft rewrote it on exit, so the file
    // no longer matches the manifest and never will again.
    const delivered = configVersion(packVersion)!;
    expect(shouldApplyConfigOverride(packVersion, delivered, true)).toBe(false);
  });

  it('writes the file when the author changed it in the pack', () => {
    const delivered = configVersion(packVersion)!;
    expect(shouldApplyConfigOverride(nextPackVersion, delivered, true)).toBe(true);
  });

  it('writes the file on the first sync that has no record to go on', () => {
    // Profiles synced before records existed. One more overwrite, then never.
    expect(shouldApplyConfigOverride(packVersion, undefined, true)).toBe(true);
  });

  it('writes an unhashed override every time, having no way to tell edits from updates', () => {
    expect(shouldApplyConfigOverride({}, undefined, true)).toBe(true);
    expect(shouldApplyConfigOverride({}, 'sha256:whatever', true)).toBe(true);
  });
});

describe('configVersion', () => {
  it('names the algorithm alongside the digest', () => {
    // Two manifests can describe one file with different algorithms; comparing
    // bare digests would read that as a change and overwrite the player's file.
    expect(configVersion(packVersion)).toBe(`sha256:${'a'.repeat(64)}`);
    expect(configVersion({ sha512: 'c'.repeat(128) })).toBe(`sha512:${'c'.repeat(128)}`);
  });

  it('prefers the strongest hash the manifest published', () => {
    expect(configVersion({ sha1: 'd'.repeat(40), sha512: 'e'.repeat(128) })).toBe(
      `sha512:${'e'.repeat(128)}`,
    );
  });

  it('has nothing to say about an entry carrying no hash', () => {
    expect(configVersion({})).toBeNull();
  });
});
