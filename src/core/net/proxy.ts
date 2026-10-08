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
/** The dispatcher made for `appliedUrl`, to be closed once it is replaced. */
let appliedDispatcher: Dispatcher | undefined;

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
 * How Chromium spells each scheme the setting accepts. It knows `socks4` and
 * `socks5` and takes neither `socks5h` nor `socks4a`, which were being handed to
 * it as typed: a rule it could not read, so the sign-in window and every remote
 * image went wherever Chromium went with no rule at all.
 */
const CHROMIUM_SCHEME: Record<string, string> = {
  'http:': 'http',
  'https:': 'https',
  'socks:': 'socks5',
  'socks5:': 'socks5',
  'socks5h:': 'socks5',
  'socks4:': 'socks4',
  'socks4a:': 'socks4',
};

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

/**
 * The name and password to answer the configured proxy with, when Chromium is
 * asked for them — or nothing, for any other proxy and for an address that has
 * none in it.
 *
 * undici reads them out of the address itself. Chromium takes a host and a port
 * and then asks, and with nobody answering, a proxy that wants a password worked
 * for every download and for neither the sign-in window nor a single image.
 */
export function proxyCredentialsFor(
  host: string,
  port: number,
): { username: string; password: string } | undefined {
  if (!appliedUrl) return undefined;
  const proxy = new URL(appliedUrl);
  if (!proxy.username || proxy.hostname !== host) return undefined;
  const proxyPort = Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80);
  if (proxyPort !== port) return undefined;
  return {
    username: decodeURIComponent(proxy.username),
    password: decodeURIComponent(proxy.password),
  };
}

export async function applyProxySettings(settings: GlobalSettings): Promise<void> {
  const url = settings.proxyUrl?.trim() || undefined;
  if (url === appliedUrl) return;

  // Everything that can refuse the address happens before anything is switched
  // over, and the address counts as applied only once both stacks have it. It
  // used to be recorded first: an address that then failed was never tried
  // again, and the next change of any other setting reported it as in use.
  const parsed = url ? new URL(url) : undefined;
  const dispatcher = url ? dispatcherFor(url) : directDispatcher;

  // Chromium wants host:port with a scheme prefix, not a full URL; what the
  // address says about who is asking is given when the proxy asks for it. With
  // no proxy it goes back to following the system's settings, which is where it
  // starts — not to "direct", which it was never on before a proxy was set.
  await session.defaultSession.setProxy(
    parsed
      ? {
          proxyRules: `${CHROMIUM_SCHEME[parsed.protocol] ?? parsed.protocol.slice(0, -1)}://${parsed.host}`,
          proxyBypassRules: '<local>',
        }
      : { mode: 'system' },
  );
  setGlobalDispatcher(dispatcher);

  const replaced = appliedDispatcher;
  appliedDispatcher = url ? dispatcher : undefined;
  appliedUrl = url;

  // Connections opened under the old setting would go on being reused under the
  // new one.
  await session.defaultSession.closeAllConnections();
  void replaced?.close().catch(() => undefined);

  // Never log the URL itself — it may carry credentials.
  log.info(
    parsed
      ? `Proxy enabled for all downloads (${parsed.protocol}//${parsed.hostname})${
          isSocksProxy(url!) ? ' — SOCKS, DNS resolved at the proxy' : ''
        }.`
      : 'Proxy cleared — requests go direct.',
  );
}
