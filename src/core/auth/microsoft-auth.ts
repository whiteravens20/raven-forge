import { BrowserWindow, session } from 'electron';
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

/**
 * PKCE parameters for one authorization attempt (RFC 7636).
 *
 * This is a native public client: it ships with no secret, so possession of an
 * authorization code is otherwise all anyone needs to redeem it. The challenge
 * binds the code to this attempt, so a code intercepted anywhere between the
 * browser window and here is useless without the verifier, which never leaves
 * the process. Microsoft asks for exactly this on clients of this shape.
 */
function createPkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
  };
}

/**
 * Whether a URL is the redirect this flow is waiting for.
 *
 * Compared as origin plus path rather than by looking for a `code` parameter on
 * whatever the window happens to navigate to. Any hop in an authorization chain
 * may carry a `?code=`, and treating the first one seen as the authorization
 * response means accepting a code the launcher never asked for.
 */
function isAuthRedirect(url: string): boolean {
  try {
    const parsed = new URL(url);
    const expected = new URL(MS_REDIRECT_URI);
    return parsed.origin === expected.origin && parsed.pathname === expected.pathname;
  } catch {
    return false;
  }
}

async function getMsAuthCode(): Promise<{ code: string; verifier: string }> {
  const { verifier, challenge } = createPkce();
  // Binds the response to this request, so a code arriving from anywhere else
  // is recognisable as one.
  const state = crypto.randomBytes(16).toString('base64url');

  return new Promise((resolve, reject) => {
    const authWindow = new BrowserWindow({
      width: 520,
      height: 700,
      show: true,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // This is the only window in the launcher that loads someone else's
        // page, which makes it the one that most needs the renderer locked down.
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });

    // A login page has no business opening one.
    authWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    const authUrl = new URL(`${MS_AUTH_BASE}/authorize`);
    authUrl.searchParams.set('client_id', MS_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', MS_REDIRECT_URI);
    authUrl.searchParams.set('scope', MS_SCOPES);
    authUrl.searchParams.set('prompt', 'select_account');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    void authWindow.loadURL(authUrl.toString());

    const settle = (fn: () => void) => {
      authWindow.close();
      fn();
    };

    // Both events, because whether the redirect arrives as a redirect or as a
    // navigation is Microsoft's choice and has changed before.
    const onNavigate = (_event: Electron.Event, url: string) => {
      if (!isAuthRedirect(url)) return;

      const parsed = new URL(url);
      const error = parsed.searchParams.get('error');
      if (error) {
        settle(() =>
          reject(
            new Error(`MS Auth error: ${error} — ${parsed.searchParams.get('error_description')}`),
          ),
        );
        return;
      }

      if (parsed.searchParams.get('state') !== state) {
        settle(() => reject(new Error('Authorization response did not match the request')));
        return;
      }

      const code = parsed.searchParams.get('code');
      if (!code) {
        settle(() => reject(new Error('Authorization response carried no code')));
        return;
      }
      settle(() => resolve({ code, verifier }));
    };

    authWindow.webContents.on('will-redirect', onNavigate);
    authWindow.webContents.on('will-navigate', onNavigate);

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

async function exchangeMsCodeForTokens(code: string, verifier: string): Promise<MsTokenResponse> {
  const body = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    code,
    grant_type: 'authorization_code',
    redirect_uri: MS_REDIRECT_URI,
    scope: MS_SCOPES,
    code_verifier: verifier,
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
  skins?: Array<{ url: string; state?: string }>;
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

/**
 * The skin the player is currently wearing, as a URL the renderer can load.
 *
 * Two corrections to what the profile endpoint hands back.
 *
 * The `skins` array lists what the account has uploaded and marks one `ACTIVE`;
 * the worn skin is not reliably first, so taking `[0]` can show a texture the
 * player replaced long ago.
 *
 * And the `url` comes back as plain `http://textures.minecraft.net/...` — has
 * done for years. The renderer's policy is `img-src 'self' data: https:`
 * (`src/main/security.ts`), so the browser refused to load it and the account
 * showed a broken image. The same host serves the same texture over TLS, so
 * upgrading the scheme is the whole fix; widening the policy to `http:` to
 * accommodate one URL would be trading the app's transport guarantees for a
 * 40px picture.
 */
export function activeSkinUrl(profile: McProfile): string | undefined {
  const skins = profile.skins ?? [];
  const skin = skins.find((s) => s.state === 'ACTIVE') ?? skins[0];
  return skin?.url.replace(/^http:\/\//i, 'https://');
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
    skinUrl: activeSkinUrl(profile),
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
  const { code, verifier } = await getMsAuthCode();
  const tokens = await exchangeMsCodeForTokens(code, verifier);
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

/**
 * Forget the sign-in window's cookies.
 *
 * The authorization window shares the launcher's session — it has to, or the
 * proxy set in Settings would not apply to it — so Microsoft's cookies outlive
 * the account unless something removes them. A "log out" after which the next
 * sign-in already knows who you are has not logged anybody out.
 *
 * Clearing the whole cookie jar rather than a list of Microsoft domains: the
 * launcher's own page is a `file://` document and sets no cookies of its own,
 * so everything in here was set by a page this flow loaded. A domain list would
 * be a thing to keep correct as Microsoft moves hosts around, and being wrong
 * about it would fail silently, in the direction of leaving the session behind.
 *
 * Never throws. Logging out must succeed even where this cannot.
 */
async function clearSignInCookies(): Promise<void> {
  try {
    await session.defaultSession.clearStorageData({ storages: ['cookies'] });
    log.info('Cleared the sign-in window cookies');
  } catch (err) {
    log.warn('Could not clear the sign-in window cookies:', err);
  }
}

export async function logoutAccount(accountId: string): Promise<void> {
  // Read before removing — afterwards there is nothing left to ask what it was.
  const account = await getAccount(accountId);
  await removeAccount(accountId);

  // An offline account never opened that window, so there is nothing of its to
  // clear, and wiping the jar would only sign out the Microsoft accounts that
  // are still here.
  if (account?.type === 'microsoft') {
    await clearSignInCookies();
  }

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
    throw new Error('Session expired — please log in again', { cause: err });
  }

  const refreshed = await getMcSession(accountId);
  if (!refreshed) throw new Error('Session expired — please log in again');
  return refreshed.accessToken;
}
