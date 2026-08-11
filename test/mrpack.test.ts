import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ZipWriter } from './helpers/zip';
import { readMrpack, applyOverrides } from '../src/core/packs/mrpack';
import { mrpackToManifest } from '../src/core/packs/pack-installer';

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mrpack-test-'));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** An index with sensible defaults, so a test only states what it is about. */
function index(over: Record<string, unknown> = {}) {
  return {
    formatVersion: 1,
    game: 'minecraft',
    versionId: '1.0.0',
    name: 'Test Pack',
    files: [],
    dependencies: { minecraft: '1.21.4', 'fabric-loader': '0.16.9' },
    ...over,
  };
}

function file(over: Record<string, unknown> = {}) {
  return {
    path: 'mods/example.jar',
    hashes: { sha1: 'a'.repeat(40), sha512: 'b'.repeat(128) },
    env: { client: 'required', server: 'required' },
    downloads: ['https://cdn.modrinth.com/example.jar'],
    fileSize: 1024,
    ...over,
  };
}

/** Write a `.mrpack` to disk and hand back its path. */
async function pack(
  name: string,
  contents: Record<string, unknown> | null,
  extra: Record<string, string> = {},
): Promise<string> {
  const zip = new ZipWriter();
  if (contents) zip.add('modrinth.index.json', JSON.stringify(contents));
  for (const [entry, body] of Object.entries(extra)) zip.add(entry, body);
  const file = path.join(dir, `${name}.mrpack`);
  await fs.writeFile(file, zip.toBuffer());
  return file;
}

describe('readMrpack', () => {
  it('reads the pack, its Minecraft version and its loader', async () => {
    const result = await readMrpack(await pack('basic', index({ files: [file()] })));

    expect(result.name).toBe('Test Pack');
    expect(result.minecraftVersion).toBe('1.21.4');
    // The format states the loader as a dependency key beside `minecraft`.
    expect(result.modLoader).toBe('fabric');
    expect(result.modLoaderVersion).toBe('0.16.9');
    expect(result.totalBytes).toBe(1024);
  });

  it('calls a pack with no loader dependency vanilla', async () => {
    const result = await readMrpack(
      await pack('vanilla', index({ dependencies: { minecraft: '1.21.4' } })),
    );
    expect(result.modLoader).toBe('vanilla');
  });

  it('drops files the client cannot use', async () => {
    // A server-only mod in a client profile is a jar that either does nothing
    // or refuses to load. This is a client launcher.
    const contents = index({
      files: [
        file({ path: 'mods/client.jar' }),
        file({ path: 'mods/server.jar', env: { client: 'unsupported', server: 'required' } }),
      ],
    });
    const result = await readMrpack(await pack('sides', contents));

    expect(result.files.map((f) => f.path)).toEqual(['mods/client.jar']);
  });

  it('refuses a pack whose file path escapes the game directory', async () => {
    // The index is as untrusted as the zip around it — a downloaded pack that
    // names `../../.ssh/authorized_keys` is not merely malformed.
    const contents = index({ files: [file({ path: '../../evil.jar' })] });

    await expect(readMrpack(await pack('escape', contents))).rejects.toThrow(
      /outside the game directory/,
    );
  });

  it('refuses an override that escapes the game directory', async () => {
    // yauzl rejects a traversing *entry name* before this module sees it, so
    // this asserts the property rather than the wording. The launcher's own
    // guard is what covers the index, whose paths live inside JSON and never
    // pass through the zip reader's validation at all.
    await expect(
      readMrpack(await pack('escape-override', index(), { 'overrides/../../evil.txt': 'x' })),
    ).rejects.toThrow();
  });

  it('refuses a traversing path rather than quietly trimming it', async () => {
    // The failure this guards against is not an escape but a silent relocation:
    // stripping the `../` and installing `evil.jar` at the top of the profile
    // looks like a successful install of a file nobody asked for.
    const contents = index({ files: [file({ path: 'mods/../../evil.jar' })] });

    await expect(readMrpack(await pack('trim', contents))).rejects.toThrow(
      /outside the game directory/,
    );
  });

  it('lets client-overrides win over overrides for the same path', async () => {
    const result = await readMrpack(
      await pack('overrides', index(), {
        'overrides/options.txt': 'shared',
        'client-overrides/options.txt': 'client',
      }),
    );
    expect(result.overrides.get('options.txt')?.toString()).toBe('client');
  });

  it('rejects a zip that is not a Modrinth pack', async () => {
    await expect(readMrpack(await pack('empty', null, { 'readme.txt': 'hi' }))).rejects.toThrow(
      /modrinth.index.json is missing/,
    );
  });

  it('rejects an index it cannot trust the shape of', async () => {
    const contents = index({ files: [{ path: 'mods/x.jar' }] }); // no downloads
    await expect(readMrpack(await pack('malformed', contents))).rejects.toThrow(/malformed/);
  });

  it('refuses a single entry that decompresses past the per-entry cap', async () => {
    // A deflate bomb ships as a tiny zip whose one entry inflates to gigabytes.
    // The declared size is checked before a byte is read; here a 64-byte override
    // against a 16-byte cap stands in for that, so the test costs nothing.
    const p = await pack('entry-bomb', index(), { 'overrides/big.bin': 'x'.repeat(64) });
    await expect(readMrpack(p, { maxEntryBytes: 16, maxTotalBytes: 1024 })).rejects.toThrow(
      /implausibly large/,
    );
  });

  it('refuses a pack whose entries total past the cap', async () => {
    // Each entry is under the per-entry cap; together they cross the total, which
    // is what a pack of a thousand merely-large files would do.
    const p = await pack('total-bomb', index(), {
      'overrides/a.txt': 'x'.repeat(40),
      'overrides/b.txt': 'y'.repeat(40),
    });
    await expect(readMrpack(p, { maxEntryBytes: 1024, maxTotalBytes: 50 })).rejects.toThrow(
      /larger decompressed/,
    );
  });
});

