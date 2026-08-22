import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GlobalSettings } from '../src/shared/ipc-types';

/**
 * Getting one proxy setting into two network stacks.
 *
 * An Electron app has two, and a proxy that reaches only one is worse than no
 * proxy at all: the downloads go through it and the renderer's remote images do
 * not, so the thing the user was hiding leaks out of the half nobody thought
 * about. Node's fetch is undici and takes a dispatcher; Chromium's is the
 * session and takes host:port.
 *
 * Credentials are the other half. undici honours them in the URL and Chromium
 * ignores them, so passing the whole URL through would half-apply a password
 * and log it besides.
 */

const setProxy = vi.fn(async (_config: { proxyRules: string }) => undefined);
const setGlobalDispatcher = vi.fn();
const socksDispatcher = { kind: 'socks' };
const proxyAgent = { kind: 'proxy-agent' };
const direct = { kind: 'direct' };
const logged: string[] = [];

vi.mock('electron', () => ({
  session: { defaultSession: { setProxy } },
  app: { getVersion: () => '0.0.0-test', getPath: () => '/tmp' },
}));
vi.mock('../src/main/logger', () => ({
  log: {
    info: (msg: string) => logged.push(msg),
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));
vi.mock('undici', () => ({
  getGlobalDispatcher: () => direct,
  setGlobalDispatcher,
  ProxyAgent: class {
    kind = 'proxy-agent';
    constructor(public url: string) {
      Object.assign(this, proxyAgent);
    }
  },
}));
vi.mock('../src/core/net/socks-dispatcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/net/socks-dispatcher')>();
  return { isSocksProxy: actual.isSocksProxy, createSocksDispatcher: () => socksDispatcher };
});

const settings = (proxyUrl?: string) => ({ proxyUrl }) as GlobalSettings;

let applyProxySettings: typeof import('../src/core/net/proxy').applyProxySettings;

beforeEach(async () => {
  setProxy.mockClear();
  setGlobalDispatcher.mockClear();
  logged.length = 0;
  vi.resetModules();
  ({ applyProxySettings } = await import('../src/core/net/proxy'));
});

describe('applyProxySettings', () => {
  it('points both stacks at an HTTP proxy', async () => {
    await applyProxySettings(settings('http://proxy.example.net:8080'));

    expect(setGlobalDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'proxy-agent' }),
    );
    expect(setProxy).toHaveBeenCalledWith({
      proxyRules: 'http://proxy.example.net:8080',
      proxyBypassRules: '<local>',
    });
  });

  it('uses a SOCKS dispatcher rather than sending CONNECT at a SOCKS server', async () => {
    await applyProxySettings(settings('socks5://127.0.0.1:9050'));
    expect(setGlobalDispatcher).toHaveBeenCalledWith(socksDispatcher);
    expect(setProxy).toHaveBeenCalledWith(
      expect.objectContaining({ proxyRules: 'socks5://127.0.0.1:9050' }),
    );
  });

  it('does not hand Chromium credentials it would ignore', async () => {
    await applyProxySettings(settings('http://user:hunter2@proxy.example.net:8080'));

    const rules = setProxy.mock.calls[0][0];
    expect(rules.proxyRules).toBe('http://proxy.example.net:8080');
    expect(rules.proxyRules).not.toContain('hunter2');
  });

  it('never writes the proxy URL to the log', async () => {
    await applyProxySettings(settings('http://user:hunter2@proxy.example.net:8080'));
    expect(logged.join('\n')).not.toContain('hunter2');
    expect(logged.join('\n')).not.toContain('user:');
  });

  it('puts both stacks back to direct when the proxy is cleared', async () => {
    await applyProxySettings(settings('http://proxy.example.net:8080'));
    setGlobalDispatcher.mockClear();
    setProxy.mockClear();

    await applyProxySettings(settings('   '));

    expect(setGlobalDispatcher).toHaveBeenCalledWith(direct);
    expect(setProxy).toHaveBeenCalledWith({ mode: 'direct' });
  });

  it('does nothing when the setting has not changed', async () => {
    await applyProxySettings(settings('http://proxy.example.net:8080'));
    setGlobalDispatcher.mockClear();
    setProxy.mockClear();

    await applyProxySettings(settings('http://proxy.example.net:8080'));

    expect(setGlobalDispatcher).not.toHaveBeenCalled();
    expect(setProxy).not.toHaveBeenCalled();
  });

  it('treats no proxy at all as nothing to apply', async () => {
    await applyProxySettings(settings(undefined));
    expect(setGlobalDispatcher).not.toHaveBeenCalled();
    expect(setProxy).not.toHaveBeenCalled();
  });
});
