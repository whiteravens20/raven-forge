import zlib from 'node:zlib';

/**
 * A minimal, store-only zip writer, for building fixture archives in tests.
 *
 * Stored rather than deflated because nothing here is big enough for
 * compression to matter, and "no compression" is a shorter thing to get right.
 * Real `.mrpack` files are deflated; yauzl reads both, and the reader under test
 * never looks at the compression method.
 */
export class ZipWriter {
  private readonly entries: Array<{ name: string; data: Buffer }> = [];

  add(name: string, data: string | Buffer): void {
    this.entries.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8') });
  }

  toBuffer(): Buffer {
    const chunks: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;

    for (const { name, data } of this.entries) {
      const nameBytes = Buffer.from(name, 'utf-8');
      const crc = zlib.crc32(data);

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); // version needed
      local.writeUInt16LE(0, 6); // flags
      local.writeUInt16LE(0, 8); // stored
      local.writeUInt16LE(0, 10); // time
      local.writeUInt16LE(0x21, 12); // date — 1980-01-01, valid and meaningless
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(nameBytes.length, 26);
      local.writeUInt16LE(0, 28); // extra

      chunks.push(local, nameBytes, data);

      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(20, 4); // version made by
      header.writeUInt16LE(20, 6); // version needed
      header.writeUInt16LE(0, 8);
      header.writeUInt16LE(0, 10);
      header.writeUInt16LE(0, 12);
      header.writeUInt16LE(0x21, 14);
      header.writeUInt32LE(crc, 16);
      header.writeUInt32LE(data.length, 20);
      header.writeUInt32LE(data.length, 24);
      header.writeUInt16LE(nameBytes.length, 28);
      header.writeUInt16LE(0, 30); // extra
      header.writeUInt16LE(0, 32); // comment
      header.writeUInt16LE(0, 34); // disk
      header.writeUInt16LE(0, 36); // internal attrs
      header.writeUInt32LE(0, 38); // external attrs
      header.writeUInt32LE(offset, 42);
      central.push(header, nameBytes);

      offset += local.length + nameBytes.length + data.length;
    }

    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4); // this disk
    end.writeUInt16LE(0, 6); // disk with the directory
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20); // comment

    return Buffer.concat([...chunks, directory, end]);
  }
}
