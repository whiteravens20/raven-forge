import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../config/paths';
import { log } from '../../main/logger';
import { setSecret, getSecret, deleteSecret } from './secret-store';
import type { MinecraftAccount, AuthState } from '../../shared/ipc-types';

const AUTH_FILE = 'auth.json';

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

async function readRaw(): Promise<AuthStoreData> {
  try {
    const raw = await fs.readFile(getAuthPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AuthStoreData>;
    return {
      accounts: parsed.accounts ?? [],
      activeAccountId: parsed.activeAccountId ?? null,
      refreshTokens: parsed.refreshTokens ?? {},
      mcSessions: parsed.mcSessions,
    };
  } catch {
    return { accounts: [], activeAccountId: null, refreshTokens: {} };
  }
}

async function writeStore(data: AuthStoreData): Promise<void> {
  const file = getAuthPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), {
    encoding: 'utf-8',
    mode: AUTH_FILE_MODE,
  });
  // writeFile only applies `mode` when it creates the file, so an auth.json
  // written by an older build keeps its old permissions without this.
  await fs.chmod(file, AUTH_FILE_MODE).catch(() => undefined);
}

let migration: Promise<void> | undefined;

/**
 * Lift plaintext secrets left by pre-keychain builds into the keychain and drop
 * them from the file. Runs at most once per process; anything the keychain
 * rejects stays exactly where it is, so a failed migration is not a lost login.
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
  })();
  return migration;
}

async function readStore(): Promise<AuthStoreData> {
  await migrateOnce();
  return readRaw();
}

export async function getAuthState(): Promise<AuthState> {
  const store = await readStore();
  return {
    accounts: store.accounts,
    activeAccountId: store.activeAccountId,
    isAuthenticating: false,
  };
}

export async function saveAccount(
  account: MinecraftAccount,
  refreshToken?: string,
  mcSession?: McSession,
): Promise<void> {
  const store = await readStore();
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
  await writeStore(store);
}

export async function removeAccount(accountId: string): Promise<void> {
  const store = await readStore();
  store.accounts = store.accounts.filter((a) => a.id !== accountId);
  delete store.refreshTokens[accountId];
  delete store.mcSessions?.[accountId];
  if (store.activeAccountId === accountId) {
    store.activeAccountId = store.accounts[0]?.id ?? null;
  }
  await writeStore(store);
  await deleteSecret(refreshKey(accountId));
  await deleteSecret(sessionKey(accountId));
}

export async function setActiveAccountId(accountId: string): Promise<void> {
  const store = await readStore();
  if (!store.accounts.some((a) => a.id === accountId)) {
    throw new Error(`Account ${accountId} not found`);
  }
  store.activeAccountId = accountId;
  await writeStore(store);
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