describe('applyOverrides', () => {
  it('writes an ordinary override into the game directory', async () => {
    const gameDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-overrides-'));
    await applyOverrides(gameDir, new Map([['config/opts.txt', Buffer.from('ok')]]));
    expect(await fs.readFile(path.join(gameDir, 'config/opts.txt'), 'utf-8')).toBe('ok');
    await fs.rm(gameDir, { recursive: true, force: true });
  });

  it('refuses to follow a symlinked directory out of the game directory', async () => {
    const gameDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-overrides-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-outside-'));
    // A previous pack, or the player, left a symlinked subdir pointing away.
    await fs.symlink(outside, path.join(gameDir, 'config'));

    await expect(
      applyOverrides(gameDir, new Map([['config/evil.txt', Buffer.from('x')]])),
    ).rejects.toThrow(/symlink|outside/);
    // Nothing was written through the link.
    await expect(fs.readFile(path.join(outside, 'evil.txt'))).rejects.toThrow();

    await fs.rm(gameDir, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('refuses a symlinked file sitting where an override would be written', async () => {
    const gameDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-overrides-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-outside-'));
    const target = path.join(outside, 'target.txt');
    await fs.writeFile(target, 'original');
    await fs.symlink(target, path.join(gameDir, 'options.txt'));

    await expect(
      applyOverrides(gameDir, new Map([['options.txt', Buffer.from('overwritten')]])),
    ).rejects.toThrow();
    // The file the link pointed at is untouched — O_NOFOLLOW refused to open it.
    expect(await fs.readFile(target, 'utf-8')).toBe('original');

    await fs.rm(gameDir, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });
});

describe('mrpackToManifest', () => {
  it('files each entry by the directory the pack puts it in', async () => {
    const contents = index({
      files: [
        file({ path: 'mods/sodium.jar' }),
        file({ path: 'resourcepacks/faithless.zip' }),
        file({ path: 'shaderpacks/bsl.zip' }),
        file({ path: 'config/sodium-options.json' }),
      ],
    });
    const manifest = mrpackToManifest(await readMrpack(await pack('sorted', contents)));

    expect(manifest.mods.map((m) => m.fileName)).toEqual(['sodium.jar']);
    expect(manifest.resourcePacks.map((r) => r.fileName)).toEqual(['faithless.zip']);
    expect(manifest.shaders.map((s) => s.fileName)).toEqual(['bsl.zip']);
    // Anything else keeps its exact path. Packs put real behaviour in `config/`,
    // and a pack that installs without it does not behave like the pack.
    expect(manifest.configFiles.map((c) => c.path)).toEqual(['config/sodium-options.json']);
  });

  it('keys a Modrinth download by its project, so the mod list can recognise it', async () => {
    const contents = index({
      files: [
        file({
          path: 'mods/sodium.jar',
          downloads: ['https://cdn.modrinth.com/data/AANobbMI/versions/abc123/sodium.jar'],
        }),
      ],
    });
    const manifest = mrpackToManifest(await readMrpack(await pack('project-id', contents)));

    // The same id the mod search returns — without it, browsing offers a mod
    // the pack already installed and a second jar lands beside the first.
    expect(manifest.mods[0].id).toBe('AANobbMI');
  });

  it('falls back to the file hash when the download names no project', async () => {
    const contents = index({
      files: [file({ downloads: ['https://example.com/mirror/sodium.jar'] })],
    });
    const manifest = mrpackToManifest(await readMrpack(await pack('hash-id', contents)));

    expect(manifest.mods[0].id).toBe('b'.repeat(32));
  });

  it('carries sha512 across, which is the hash both formats share', async () => {
    const contents = index({ files: [file()] });
    const manifest = mrpackToManifest(await readMrpack(await pack('hashes', contents)));

    // The manifest schema knows sha256/sha512; an .mrpack publishes sha1/sha512.
    // Losing the hash would mean installing a pack's jars unverified.
    expect(manifest.mods[0].sha512).toBe('b'.repeat(128));
  });

  it('gives entries ids that survive a version bump', async () => {
    // Keyed on the path, a new jar name would read as a different mod and the
    // old one would never be cleaned up. The hash is unique per file.
    const contents = index({ files: [file({ hashes: { sha512: 'c'.repeat(128) } })] });
    const manifest = mrpackToManifest(await readMrpack(await pack('ids', contents)));

    expect(manifest.mods[0].id).toBe('c'.repeat(32));
  });

  it('keeps an optional mod, because the pack still ships it', async () => {
    const contents = index({
      files: [file({ path: 'mods/opt.jar', env: { client: 'optional', server: 'optional' } })],
    });
    const manifest = mrpackToManifest(await readMrpack(await pack('optional', contents)));

    expect(manifest.mods).toHaveLength(1);
    // `optional` means the player may switch it off, not that the launcher may
    // decline to fetch it.
    expect(manifest.mods[0].required).toBe(false);
  });

  it('produces a manifest that passes the launcher schema', async () => {
    const contents = index({
      files: [file({ path: 'mods/a.jar' }), file({ path: 'config/b.json' })],
    });
    const manifest = mrpackToManifest(await readMrpack(await pack('valid', contents)));

    const { modManifestSchema } = await import('../src/shared/manifest-schema');
    expect(modManifestSchema.safeParse(manifest).success).toBe(true);
  });
});
