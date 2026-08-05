import { BrowserWindow } from 'electron';
import crypto from 'node:crypto';
import { log } from '../../main/logger';
import { getMainWindow } from '../../main/window';
import {
  MS_AUTH_BASE,
  XBOX_AUTH_URL,
  XSTS_AUTH_URL,
  MC_AUTH_URL,
  MC_PROFILE_URL,
} from '../../shared/constants';
import type { MinecraftAccount, AuthState } from '../../shared/ipc-types';
import { BUILD_CLIENT_ID } from './build-config';
import { offlineUuid } from './offline-uuid';
import { AuthServersUnreachableError, isNetworkFailure } from './auth-errors';
import {
  saveAccount,
  removeAccount,
  setActiveAccountId,
  getRefreshToken,
  getAccount,
  getMcSession,
  getAuthState as getStoredAuthState,
} from './token-store';

// ── Azure AD App Registration ──────────────────────────────
// To use real Microsoft auth, register your own app and set RAVENFORGE_CLIENT_ID
// for the build — docs/AZURE-SETUP.md walks through it, including the approval
// step Mojang requires before a new registration may call their API at all.
// Unconfigured builds stay runnable: offline mode works and Microsoft login
// fails with a clear message instead of a cryptic OAuth error.
const MS_CLIENT_ID_PLACEHOLDER = 'REPLACE_WITH_YOUR_AZURE_CLIENT_ID';
const MS_CLIENT_ID = process.env.RAVENFORGE_CLIENT_ID ?? BUILD_CLIENT_ID;
const MS_REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
const MS_SCOPES = 'XboxLive.signin offline_access';

// ── Microsoft OAuth ────────────────────────────────────────

async function getMsAuthCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const authWindow = new BrowserWindow({
      width: 520,
      height: 700,
      show: true,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    const authUrl = new URL(`${MS_AUTH_BASE}/authorize`);
    authUrl.searchParams.set('client_id', MS_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', MS_REDIRECT_URI);
    authUrl.searchParams.set('scope', MS_SCOPES);
    authUrl.searchParams.set('prompt', 'select_account');

    authWindow.loadURL(authUrl.toString());

    authWindow.webContents.on('will-redirect', (_event, url) => {
      const parsed = new URL(url);
      const code = parsed.searchParams.get('code');
      const error = parsed.searchParams.get('error');
      if (code) {
        authWindow.close();
        resolve(code);
      } else if (error) {
        authWindow.close();
        reject(
          new Error(`MS Auth error: ${error} — ${parsed.searchParams.get('error_description')}`),
        );
      }
    });

    authWindow.on('closed', () => {
      reject(new Error('Authentication window was closed'));
    });
  });
}

interface MsTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function exchangeMsCodeForTokens(code: string): Promise<MsTokenResponse> {
  const body = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    code,
    grant_type: 'authorization_code',
    redirect_uri: MS_REDIRECT_URI,
    scope: MS_SCOPES,
  });

  const res = await fetch(`${MS_AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MS token exchange failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<MsTokenResponse>;
}

async function refreshMsTokens(refreshToken: string): Promise<MsTokenResponse> {
  const body = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: MS_SCOPES,
  });

  const res = await fetch(`${MS_AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MS token refresh failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<MsTokenResponse>;
}

// ── Xbox Live ──────────────────────────────────────────────

interface XblResponse {
  Token: string;
  DisplayClaims: { xui: Array<{ uhs: string }> };
}

async function authenticateXboxLive(
  msAccessToken: string,
): Promise<{ token: string; userHash: string }> {
  const res = await fetch(XBOX_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${msAccessToken}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }),
  });

  if (!res.ok) {
    throw new Error(`Xbox Live auth failed (${res.status})`);
  }

  const data = (await res.json()) as XblResponse;
  return {
    token: data.Token,
    userHash: data.DisplayClaims.xui[0].uhs,
  };
}

// ── XSTS ───────────────────────────────────────────────────

async function authenticateXsts(xblToken: string): Promise<string> {
  const res = await fetch(XSTS_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      Properties: {
        SandboxId: 'RETAIL',
        UserTokens: [xblToken],
      },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const xerr = body.XErr as number | undefined;
    if (xerr === 2148916233) {
      throw new Error('This Microsoft account has no Xbox account. Please create one at xbox.com');
    }
    if (xerr === 2148916238) {
      throw new Error(
        'This account belongs to a minor and requires a parent to add it to a Family',
      );
    }
    throw new Error(`XSTS auth failed (${res.status}): XErr=${xerr}`);
  }

  const data = (await res.json()) as { Token: string };
  return data.Token;
}

// ── Minecraft Services ─────────────────────────────────────

interface McAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

async function authenticateMinecraft(xstsToken: string, userHash: string): Promise<McAuthResponse> {
  const res = await fetch(MC_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identityToken: `XBL3.0 x=${userHash};${xstsToken}`,
    }),
  });

  if (!res.ok) {
    throw new Error(`Minecraft auth failed (${res.status})`);
  }

  return res.json() as Promise<McAuthResponse>;
}

interface McProfile {
  id: string;
  name: string;
  skins?: Array<{ url: string }>;
}

