import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listCataloguePacks } from '../src/core/packs/catalogue';

/** The catalogue as raven-packs actually publishes it. */
function entry(over: Record<string, unknown> = {}) {
  return {
    slug: 'ravenmc',
    name: 'Raven MC',
    version: '1.0.0',
    summary: 'Performance and quality-of-life pack.',
    minecraft: '26.2',
    loader: { type: 'fabric', version: '0.19.3' },
    recommendedRamMb: 4096,
    server: { ip: 'mc.example.net', port: 25565 },
    counts: { mods: 25, resourcePacks: 0, shaders: 0, client: 25, server: 6 },
    totalDownloadBytes: 30472224,
    builtAt: '2026-08-05T11:33:30.874Z',
    manifestUrl: 'https://whiteravens20.github.io/raven-packs/ravenmc/manifest.json',
    mrpackUrl: 'https://whiteravens20.github.io/raven-packs/ravenmc/ravenmc-1.0.0.mrpack',
    ...over,
  };
}

function respondWith(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      statusText: ok ? 'OK' : 'Not Found',
      json: () => Promise.resolve(body),
    }),
  );
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('listCataloguePacks', () => {
  it('maps a published catalogue into what the picker needs', async () => {
    respondWith({ indexVersion: 1, packs: [entry()] });

    const [pack] = await listCataloguePacks();

    expect(pack).toEqual({
      slug: 'ravenmc',
      name: 'Raven MC',
      version: '1.0.0',
      summary: 'Performance and quality-of-life pack.',
      minecraftVersion: '26.2',
      modLoader: 'fabric',
      recommendedRamMb: 4096,
      serverIp: 'mc.example.net',
      modCount: 25,
      totalDownloadBytes: 30472224,
      manifestUrl: 'https://whiteravens20.github.io/raven-packs/ravenmc/manifest.json',
    });
  });

  it('drops packs with no manifest URL rather than offering a dead button', async () => {
    // raven-packs writes null URLs when it is built without PACK_BASE_URL. A
    // profile created from one would fail on its first sync, so it never gets
    // listed as something to click.
    respondWith({ indexVersion: 1, packs: [entry({ manifestUrl: null }), entry({ slug: 'ok' })] });

    expect((await listCataloguePacks()).map((p) => p.slug)).toEqual(['ok']);
  });

  it('survives a catalogue that omits the optional fields', async () => {
    respondWith({
      indexVersion: 1,
      packs: [
        {
          slug: 'bare',
          name: 'Bare',
          version: '0.1.0',
          minecraft: '1.21.4',
          loader: { type: 'fabric' },
          manifestUrl: 'https://example.test/bare/manifest.json',
        },
      ],
    });

    const [pack] = await listCataloguePacks();
    expect(pack.summary).toBe('');
    expect(pack.modCount).toBe(0);
    expect(pack.serverIp).toBeUndefined();
  });

  it('refuses a catalogue whose shape it does not recognise', async () => {
    // The entries become manifest URLs profiles are created from, so a body
    // that is not the agreed shape is not something to guess at.
    respondWith({ indexVersion: 2, packs: [] });
    await expect(listCataloguePacks()).rejects.toThrow(/malformed/);
  });

  it('says what the server answered when the list is missing', async () => {
    respondWith(null, false, 404);
    await expect(listCataloguePacks()).rejects.toThrow(/404 Not Found/);
  });
});
