// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MinecraftAccount } from '../src/shared/ipc-types';

/**
 * Getting a session token for a launch, when the stored one has run out.
 *
 * Signing in again is five requests to three companies, made without a word
 * while the player waits for the game. When it does not work there are three
 * things to tell apart, because each leads somewhere else:
 *
 * - nothing answered — play offline, or try again;
 * - a service answered that it is busy or broken — the same, since nothing
 *   about the account is wrong and signing in again meets the same answer;
 * - the account was refused — only signing in again helps.
 *
 * The second used to be told as the third. Mojang's sign-in limits how often it
 * may be asked and says so with a 429; Xbox Live has its bad hours. Either one
 * told the player that their session had expired and that they should sign in
 * again — which then failed the same way.
 */

const account: MinecraftAccount = {
  id: 'a1',
  uuid: '069a79f444e94726a5befca90e38aaf5',
  username: 'RavenPlayer',
  type: 'microsoft',
};

const { store, answers, asked } = vi.hoisted(() => ({
  store: {
    session: undefined as { accessToken: string; expiresAt: number } | undefined,
    refreshToken: 'the-refresh-token' as string | undefined,
    saved: [] as unknown[],
  },
  /** What each service answers with: a status, or `network` for no answer at all. */
  answers: {} as Record<string, number | 'network'>,
  asked: [] as string[],
}));

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../src/main/window', () => ({ getMainWindow: () => null }));
vi.mock('../src/core/auth/token-store', () => ({
  getMcSession: async () => store.session,
  getAccount: async () => account,
  getRefreshToken: async () => store.refreshToken,
  saveAccount: async (
    saved: MinecraftAccount,
    _refreshToken: string,
    session: { accessToken: string; expiresAt: number },
  ) => {
    store.saved.push(saved);
    store.session = session;
  },
  removeAccount: async () => {},
  setActiveAccountId: async () => {},
  getAuthState: async () => ({ accounts: [account], activeAccountId: account.id }),
}));

const { getMinecraftAccessToken } = await import('../src/core/auth/microsoft-auth');
const { AuthServersUnreachableError } = await import('../src/core/auth/auth-errors');
const { RefusedError } = await import('../src/core/util/refusal');

/** The five requests of a sign-in, by the host that answers each. */
const SERVICES = {
  microsoft: 'login.microsoftonline.com',
  xboxLive: 'user.auth.xboxlive.com',
  xsts: 'xsts.auth.xboxlive.com',
  minecraft: '/authentication/login_with_xbox',
  profile: '/minecraft/profile',
} as const;

const GOOD: Record<keyof typeof SERVICES, unknown> = {
  microsoft: { access_token: 'ms-access', refresh_token: 'ms-refresh-2', expires_in: 3600 },
  xboxLive: { Token: 'xbl', DisplayClaims: { xui: [{ uhs: 'hash' }] } },
  xsts: { Token: 'xsts' },
  minecraft: { access_token: 'a-new-minecraft-token', token_type: 'Bearer', expires_in: 86400 },
  profile: { id: account.uuid, name: 'RavenPlayer', skins: [] },
};

beforeEach(() => {
  store.session = { accessToken: 'an-old-token', expiresAt: Date.now() - 1000 };
  store.refreshToken = 'the-refresh-token';
  store.saved.length = 0;
  asked.length = 0;
  for (const name of Object.keys(answers)) delete answers[name];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      const [name] = Object.entries(SERVICES).find(([, part]) => url.includes(part)) ?? [];
      if (!name) throw new Error(`not a sign-in request: ${url}`);
      asked.push(name);
      const answer = answers[name] ?? 200;
      if (answer === 'network') {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
        });
      }
      return new Response(JSON.stringify(answer === 200 ? GOOD[name as keyof typeof GOOD] : {}), {
        status: answer,
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a session token for a launch', () => {
  it('is the stored one while that has time left, and nobody is asked', async () => {
    store.session = { accessToken: 'still-good', expiresAt: Date.now() + 60 * 60 * 1000 };

    expect(await getMinecraftAccessToken('a1')).toBe('still-good');
    expect(asked).toEqual([]);
  });

  it('is fetched again, without a word, once the stored one has run out', async () => {
    expect(await getMinecraftAccessToken('a1')).toBe('a-new-minecraft-token');
    expect(asked).toEqual(['microsoft', 'xboxLive', 'xsts', 'minecraft', 'profile']);
  });
});

describe('a sign-in that could not be made again', () => {
  it.each(Object.keys(SERVICES))(
    'is called unreachable when %s gives no answer at all',
    async (service) => {
      answers[service] = 'network';

      await expect(getMinecraftAccessToken('a1')).rejects.toBeInstanceOf(
        AuthServersUnreachableError,
      );
    },
  );

  it.each([
    ['minecraft', 429],
    ['xboxLive', 503],
    ['xsts', 500],
    ['microsoft', 502],
    ['profile', 504],
    ['minecraft', 408],
  ] as const)(
    'is called unreachable too when %s answers %i: nothing is wrong with the account',
    async (service, status) => {
      answers[service] = status;

      await expect(getMinecraftAccessToken('a1')).rejects.toBeInstanceOf(
        AuthServersUnreachableError,
      );
    },
  );

  it.each([
    ['microsoft', 400],
    ['xboxLive', 401],
    ['minecraft', 403],
  ] as const)(
    'is an expired session when %s answers %i, said in words the window can translate',
    async (service, status) => {
      answers[service] = status;

      const refused = await getMinecraftAccessToken('a1').catch((err: unknown) => err);

      expect(refused).toBeInstanceOf(RefusedError);
      expect((refused as InstanceType<typeof RefusedError>).errorMessage).toEqual({
        key: 'launchError.sessionExpired',
      });
    },
  );

  it('is an expired session as well when there is no refresh token to try', async () => {
    store.refreshToken = undefined;

    const refused = await getMinecraftAccessToken('a1').catch((err: unknown) => err);

    expect(refused).toBeInstanceOf(RefusedError);
    expect(asked).toEqual([]);
  });
});
