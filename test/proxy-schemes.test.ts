import { describe, it, expect } from 'vitest';
import { isSocksProxy } from '../src/core/net/socks-dispatcher';
import { globalSettingsSchema, PROXY_SCHEMES } from '../src/shared/validators';
import { DEFAULT_SETTINGS } from '../src/core/config/defaults';

/**
 * Two rules have to agree, or a proxy is accepted by Settings and then never
 * used: the schema decides what can be *saved*, and `isSocksProxy` decides which
 * dispatcher a saved value gets. A scheme the schema allows but no dispatcher
 * handles is the silent-no-op this replaced.
 */
const settingsWith = (proxyUrl: string) =>
  globalSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, proxyUrl });

describe('isSocksProxy', () => {
  it.each([
    'socks://h:1080',
    'socks4://h:1080',
    'socks4a://h:1080',
    'socks5://h:1080',
    'socks5h://h:1080',
  ])('recognises %s', (url) => expect(isSocksProxy(url)).toBe(true));

  it.each(['http://h:8080', 'https://h:8080'])('does not claim %s', (url) =>
    expect(isSocksProxy(url)).toBe(false),
  );

  it('returns false rather than throwing on nonsense', () => {
    expect(isSocksProxy('not a url')).toBe(false);
    expect(isSocksProxy('')).toBe(false);
  });
});

describe('proxy scheme validation', () => {
  it.each(PROXY_SCHEMES)('accepts a %s URL', (scheme) => {
    expect(settingsWith(`${scheme}//proxy.example:1080`).success).toBe(true);
  });

  it('accepts an empty value as "no proxy"', () => {
    expect(settingsWith('').success).toBe(true);
  });

  it.each(['ftp://h:21', 'file:///etc/passwd', 'javascript:alert(1)', 'not-a-url', 'h:1080'])(
    'rejects %s',
    (url) => expect(settingsWith(url).success).toBe(false),
  );

  it('every accepted scheme has a dispatcher behind it', () => {
    // The invariant that keeps "saved" and "applied" the same thing: each
    // allowed scheme is either SOCKS (custom connector) or http/https
    // (undici's ProxyAgent). Adding one to PROXY_SCHEMES without wiring it
    // fails here rather than silently doing nothing at runtime.
    for (const scheme of PROXY_SCHEMES) {
      const url = `${scheme}//proxy.example:1080`;
      const handled = isSocksProxy(url) || scheme === 'http:' || scheme === 'https:';
      expect(handled, `${scheme} has no dispatcher`).toBe(true);
    }
  });
});