async function getMinecraftProfile(mcAccessToken: string): Promise<McProfile> {
  const res = await fetch(MC_PROFILE_URL, {
    headers: { Authorization: `Bearer ${mcAccessToken}` },
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('This account does not own Minecraft: Java Edition');
    }
    throw new Error(`Failed to get MC profile (${res.status})`);
  }

  return res.json() as Promise<McProfile>;
}

// ── Auth broadcast to renderer ─────────────────────────────

function pushAuthState(): void {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  getStoredAuthState().then((state) => {
    win.webContents.send('auth:state-changed', state);
  });
}

async function fullMicrosoftAuthChain(
  msAccessToken: string,
  msRefreshToken: string,
): Promise<MinecraftAccount> {
  log.info('Auth chain: Xbox Live...');
  const xbl = await authenticateXboxLive(msAccessToken);

  log.info('Auth chain: XSTS...');
  const xstsToken = await authenticateXsts(xbl.token);

  log.info('Auth chain: Minecraft Services...');
  const mcAuth = await authenticateMinecraft(xstsToken, xbl.userHash);

  log.info('Auth chain: Fetching MC profile...');
  const profile = await getMinecraftProfile(mcAuth.access_token);

  const account: MinecraftAccount = {
    id: profile.id,
    uuid: profile.id,
    username: profile.name,
    type: 'microsoft',
    skinUrl: profile.skins?.[0]?.url,
    lastAuthenticated: new Date().toISOString(),
  };

  await saveAccount(account, msRefreshToken, {
    accessToken: mcAuth.access_token,
    expiresAt: Date.now() + mcAuth.expires_in * 1000,
  });
  log.info(`Authenticated Microsoft account: ${account.username}`);
  return account;
}

// ── Exported API (matches ipc-handlers imports) ────────────

export async function loginMicrosoft(): Promise<MinecraftAccount> {
  if (MS_CLIENT_ID === MS_CLIENT_ID_PLACEHOLDER) {
    throw new Error(
      'Microsoft login is not configured — this build has no Azure client ID. ' +
        'Use offline mode, or set RAVENFORGE_CLIENT_ID (see docs/AZURE-SETUP.md).',
    );
  }

  log.info('Starting Microsoft OAuth flow...');
  const code = await getMsAuthCode();
  const tokens = await exchangeMsCodeForTokens(code);
  const account = await fullMicrosoftAuthChain(tokens.access_token, tokens.refresh_token);
  pushAuthState();
  return account;
}

export async function loginOffline(username: string): Promise<MinecraftAccount> {
  if (!username || username.length < 1 || username.length > 16) {
    throw new Error('Username must be 1–16 characters');
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    throw new Error('Username can only contain letters, numbers, and underscores');
  }

  const account: MinecraftAccount = {
    id: `offline-${crypto.randomUUID()}`,
    uuid: offlineUuid(username),
    username,
    type: 'offline',
    lastAuthenticated: new Date().toISOString(),
  };

  // Must complete before returning: the renderer re-reads auth state the moment
  // this resolves, and a fire-and-forget save loses that race — the account is
  // on disk but the account list still says "no accounts".
  await saveAccount(account);
  pushAuthState();
  log.info(`Created offline account: ${account.username}`);
  return account;
}

export async function logoutAccount(accountId: string): Promise<void> {
  await removeAccount(accountId);
  pushAuthState();
  log.info(`Logged out account: ${accountId}`);
}

export async function getAuthState(): Promise<AuthState> {
  return getStoredAuthState();
}

export async function setActiveAccount(accountId: string): Promise<void> {
  await setActiveAccountId(accountId);
  pushAuthState();
}

export async function refreshAccount(accountId: string): Promise<MinecraftAccount> {
  const existing = await getAccount(accountId);
  if (!existing) throw new Error(`Account ${accountId} not found`);

  if (existing.type === 'offline') {
    return existing;
  }

  const refreshToken = await getRefreshToken(accountId);
  if (!refreshToken) {
    throw new Error('No refresh token available — please log in again');
  }

  log.info(`Refreshing tokens for account: ${existing.username}`);
  const tokens = await refreshMsTokens(refreshToken);
  const account = await fullMicrosoftAuthChain(tokens.access_token, tokens.refresh_token);
  pushAuthState();
  return account;
}

/** Refresh a little early so a token can't expire between this check and launch. */
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/**
 * Return a currently-valid Minecraft session token for an account, silently
 * re-running the auth chain when the stored one is expired or nearly so.
 *
 * Throws if the MSA refresh token is also dead — the user has to log in again.
 */
export async function getMinecraftAccessToken(accountId: string): Promise<string> {
  const session = await getMcSession(accountId);
  if (session && session.expiresAt - TOKEN_EXPIRY_MARGIN_MS > Date.now()) {
    return session.accessToken;
  }

  log.info(`Minecraft session for ${accountId} expired or missing — refreshing...`);
  try {
    await refreshAccount(accountId);
  } catch (err) {
    // "Cannot reach the servers" and "the servers rejected us" both surface as a
    // rejected fetch, but only one of them is fixed by logging in again.
    if (isNetworkFailure(err)) {
      log.warn(`Auth servers unreachable while refreshing ${accountId}:`, err);
      throw new AuthServersUnreachableError(err);
    }
    log.error(`Silent token refresh failed for ${accountId}:`, err);
    throw new Error('Session expired — please log in again');
  }

  const refreshed = await getMcSession(accountId);
  if (!refreshed) throw new Error('Session expired — please log in again');
  return refreshed.accessToken;
}
