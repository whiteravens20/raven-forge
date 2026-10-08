// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import type { Readable } from 'node:stream';
import yauzl from 'yauzl';

/**
 * Reading a zip archive, one file at a time.
 *
 * A pack, a loader's installer, a jar of native libraries and a resource pack
 * somebody picked off their disk are all the same thing to read, and each used
 * to be read by a copy of this of its own — three of them, which had already
 * disagreed once about whether the archive is closed when the reading stops
 * early.
 */

/** What `visit` answers to have the rest of the archive left unread. */
export const STOP = Symbol('stop reading the archive');

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, opened) => {
      if (err || !opened) reject(err ?? new Error(`Could not open ${file}`));
      else resolve(opened);
    });
  });
}

/** The bytes of one file in an archive that {@link eachEntry} is going through. */
export function openEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) reject(err ?? new Error(`Could not read ${entry.fileName}`));
      else resolve(stream);
    });
  });
}

/**
 * Go through an archive's files one at a time, in order.
 *
 * `visit` decides what to do with each; the next one is not read until it has
 * finished, and none after it are read once it answers {@link STOP}. Folders are
 * passed over: an archive lists them as entries of their own, and they hold
 * nothing.
 *
 * The archive is closed whichever way this ends. yauzl closes it by itself only
 * when it runs off the end of the entries, so stopping early, or failing on the
 * way, used to leave the file open for as long as the launcher ran.
 */
export async function eachEntry(
  file: string,
  visit: (zip: yauzl.ZipFile, entry: yauzl.Entry) => Promise<void | typeof STOP>,
): Promise<void> {
  const zip = await openZip(file);
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith('/')) zip.readEntry();
        else {
          visit(zip, entry).then(
            (answer) => (answer === STOP ? resolve() : zip.readEntry()),
            reject,
          );
        }
      });
      zip.on('end', resolve);
      zip.on('error', reject);
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

/** One file out of an archive, whole and in memory, or null when it is not there. */
export async function readZipEntry(file: string, wanted: string): Promise<Buffer | null> {
  let found: Buffer | null = null;
  await eachEntry(file, async (zip, entry) => {
    if (entry.fileName !== wanted) return;
    const chunks: Buffer[] = [];
    for await (const chunk of await openEntry(zip, entry)) chunks.push(chunk as Buffer);
    found = Buffer.concat(chunks);
    return STOP;
  });
  return found;
}
