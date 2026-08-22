import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import yauzl from 'yauzl';
import { ZipWriter } from '../src/core/packs/zip-writer';

/**
 * The zip half of the pack format, checked at the byte level.
 *
 * `mrpack-export.test.ts` already proves the archives this writes can be opened:
 * it hands one to the system `unzip`, which shares no code with any of this. What
 * that cannot see is everything a reader is entitled to get wrong *quietly* — a
 * name flag that is not set, so a mod called `Zbroja Kruka.jar` comes out of
 * somebody else's launcher as `Zbroja Kruka.jar` decoded from CP437; a date
 * field that went negative because the clock said 1970; a second entry with a
 * name the first one already used, where two readers pick different files and
 * both think they are right.
 *
 * So this one reads the bytes. Round-trips go through yauzl, which is the reader
 * `mrpack.ts` uses for importing — the two directions meeting is the thing worth
 * knowing.
 */

let dir: string;
const zipPath = () => path.join(dir, 'out.zip');

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-zip-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** Every entry in the archive, name to contents, read back with yauzl. */
async function readBack(file: string): Promise<Map<string, Buffer>> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, opened) =>
      err || !opened ? reject(err ?? new Error('not a zip')) : resolve(opened),
    );
  });

  return new Promise((resolve, reject) => {
    const out = new Map<string, Buffer>();
    zip.on('entry', (entry: yauzl.Entry) => {
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return reject(err ?? new Error('no stream'));
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => {
          out.set(entry.fileName, Buffer.concat(chunks));
          zip.readEntry();
        });
        stream.on('error', reject);
      });
    });
    zip.on('end', () => resolve(out));
    zip.on('error', reject);
    zip.readEntry();
  });
}

/** The general-purpose flags of the first local header. */
function localFlags(archive: Buffer): number {
  expect(archive.readUInt32LE(0)).toBe(0x04034b50);
  return archive.readUInt16LE(6);
}

