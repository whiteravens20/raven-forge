// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

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

/**
 * The Node half of a proxy address. Throws when the address cannot be one.
 *
 * SOCKS is a different protocol on the socket, not a different HTTP verb, so it
 * needs its own dispatcher — ProxyAgent would send `CONNECT` at a server that
 * has no idea what that is.
 */
function dispatcherFor(url: string): Dispatcher {
  return isSocksProxy(url) ? createSocksDispatcher(url) : new ProxyAgent(url);
}

/**
 * Refuse a proxy address that could not be put to use — asked before it is
 * saved.
 *
 * Passing the schema is not enough to know. `http://user:50%off@host:8080` is a
 * URL as far as `new URL` goes and is not one a proxy can be built from, and it
 * used to be written to the settings file first and found out second: the
 * change was reported as failed, the file kept the address, and every start
 * from then on logged that it could not initialise and went direct.
 */
export async function assertProxyUsable(proxyUrl: string | undefined): Promise<void> {
  const url = proxyUrl?.trim();
  if (!url) return;
  let trial: Dispatcher;
  try {
    trial = dispatcherFor(url);
  } catch (err) {
    // The message only: the address itself may hold a password.
    throw new Error(
      `That proxy address cannot be used: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  await trial.close();
}

export async function applyProxySettings(settings: GlobalSettings): Promise<void> {
  const url = settings.proxyUrl?.trim() || undefined;
  if (url === appliedUrl) return;

  if (!url) {
    setGlobalDispatcher(directDispatcher);
    await session.defaultSession.setProxy({ mode: 'direct' });
    appliedUrl = url;
    log.info('Proxy cleared — requests go direct.');
    return;
  }

  // Everything that can refuse the address happens before anything is switched
  // over, and the address counts as applied only once both stacks have it. It
  // used to be recorded first: an address that then failed was never tried
  // again, and the next change of any other setting reported it as in use.
  const parsed = new URL(url);
  const dispatcher = dispatcherFor(url);

  // Chromium wants host:port with a scheme prefix, not a full URL. Credentials
  // in the URL are honoured by undici but would be ignored here, so they are
  // dropped rather than silently half-applied.
  await session.defaultSession.setProxy({
    proxyRules: `${parsed.protocol}//${parsed.host}`,
    proxyBypassRules: '<local>',
  });
  setGlobalDispatcher(dispatcher);
  appliedUrl = url;

  // Never log the URL itself — it may carry credentials.
  log.info(
    `Proxy enabled for all downloads (${parsed.protocol}//${parsed.hostname})${
      isSocksProxy(url) ? ' — SOCKS, DNS resolved at the proxy' : ''
    }.`,
  );
}
