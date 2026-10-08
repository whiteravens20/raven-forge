// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { paths } from '../config/paths';
import { FILE_AUTH } from '../../shared/constants';
import { writeJsonAtomic } from '../util/atomic-file';
import { serializeByKey } from '../util/serialize';
import { log } from '../../main/logger';
import { setSecret, getSecret, deleteSecret } from './secret-store';
import type { MinecraftAccount, AuthState } from '../../shared/ipc-types';

const AUTH_FILE = FILE_AUTH;

/** Fallback credentials must not be world-readable. */
const AUTH_FILE_MODE = 0o600;

const refreshKey = (accountId: string): string => `msRefresh:${accountId}`;
const sessionKey = (accountId: string): string => `mcAccess:${accountId}`;

/** Minecraft session token for one account, as issued by api.minecraftservices.com */
export interface McSession {
  accessToken: string;
  /** Epoch milliseconds at which the token stops being accepted */
  expiresAt: number;
}

/**
 * The on-disk half of a session. The expiry is not a secret, and keeping it in
 * the file means the "does this need refreshing?" check never touches the
 * keychain — only actually spending the token does.
 */
interface StoredMcSession {
  expiresAt: number;
  /** Present only when the keychain refused the write. */
  accessToken?: string;
}

interface AuthStoreData {
  accounts: MinecraftAccount[];
  activeAccountId: string | null;
  /**
   * accountId → MSA refresh token. Secrets belong in the OS keychain; this is
   * populated only on systems where the keychain is unreachable, and is empty
   * on a healthy install.
   */
  refreshTokens: Record<string, string>;
  mcSessions?: Record<string, StoredMcSession>;
}

function getAuthPath(): string {
  return path.join(paths.root, AUTH_FILE);
}

let warnedAboutFallback = false;

/** Say it once per process, loudly enough to explain the security downgrade. */
function warnFallback(): void {
  if (warnedAboutFallback) return;
  warnedAboutFallback = true;
  log.warn(
    `OS keychain unusable — credentials are being written to ${getAuthPath()} ` +
      'in plaintext (permissions 0600). On Linux this normally means no keyring ' +
      'daemon (gnome-keyring, kwallet) is running in this session.',
  );
}

/**
 * Read `auth.json` from disk.
 *
 * Only a file that is not there reads as "nobody signed in". Every failure used
 * to, and every writer here starts from what this returns — so one read that
 * failed on a locked file was followed by a save of the one account being
 * changed, and every other login was gone from the list, fallback tokens
 * included.
 *
 * A file that is there and will not parse is moved aside rather than saved
 * over, and its mode re-applied: it may hold tokens, and it is the one copy an
 * older build could have left readable by others. Any other error is thrown.
 *
 * Reads take turns, in a queue of their own because a mutation reads from
 * inside its turn. Two readers finding the file broken at once would both move
 * it aside, and the second would move whatever a save had put there since.
 */
/**
 * An account as it is kept: these fields, and nothing else the file may hold.
 *
 * The file used to date each sign-in as well. Nothing ever read that, so it is
 * no longer written — and taking only what is named here is what makes the next
 * write leave it out of a file that still has it.
 */
const storedAccountSchema = z.object({
  id: z.string().min(1),
  uuid: z.string().min(1),
  username: z.string().min(1),
  type: z.enum(['microsoft', 'offline']),
  skinUrl: z.string().optional().catch(undefined),
});

const storedSessionSchema = z.object({
  expiresAt: z.number(),
  accessToken: z.string().optional().catch(undefined),
});

let warnedAboutEntries = false;

/** The entries of a stored map, or none when what is stored is not a map. */
function entriesOf(value: unknown): [string, unknown][] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  return Object.entries(value);
}

/**
 * What a parsed `auth.json` holds, taken a part at a time.
 *
 * The whole of it used to be believed as it parsed. An account with no name —
 * a file edited by hand — was handed to the Accounts page, which had nothing to
 * draw then but the error screen; an entry that was not an object at all made
 * the store unreadable, and with it every account beside it. What is not an
 * account, a token or a session is now left out and named in the log.
 *
 * Left out and not kept, unlike an entry of the profile list: nothing hangs on
 * an account's record that signing in again does not put back, and a Microsoft
 * account comes back under the id its secrets are already stored by.
 */