describe('ZipWriter', () => {
  it('writes an archive yauzl reads back byte for byte', async () => {
    const zip = await ZipWriter.create(zipPath());
    await zip.addBuffer('modrinth.index.json', Buffer.from('{"formatVersion":1}', 'utf-8'));
    await zip.addBuffer('overrides/config/raven.toml', Buffer.from('a = 1\n', 'utf-8'));
    await zip.finish();

    const entries = await readBack(zipPath());
    expect([...entries.keys()]).toEqual(['modrinth.index.json', 'overrides/config/raven.toml']);
    expect(entries.get('modrinth.index.json')?.toString('utf-8')).toBe('{"formatVersion":1}');
  });

  it('carries a file through in one piece, however many chunks it arrives in', async () => {
    // Comfortably past the 64 KiB read stream default, so the CRC is
    // accumulated across chunks and the copy loop runs more than once. A
    // per-chunk CRC that forgot to carry the running value passes on small
    // inputs and fails here.
    const payload = crypto.randomBytes(300_000);
    const src = path.join(dir, 'big.jar');
    await fs.writeFile(src, payload);

    const zip = await ZipWriter.create(zipPath());
    await zip.addFile('overrides/mods/big.jar', src);
    await zip.finish();

    expect(await readBack(zipPath())).toEqual(new Map([['overrides/mods/big.jar', payload]]));
  });

  it('marks names as UTF-8, so a reader may not decode them as CP437', async () => {
    const name = 'overrides/mods/Zbroja Kruka — wersja ostateczna.jar';
    const zip = await ZipWriter.create(zipPath());
    await zip.addBuffer(name, Buffer.from('jar', 'utf-8'));
    await zip.finish();

    const archive = await fs.readFile(zipPath());
    expect(localFlags(archive) & 0x0800).toBe(0x0800);
    expect([...(await readBack(zipPath())).keys()]).toEqual([name]);
  });

  it('refuses a name it has already written', async () => {
    // A zip may hold the same name twice and readers disagree about which one
    // wins, so an export that did it would install differently depending on who
    // opened it.
    const zip = await ZipWriter.create(zipPath());
    await zip.addBuffer('overrides/options.txt', Buffer.from('a'));
    await expect(zip.addBuffer('overrides/options.txt', Buffer.from('b'))).rejects.toThrow(
      /Duplicate entry/,
    );
    await zip.abort();
  });

  it('clamps a timestamp the format cannot express instead of writing a negative year', async () => {
    // MS-DOS counts years from 1980. A clock set before it — a fresh container,
    // a dead CMOS battery, a file restored with a zeroed mtime — used to write a
    // negative field into the header.
    const zip = await ZipWriter.create(zipPath());
    await zip.addBuffer('old.txt', Buffer.from('x'), new Date(1970, 0, 1, 12, 0, 0));
    await zip.finish();

    const archive = await fs.readFile(zipPath());
    const dosDate = archive.readUInt16LE(12);
    expect(dosDate >> 9).toBe(0); // 1980
    expect((dosDate >> 5) & 0xf).toBe(1); // January
    expect(dosDate & 0x1f).toBe(1); // the 1st
  });

  // `/proc` is the only place with a file that lies about its size on demand.
  it.skipIf(process.platform !== 'linux')(
    'states a length it can stand behind, and refuses when it cannot',
    async () => {
      // `/proc/self/maps` reports a size of zero and then hands over kilobytes,
      // which is the same condition as a file being appended to while it is packed
      // — the local header has already stated a length by the time the bytes
      // disagree with it. An archive claiming a length it does not contain reads
      // as corruption rather than as the race it is, so it is refused instead.
      const zip = await ZipWriter.create(zipPath());
      await expect(zip.addFile('maps', '/proc/self/maps')).rejects.toThrow(
        /changed while it was being packed/,
      );
      await zip.abort();
    },
  );

  // sysfs attributes state 4096 bytes and hand over a line or two of text.
  it.skipIf(process.platform !== 'linux')(
    'refuses a file that turned out shorter than it said it was',
    async () => {
      // The other half of the same guarantee. A file that shrank between the
      // header being written and the bytes being copied leaves the entry padded
      // out with whatever follows it in the archive — which is to say, with the
      // next entry.
      const zip = await ZipWriter.create(zipPath());
      await expect(zip.addFile('online', '/sys/devices/system/cpu/online')).rejects.toThrow(
        /changed while it was being packed/,
      );
      await zip.abort();
    },
  );

  it('refuses a file too large for a zip without zip64 extensions', async () => {
    const huge = path.join(dir, 'huge.bin');
    const handle = await fs.open(huge, 'w');
    // Sparse: the size is declared, the blocks are never allocated.
    await handle.truncate(0x1_0000_0000);
    await handle.close();

    const zip = await ZipWriter.create(zipPath());
    await expect(zip.addFile('overrides/huge.bin', huge)).rejects.toThrow(/zip64/);
    await zip.abort();
  });

  it('leaves an aborted export unopenable rather than half-valid', async () => {
    // An export that failed part way through must not produce something another
    // launcher will happily open and install half of.
    const zip = await ZipWriter.create(zipPath());
    await zip.addBuffer('modrinth.index.json', Buffer.from('{}'));
    await zip.abort();

    await expect(readBack(zipPath())).rejects.toThrow();
  });

  it('is finished when it says it is', async () => {
    const zip = await ZipWriter.create(zipPath());
    await zip.addBuffer('a.txt', Buffer.from('a'));
    await zip.finish();
    await expect(zip.addBuffer('b.txt', Buffer.from('b'))).rejects.toThrow();
  });

  it('fails loudly on a second finish rather than appending a second directory', async () => {
    const zip = await ZipWriter.create(zipPath());
    await zip.addBuffer('a.txt', Buffer.from('a'));
    await zip.finish();
    // A second finish writes to a closed handle and must not leak it either.
    await expect(zip.finish()).rejects.toThrow();
    await expect(zip.finish()).rejects.toThrow();
  });

  it('writes an empty archive rather than an empty file', async () => {
    const zip = await ZipWriter.create(zipPath());
    await zip.finish();

    expect(await readBack(zipPath())).toEqual(new Map());
    // End-of-central-directory record and nothing else.
    expect((await fs.stat(zipPath())).size).toBe(22);
  });
});
