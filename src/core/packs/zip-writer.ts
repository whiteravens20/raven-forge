import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import zlib from 'node:zlib';

/**
 * Writing a zip, which is the half of the format the launcher did not have.
 *
 * `mrpack.ts` reads packs with yauzl; exporting one needs the other direction,
 * and this is it. Entries are **stored**, not deflated: a `.mrpack` is a small
 * JSON index plus whatever could not be resolved to a URL, and the things that
 * land in the latter are jars and zips — already-compressed archives that
 * deflate gains nothing on. What is left is text config, where the saving is a
 * few kilobytes against a format that has to be exactly right for other
 * launchers to open it.
 *
 * Everything is streamed to a file handle. A pack that bundles a few hundred
 * megabytes of jars must not exist in memory first, which is the whole reason
 * this is not four lines around `Buffer.concat`.
 */

/** Zip without the zip64 extensions tops out here, and this writer does not use them. */
const MAX_ZIP_BYTES = 0xffffffff;

interface CentralEntry {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
  dosTime: number;
  dosDate: number;
}

/** MS-DOS packed date and time, which is what a zip header stores. */
function dosStamp(when: Date): { dosTime: number; dosDate: number } {
  return {
    dosTime: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
    // Years are counted from 1980, and the format cannot express anything before
    // it. A clock set to 1970 would otherwise write a negative year.
    dosDate:
      (Math.max(when.getFullYear() - 1980, 0) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

export class ZipWriter {
  private readonly entries: CentralEntry[] = [];
  private offset = 0;
  private readonly names = new Set<string>();

  private constructor(private readonly handle: fs.FileHandle) {}

  /** Open `file` for writing, truncating whatever was there. */
  static async create(file: string): Promise<ZipWriter> {
    return new ZipWriter(await fs.open(file, 'w'));
  }

  /** An entry whose bytes are already in hand — the index, a small override. */
  async addBuffer(name: string, data: Buffer, when = new Date()): Promise<void> {
    await this.writeEntry(name, zlib.crc32(data), data.length, when, async () => {
      await this.handle.write(data);
    });
  }

  /**
   * An entry read from disk, never held whole in memory.
   *
   * The file is read twice: once for the CRC and the length, which a zip's local
   * header states *before* the data, and once to copy the bytes. The alternative
   * is a data descriptor after the entry, which some readers handle and some
   * quietly get wrong — two reads of a local file is the cheaper mistake to
   * avoid making.
   */
  async addFile(name: string, filePath: string): Promise<void> {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_ZIP_BYTES) {
      throw new Error(`${name} is too large to put in a zip without zip64 extensions`);
    }

    let crc = 0;
    for await (const chunk of createReadStream(filePath)) crc = zlib.crc32(chunk as Buffer, crc);

    await this.writeEntry(name, crc, stat.size, stat.mtime, async () => {
      let written = 0;
      for await (const chunk of createReadStream(filePath)) {
        const buffer = chunk as Buffer;
        written += buffer.length;
        // A file that grew between the two reads would leave the archive
        // claiming a length it does not contain, which reads as corruption
        // rather than as the race it is.
        if (written > stat.size) throw new Error(`${name} changed while it was being packed`);
        await this.handle.write(buffer);
      }
      if (written !== stat.size) throw new Error(`${name} changed while it was being packed`);
    });
  }

  private async writeEntry(
    name: string,
    crc: number,
    size: number,
    when: Date,
    writeData: () => Promise<void>,
  ): Promise<void> {
    // A zip may hold the same name twice, and readers disagree about which one
    // wins. Refusing is the only answer that means the same thing everywhere.
    if (this.names.has(name)) throw new Error(`Duplicate entry in the pack: ${name}`);
    this.names.add(name);

    const nameBytes = Buffer.from(name, 'utf-8');
    const { dosTime, dosDate } = dosStamp(when);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed to extract
    // Bit 11: the name is UTF-8. Without it a reader is entitled to decode a
    // non-ASCII file name as CP437, and mod file names are full of them.
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed
    local.writeUInt32LE(size, 22); // uncompressed
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra

    const offset = this.offset;
    await this.handle.write(local);
    await this.handle.write(nameBytes);
    await writeData();

    this.offset += local.length + nameBytes.length + size;
    if (this.offset > MAX_ZIP_BYTES) {
      throw new Error('The pack is too large to write without zip64 extensions');
    }

    this.entries.push({ name: nameBytes, crc, size, offset, dosTime, dosDate });
  }

  /** Write the central directory and close. Nothing may be added afterwards. */
  async finish(): Promise<void> {
    try {
      const directoryOffset = this.offset;
      for (const entry of this.entries) {
        const header = Buffer.alloc(46);
        header.writeUInt32LE(0x02014b50, 0);
        header.writeUInt16LE(20, 4); // version made by
        header.writeUInt16LE(20, 6); // version needed
        header.writeUInt16LE(0x0800, 8); // UTF-8 names
        header.writeUInt16LE(0, 10); // stored
        header.writeUInt16LE(entry.dosTime, 12);
        header.writeUInt16LE(entry.dosDate, 14);
        header.writeUInt32LE(entry.crc, 16);
        header.writeUInt32LE(entry.size, 20);
        header.writeUInt32LE(entry.size, 24);
        header.writeUInt16LE(entry.name.length, 28);
        header.writeUInt16LE(0, 30); // extra
        header.writeUInt16LE(0, 32); // comment
        header.writeUInt16LE(0, 34); // disk
        header.writeUInt16LE(0, 36); // internal attributes
        header.writeUInt32LE(0, 38); // external attributes
        header.writeUInt32LE(entry.offset, 42);
        await this.handle.write(header);
        await this.handle.write(entry.name);
        this.offset += header.length + entry.name.length;
      }

      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(0, 4); // this disk
      end.writeUInt16LE(0, 6); // disk holding the directory
      end.writeUInt16LE(this.entries.length, 8);
      end.writeUInt16LE(this.entries.length, 10);
      end.writeUInt32LE(this.offset - directoryOffset, 12);
      end.writeUInt32LE(directoryOffset, 16);
      end.writeUInt16LE(0, 20); // comment
      await this.handle.write(end);
    } finally {
      await this.handle.close();
    }
  }

  /** Close without a central directory, for an export that failed part-way. */
  async abort(): Promise<void> {
    await this.handle.close().catch(() => undefined);
  }
}
