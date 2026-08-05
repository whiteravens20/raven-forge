import { describe, it, expect } from 'vitest';
import { shaderLoaderCandidates } from '../src/core/mods/shader-loader';
import { CLIENT_MOD_LOADERS, isClientModLoader } from '../src/shared/constants';
import type { ModLoaderType } from '../src/shared/ipc-types';

/**
 * Which shader loader a mod loader can run.
 *
 * The costly mistake is a false *yes*: installing Oculus on Fabric adds a mod
 * that cannot load, and the shader pack still will not render — but the launcher
 * will have said it fixed the problem. A false *no* only means installing by
 * hand, which is what the situation was before.
 */
describe('shaderLoaderCandidates', () => {
  const names = (loader: ModLoaderType) => shaderLoaderCandidates(loader).map((c) => c.name);

  it('offers Iris on Fabric and Quilt, and nothing else', () => {
    expect(names('fabric')).toEqual(['Iris Shaders']);
    expect(names('quilt')).toEqual(['Iris Shaders']);
  });

  it('offers both on NeoForge, Iris first', () => {
    // Iris gained NeoForge support partway through 1.21 and Oculus stopped at
    // 1.20.1, so which one is actually installable depends on the Minecraft
    // version — that call belongs to Modrinth, not to this list.
    expect(names('neoforge')).toEqual(['Iris Shaders', 'Oculus']);
  });

  it('offers only Oculus on Forge — Iris publishes no Forge build', () => {
    expect(names('forge')).toEqual(['Oculus']);
  });

  it('offers nothing for vanilla', () => {
    expect(shaderLoaderCandidates('vanilla')).toEqual([]);
  });

  it('never offers Oculus where Iris is the only thing that loads', () => {
    for (const loader of ['fabric', 'quilt'] as const) {
      expect(names(loader)).not.toContain('Oculus');
    }
  });

  it('gives every loader-carrying profile type an answer', () => {
    // A loader added to ModLoaderType without a branch here would silently fall
    // through to "unsupported" and shaders would quietly never work on it.
    for (const loader of CLIENT_MOD_LOADERS) {
      expect(shaderLoaderCandidates(loader).length, loader).toBeGreaterThan(0);
    }
  });

  it('puts Iris ahead of Oculus wherever both can run', () => {
    // Order is the recommendation. Iris is maintained against current
    // Minecraft; Oculus stopped at 1.20.1 and is the fallback, not the default.
    const both = names('neoforge');
    expect(both.indexOf('Iris Shaders')).toBeLessThan(both.indexOf('Oculus'));
  });
});

describe('isClientModLoader', () => {
  it.each(['fabric', 'forge', 'neoforge', 'quilt'])('accepts %s', (l) =>
    expect(isClientModLoader(l)).toBe(true),
  );

  it.each(['bukkit', 'paper', 'velocity', 'bungeecord', 'sponge', 'liteloader'])(
    'rejects %s — a launcher starts a client',
    (l) => expect(isClientModLoader(l)).toBe(false),
  );

  it('rejects vanilla, which is not a mod loader anyone searches by', () => {
    expect(isClientModLoader('vanilla')).toBe(false);
  });
});
