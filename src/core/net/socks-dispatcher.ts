import { Agent, buildConnector, type Dispatcher } from 'undici';
import { SocksClient } from 'socks';

/**
 * A SOCKS dispatcher for undici.
 *
 * `ProxyAgent` cannot do this. It speaks HTTP `CONNECT`, which a SOCKS proxy
 * does not understand, so a `socks5://` URL handed to it fails at the first
 * request rather than being rejected up front. SOCKS is a different protocol
 * that must be spoken on the raw socket *before* any HTTP exists, which is
 * exactly what undici's `connect` hook is for: hand it a socket that is already
 * talking to the destination and undici does not care how it got there.
 */

/** SOCKS versions the `socks` client understands, keyed by URL scheme. */
const SCHEME_TO_TYPE: Record<string, 4 | 5> = {
  'socks4:': 4,
  'socks4a:': 4,
  'socks5:': 5,
  'socks5h:': 5,
  'socks:': 5,
};

export function isSocksProxy(url: string): boolean {
  try {
    return new URL(url).protocol in SCHEME_TO_TYPE;
  } catch {
    return false;
  }
}

/**
 * Build a dispatcher that opens every connection through a SOCKS proxy.
 *
 * TLS is layered on afterwards rather than by the proxy: the SOCKS server gives
 * us a plain tunnel to the origin, and for `https:` undici's own TLS connector
 * then completes the handshake **over** that tunnel. Skipping that step would
 * send plaintext down a socket the caller believes is encrypted.
 *
 * The hostname is passed to the proxy unresolved, so DNS happens at the proxy —
 * the `socks5h` behaviour, and the one that matters for privacy. Resolving
 * locally would leak every host being visited to the local resolver, which is
 * usually the thing a proxy was chosen to avoid.
 */
export function createSocksDispatcher(proxyUrl: string): Dispatcher {
  const parsed = new URL(proxyUrl);
  const type = SCHEME_TO_TYPE[parsed.protocol];
  if (!type) throw new Error(`Not a SOCKS proxy URL: ${parsed.protocol}`);

  const proxy = {
    host: parsed.hostname,
    port: Number(parsed.port) || 1080,
    type,
    ...(parsed.username ? { userId: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
  };

  const tlsConnect = buildConnector({});

  const connect: buildConnector.connector = (options, callback) => {
    const port = Number(options.port) || (options.protocol === 'https:' ? 443 : 80);

    SocksClient.createConnection({
      proxy,
      command: 'connect',
      destination: { host: options.hostname, port },
    })
      .then(({ socket }) => {
        if (options.protocol !== 'https:') {
          callback(null, socket.setNoDelay());
          return;
        }
        // `httpSocket` tells undici's TLS connector to wrap this socket rather
        // than dial a new one.
        tlsConnect({ ...options, httpSocket: socket }, callback);
      })
      .catch((err: unknown) => {
        callback(err instanceof Error ? err : new Error(String(err)), null);
      });
  };

  return new Agent({ connect });
}
