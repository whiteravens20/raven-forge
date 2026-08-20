import { describe, it, expect, afterEach, vi } from 'vitest';
import { REPO_URL } from '../src/shared/branding';

/**
 * How the launcher introduces itself to Modrinth.
 *
 * Modrinth's API terms ask for a project identifier and somewhere to reach the
 * people behind it, and their rate limiter is kinder to a named agent than to
 * an anonymous one. Getting this wrong does not fail a build or a launch; it
 * fails later, on somebody else's machine, as mod search being throttled.
 *
 * The version is the part worth pinning. It used to be a constant sitting
 * beside this string, and a second copy of a number that `package.json` already
 * states authoritatively — so the first release that bumped one and not the
 * other had the launcher telling Modrinth it was a version it had stopped being.
 */

const { version } = vi.hoisted(() => ({ version: { value: '0.0.0-test' } }));

vi.mock('electron', () => ({ app: { getVersion: () => version.value } }));

afterEach(() => {
  version.value = '0.0.0-test';
});

async function userAgent(): Promise<string> {
  vi.resetModules();
  const { modrinthUserAgent } = await import('../src/core/net/user-agent');
  return modrinthUserAgent();
}

describe('modrinthUserAgent', () => {
  it('names the project and where to find it', async () => {
    expect(await userAgent()).toBe(`whiteravens20/raven-forge/0.0.0-test (${REPO_URL})`);
  });

  it('asks the app what version it is, every time', async () => {
    version.value = '1.4.0';
    expect(await userAgent()).toContain('/1.4.0 ');
  });

  it('reaches Modrinth in the shape their terms ask for', async () => {
    // author/project/version followed by a contact in brackets.
    expect(await userAgent()).toMatch(/^[\w-]+\/[\w-]+\/\S+ \(https:\/\/\S+\)$/);
  });
});
