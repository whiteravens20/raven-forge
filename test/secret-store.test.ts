// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { warnings, keychain } = vi.hoisted(() => ({
  warnings: [] as string[],
  keychain: {
    setPassword: vi.fn<(service: string, key: string, value: string) => Promise<void>>(),
  },
}));

vi.mock('../src/main/logger', () => ({
  log: {
    warn: (...said: unknown[]) => warnings.push(said.map(String).join(' ')),
    info: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// The keychain is a native module, and one that only a desktop session can
// use. What is tested here is what the launcher says of a refusal, so the
// module is stood in for at the one place it is loaded.
vi.mock('node:module', async (original) => ({
  ...(await original<typeof import('node:module')>()),
  createRequire: () => () => keychain,
}));

import { WINDOWS_SECRET_LIMIT, setSecret, tooLongNote } from '../src/core/auth/secret-store';

/** What Windows answers a secret it will not keep with, word for word. */
const REFUSED_BY_WINDOWS = new Error('The stub received bad data.');

beforeEach(() => {
  warnings.length = 0;
  keychain.setPassword.mockReset();
});

describe('tooLongNote', () => {
  it('says the size and the limit of a secret Windows will not keep', () => {
    const note = tooLongNote('r'.repeat(WINDOWS_SECRET_LIMIT + 1), 'win32');
    expect(note).toContain(`${WINDOWS_SECRET_LIMIT + 1} bytes`);
    expect(note).toContain(`takes ${WINDOWS_SECRET_LIMIT}`);
    expect(note).toContain('Credential Manager');
  });

  it('says nothing of one that fits, to the last byte', () => {
    expect(tooLongNote('r'.repeat(WINDOWS_SECRET_LIMIT), 'win32')).toBe('');
    expect(tooLongNote('', 'win32')).toBe('');
  });

  it('counts bytes, which is what Windows counts, and not characters', () => {
    // 1300 letters, each two bytes: within the limit as characters go, over
    // it as Windows keeps them.
    const note = tooLongNote('ż'.repeat(1300), 'win32');
    expect(note).toContain('2600 bytes');
  });

  it.each(['linux', 'darwin'] as const)(
    'says nothing on %s, whose keychain has no such limit',
    (platform) => {
      expect(tooLongNote('r'.repeat(100_000), platform)).toBe('');
    },
  );
});

describe('setSecret', () => {
  it('is true, and says nothing, when the keychain takes the secret', async () => {
    keychain.setPassword.mockResolvedValue(undefined);

    expect(await setSecret('msRefresh:a1', 'token')).toBe(true);

    expect(keychain.setPassword).toHaveBeenCalledWith(
      'com.ravenforge.launcher',
      'msRefresh:a1',
      'token',
    );
    expect(warnings).toEqual([]);
  });

  it('is false when the keychain refuses, and names what was refused and never the secret', async () => {
    keychain.setPassword.mockRejectedValue(new Error('no keyring daemon'));

    expect(await setSecret('msRefresh:a1', 'a-secret-token')).toBe(false);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"msRefresh:a1"');
    expect(warnings[0]).toContain('no keyring daemon');
    expect(warnings[0]).not.toContain('a-secret-token');
  });

  // On the system it is about, with what that system answers. Windows says
  // only that "the stub received bad data"; the line in the log has to say
  // what was wrong with it.
  it.skipIf(process.platform !== 'win32')(
    'says, on Windows, that a secret was too long for the Credential Manager',
    async () => {
      keychain.setPassword.mockRejectedValue(REFUSED_BY_WINDOWS);
      const tooLong = 'r'.repeat(WINDOWS_SECRET_LIMIT + 1);

      expect(await setSecret('msRefresh:a1', tooLong)).toBe(false);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(`${WINDOWS_SECRET_LIMIT + 1} bytes`);
      expect(warnings[0]).toContain(`takes ${WINDOWS_SECRET_LIMIT}`);
      expect(warnings[0]).toContain('The stub received bad data.');
      expect(warnings[0]).not.toContain(tooLong);
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'gives no such reason, on Windows, for a secret that would have fitted',
    async () => {
      keychain.setPassword.mockRejectedValue(new Error('The credential store is locked.'));

      expect(await setSecret('msRefresh:a1', 'token')).toBe(false);

      expect(warnings[0]).not.toContain('Credential Manager takes');
    },
  );
});