function readStored(parsed: Record<string, unknown>, file: string): AuthStoreData {
  const accounts: MinecraftAccount[] = [];
  const leftOut: number[] = [];
  const listed = Array.isArray(parsed.accounts) ? parsed.accounts : [];
  for (const [index, entry] of listed.entries()) {
    const read = storedAccountSchema.safeParse(entry);
    if (read.success) accounts.push(read.data);
    else leftOut.push(index + 1);
  }
  // Once, because every use of the store reads the file again; and by position,
  // never by content, because this is the one file that may hold a token.
  if (leftOut.length > 0 && !warnedAboutEntries) {
    warnedAboutEntries = true;
    log.warn(`${file}: not an account, and left out of the list — entry ${leftOut.join(', ')}`);
  }

  const refreshTokens: Record<string, string> = {};
  for (const [accountId, token] of entriesOf(parsed.refreshTokens)) {
    if (typeof token === 'string') refreshTokens[accountId] = token;
  }

  let mcSessions: Record<string, StoredMcSession> | undefined;
  for (const [accountId, session] of entriesOf(parsed.mcSessions)) {
    const read = storedSessionSchema.safeParse(session);
    if (read.success) mcSessions = { ...mcSessions, [accountId]: read.data };
  }

  // An active account that is not on the list is nobody signed in, with
  // accounts sitting right there: the first one is, as when one is removed.
  const active = accounts.find((account) => account.id === parsed.activeAccountId) ?? accounts[0];
  return { accounts, activeAccountId: active?.id ?? null, refreshTokens, mcSessions };
}

function readRaw(): Promise<AuthStoreData> {
  const file = getAuthPath();
  return serializeByKey(`${file}:read`, async () => {
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      return { accounts: [], activeAccountId: null, refreshTokens: {} };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      const backup = `${file}.broken-${Date.now()}`;
      log.error(`${file} is not an account store — keeping a copy at ${backup} and starting empty`);
      await fs.rename(file, backup);
      await fs.chmod(backup, AUTH_FILE_MODE).catch(() => undefined);
      return { accounts: [], activeAccountId: null, refreshTokens: {} };
    }

    return readStored(parsed as Record<string, unknown>, file);
  });
}

async function writeStore(data: AuthStoreData): Promise<void> {
  const file = getAuthPath();
  // Written beside the file with this mode and renamed onto it, so the mode an
  // older build left on the file goes with the file it replaces.
  await writeJsonAtomic(file, data, AUTH_FILE_MODE);
}

let migration: Promise<void> | undefined;

/**
 * Lift plaintext secrets left by pre-keychain builds into the keychain and drop
 * them from the file. Runs at most once per process; anything the keychain
 * rejects stays exactly where it is, so a failed migration is not a lost login.
 *
 * Once it has worked, that is. Every read waits on this promise, so one that
 * failed — the file could not be read just then — is forgotten rather than
 * kept: remembered, it would answer every later read of the session with the
 * same failure, long after the file was readable again.
 */
function migrateOnce(): Promise<void> {
  migration ??= (async () => {
    const store = await readRaw();
    let moved = 0;

    for (const [accountId, token] of Object.entries(store.refreshTokens)) {
      if (await setSecret(refreshKey(accountId), token)) {
        delete store.refreshTokens[accountId];
        moved++;
      }
    }

    for (const [accountId, session] of Object.entries(store.mcSessions ?? {})) {
      if (!session.accessToken) continue;
      if (await setSecret(sessionKey(accountId), session.accessToken)) {
        delete session.accessToken;
        moved++;
      }
    }

    if (moved > 0) {
      await writeStore(store);
      log.info(`Moved ${moved} stored credential(s) from auth.json into the OS keychain`);
    }
  })().catch((err: unknown) => {
    migration = undefined;
    throw err;
  });
  return migration;
}

async function readStore(): Promise<AuthStoreData> {
  await migrateOnce();
  return readRaw();
}

/**
 * Read `auth.json`, change it, and write it back with nothing in between.
 *
 * The same shape as `mutateLockFile`, and needed for the same reason: the three
 * writers here each read the whole store, `await` a keychain round trip in the
 * middle, and write the whole store back. The window is small — these run from
 * clicks on the Accounts page — but a keychain that is slow to answer widens it,
 * and what is at stake is a signed-in account disappearing from the list.
 */
