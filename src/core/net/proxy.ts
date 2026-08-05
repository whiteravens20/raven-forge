import { ProxyAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { createSocksDispatcher, isSocksProxy } from './socks-dispatcher';
import { session } from 'electron';
import { log } from '../../main/logger';
import type { GlobalSettings } from '../../shared/ipc-types';

/**
 * Route every outbound request through the configured proxy.
 *
 * There are two independent network stacks in an Electron app and the setting
 * has to reach both:
 *
 *   - **Node** — every download in `src/core/` uses global `fetch`, which is
 *     undici. `setGlobalDispatcher` is the documented way to proxy it, and it
 *     works because undici stores the dispatcher on a well-known global symbol
 *     that Node's built-in fetch reads too.
 *   - **Chromium** — remote images in the renderer (news thumbnails, profile
 *     icons by URL) never touch Node. Those go through the session.
 *
 * `NODE_USE_ENV_PROXY` is not usable here: Node reads it once at startup, so a
 * proxy configured in Settings would not take effect until the app restarted.
 * Verified — setting the variable at runtime does nothing.
 */

/** The dispatcher undici started with, kept so the proxy can be turned back off. */
const directDispatcher: Dispatcher = getGlobalDispatcher();

let appliedUrl: string | undefined;

export async function applyProxySettings(settings: GlobalSettings): Promise<void> {
  const url = settings.proxyUrl?.trim() || undefined;
  if (url === appliedUrl) return;
  appliedUrl = url;

  if (!url) {
    setGlobalDispatcher(directDispatcher);
    await session.defaultSession.setProxy({ mode: 'direct' });
    log.info('Proxy cleared — requests go direct.');
    return;
  }

  // SOCKS is a different protocol on the socket, not a different HTTP verb, so
  // it needs its own dispatcher — ProxyAgent would send `CONNECT` at a server
  // that has no idea what that is.
  const socks = isSocksProxy(url);
  setGlobalDispatcher(socks ? createSocksDispatcher(url) : new ProxyAgent(url));

  // Chromium wants host:port with a scheme prefix, not a full URL. Credentials
  // in the URL are honoured by undici but would be ignored here, so they are
  // dropped rather than silently half-applied.
  const parsed = new URL(url);
  await session.defaultSession.setProxy({
    proxyRules: `${parsed.protocol}//${parsed.host}`,
    proxyBypassRules: '<local>',
  });

  // Never log the URL itself — it may carry credentials.
  log.info(
    `Proxy enabled for all downloads (${parsed.protocol}//${parsed.hostname})${
      socks ? ' — SOCKS, DNS resolved at the proxy' : ''
    }.`,
  );
}
