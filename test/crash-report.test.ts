import os from 'node:os';
import { describe, it, expect } from 'vitest';
import { redactSecrets, buildCrashReport } from '../src/core/diagnostics/crash-report';
import type { CrashReportInput } from '../src/core/diagnostics/crash-report';
import type { Profile } from '../src/shared/ipc-types';

/**
 * A crash report exists to be attached to a public issue without thinking about
 * it, which is only true if it can never carry a live Minecraft session token.
 * Everything here is about that one promise.
 */

const TOKEN =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyYXZlbiIsInh1aWQiOiI3NzcifQ.c2lnbmF0dXJlLWdvZXMtaGVyZQ';

describe('redactSecrets', () => {
  it('removes a session token wherever it appears in the output', () => {
    const line = `[main/INFO]: args = --username Raven --accessToken ${TOKEN} --version 1.21.4`;
    const out = redactSecrets(line, []);
    expect(out).not.toContain(TOKEN);
    // The rest of the line still has to be readable — that is the whole report.
    expect(out).toContain('--version 1.21.4');
  });

  it('removes a credential argument even when the value is not a JWT', () => {
    expect(redactSecrets('--accessToken abc123def456 --xuid=2535400000000000')).not.toMatch(
      /abc123def456|2535400000000000/,
    );
  });

  it('removes the values this launch is known to have used', () => {
    const out = redactSecrets('Setting user: RavenPlayer (069a79f4-44e9-4726-a5be-fca90e38aaf5)', [
      'RavenPlayer',
      '069a79f4-44e9-4726-a5be-fca90e38aaf5',
    ]);
    expect(out).not.toContain('RavenPlayer');
    expect(out).not.toContain('069a79f4-44e9-4726-a5be-fca90e38aaf5');
  });

  it('matches a known value however the log happened to case it', () => {
    expect(redactSecrets('user ravenplayer joined', ['RavenPlayer'])).not.toContain('ravenplayer');
  });

  it('leaves the home directory prefix out of every path but keeps the path', () => {
    const out = redactSecrets(`Launching from ${os.homedir()}/.config/Raven Forge Launcher`);
    expect(out).not.toContain(os.homedir());
    expect(out).toContain('~/.config/Raven Forge Launcher');
  });

  it('ignores secrets too short to redact without shredding the text', () => {
    // `0` is the access token an offline launch uses. Redacting it would blank
    // out every version number, port and timestamp in the file.
    expect(redactSecrets('Exit code 0 after 10 min', ['0'])).toBe('Exit code 0 after 10 min');
  });
});

const profile: Profile = {
  id: 'p1',
  name: 'White Ravens Classic',
  minecraftVersion: '1.21.4',
  modLoader: 'fabric',
  modLoaderVersion: '0.16.9',
  allocatedRamMb: 4096,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const input: CrashReportInput = {
  profile,
  exitCode: 1,
  playTimeMinutes: 3,
  startedAt: Date.now(),
  logTail: [`[main/INFO]: --accessToken ${TOKEN}`, '[main/ERROR]: java.lang.NullPointerException'],
  gameDir: '/data/profiles/p1/.minecraft',
  java: { path: '/data/java/21/bin/java', version: 21, vendor: 'Adoptium Temurin' },
  accountType: 'microsoft',
  offlineLaunch: false,
  secrets: [TOKEN, 'RavenPlayer'],
};

describe('buildCrashReport', () => {
  it('carries what a bug report needs', () => {
    const report = buildCrashReport(input, ['sodium.jar', 'lithium.jar']);
    expect(report).toContain('1.21.4');
    expect(report).toContain('fabric 0.16.9');
    expect(report).toContain('Adoptium Temurin');
    expect(report).toContain('## Mods (2)');
    expect(report).toContain('sodium.jar');
    expect(report).toContain('java.lang.NullPointerException');
  });

  it('carries no token, in the quoted output or anywhere else', () => {
    const report = buildCrashReport(input, [], {
      file: 'crash-2026-08-07_15.46.31-client.txt',
      content: `-- Head --\nUser: RavenPlayer\nToken: ${TOKEN}`,
    });
    expect(report).not.toContain(TOKEN);
    expect(report).not.toContain('RavenPlayer');
    expect(report).toContain('crash-2026-08-07_15.46.31-client.txt');
  });

  it('says the process never started, when that is what happened', () => {
    const report = buildCrashReport({ ...input, spawnError: 'spawn java ENOENT' }, []);
    expect(report).toContain('spawn java ENOENT');
  });
});