function mutateStore<T>(mutate: (store: AuthStoreData) => T | Promise<T>): Promise<T> {
  return serializeByKey(getAuthPath(), async () => {
    const store = await readStore();
    const result = await mutate(store);
    await writeStore(store);
    return result;
  });
}

/**
 * True when a secret is currently sitting in `auth.json` instead of the keychain.
 *
 * Read from what is actually on disk rather than from whether `warnFallback`
 * happened to fire this session, so it is right on a launch that only reads.
 */
function hasPlaintextSecrets(store: AuthStoreData): boolean {
  if (Object.keys(store.refreshTokens).length > 0) return true;
  return Object.values(store.mcSessions ?? {}).some((session) => Boolean(session.accessToken));
}

export async function getAuthState(): Promise<AuthState> {
  const store = await readStore();
  const plaintext = hasPlaintextSecrets(store);
  return {
    accounts: store.accounts,
    activeAccountId: store.activeAccountId,
    // Surfaced, not only logged. The fallback is the right behaviour — better
    // than refusing to log in on a machine with no keyring daemon — but the
    // person whose Microsoft refresh token is in a plaintext file is the one
    // who should get to decide whether that is acceptable, and a `log.warn`
    // they will never open does not tell them.
    credentialsInPlaintext: plaintext,
    ...(plaintext ? { credentialsFile: getAuthPath() } : {}),
  };
}

export async function saveAccount(
  account: MinecraftAccount,
  refreshToken?: string,
  mcSession?: McSession,
): Promise<void> {
  await mutateStore(async (store) => {
    const idx = store.accounts.findIndex((a) => a.id === account.id);
    if (idx >= 0) {
      store.accounts[idx] = account;
    } else {
      store.accounts.push(account);
    }

    if (refreshToken) {
      if (await setSecret(refreshKey(account.id), refreshToken)) {
        delete store.refreshTokens[account.id];
      } else {
        warnFallback();
        store.refreshTokens[account.id] = refreshToken;
      }
    }

    if (mcSession) {
      const stored: StoredMcSession = { expiresAt: mcSession.expiresAt };
      if (!(await setSecret(sessionKey(account.id), mcSession.accessToken))) {
        warnFallback();
        stored.accessToken = mcSession.accessToken;
      }
      store.mcSessions = { ...store.mcSessions, [account.id]: stored };
    }

    if (!store.activeAccountId) {
      store.activeAccountId = account.id;
    }
  });
}

export async function removeAccount(accountId: string): Promise<void> {
  await mutateStore((store) => {
    store.accounts = store.accounts.filter((a) => a.id !== accountId);
    delete store.refreshTokens[accountId];
    delete store.mcSessions?.[accountId];
    if (store.activeAccountId === accountId) {
      store.activeAccountId = store.accounts[0]?.id ?? null;
    }
  });
  await deleteSecret(refreshKey(accountId));
  await deleteSecret(sessionKey(accountId));
}

export async function setActiveAccountId(accountId: string): Promise<void> {
  await mutateStore((store) => {
    if (!store.accounts.some((a) => a.id === accountId)) {
      throw new Error(`Account ${accountId} not found`);
    }
    store.activeAccountId = accountId;
  });
}

export async function getRefreshToken(accountId: string): Promise<string | undefined> {
  const fromKeychain = await getSecret(refreshKey(accountId));
  if (fromKeychain) return fromKeychain;
  const store = await readStore();
  return store.refreshTokens[accountId];
}

export async function getAccount(accountId: string): Promise<MinecraftAccount | undefined> {
  const store = await readStore();
  return store.accounts.find((a) => a.id === accountId);
}

export async function getMcSession(accountId: string): Promise<McSession | undefined> {
  const store = await readStore();
  const stored = store.mcSessions?.[accountId];
  if (!stored) return undefined;

  // A token we can no longer read is indistinguishable from an expired one —
  // reporting it as missing makes the caller re-run the refresh chain.
  const accessToken = (await getSecret(sessionKey(accountId))) ?? stored.accessToken;
  if (!accessToken) return undefined;

  return { accessToken, expiresAt: stored.expiresAt };
}
