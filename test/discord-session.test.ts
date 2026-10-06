// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * What Discord is told over a session: which game is showing, and when the
 * status comes down.
 *
 * Discord here is a socket in a temporary runtime directory that answers the
 * handshake the way the real one does and writes down every activity it is
 * sent. POSIX only — on Windows the socket is a named pipe at a fixed name.
 */

const posix = process.platform !== 'win32';

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

type Presence = typeof import('../src/core/discord/rich-presence');

const HEADER_BYTES = 8;
const OP_FRAME = 1;

let runtimeDir: string;
let discord: net.Server;
/** Everyone connected, so the stand-in can hang up on them when a test is over. */
let clients: net.Socket[];
/** `details` of each activity received, `null` for one that clears the status. */
let shown: Array<string | null>;
/** Held back until released, to keep a connection attempt in the air. */
let answerHandshake: (() => void) | null;
let holdHandshake: boolean;
let presence: Presence;
const saved = {
  runtime: process.env.XDG_RUNTIME_DIR,
  appId: process.env.RAVENFORGE_DISCORD_APP_ID,
};

function frame(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

const game = (profileName: string) => ({
  profileName,
  minecraftVersion: '1.21.4',
  loader: 'Fabric',
  startedAt: 1_700_000_000_000,
});

beforeEach(async () => {
  runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-discord-'));
  process.env.XDG_RUNTIME_DIR = runtimeDir;
  process.env.RAVENFORGE_DISCORD_APP_ID = '123456789012345678';
  shown = [];
  clients = [];
  answerHandshake = null;
  holdHandshake = false;

  discord = net.createServer((client) => {
    let buffer = Buffer.alloc(0);
    let greeted = false;
    clients.push(client);
    client.on('error', () => {});
    client.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= HEADER_BYTES) {
        const length = buffer.readInt32LE(4);
        if (buffer.length < HEADER_BYTES + length) return;
        const payload = JSON.parse(
          buffer.subarray(HEADER_BYTES, HEADER_BYTES + length).toString('utf8'),
        ) as { cmd?: string; args?: { activity: { details: string } | null } };
        buffer = buffer.subarray(HEADER_BYTES + length);

        if (!greeted) {
          greeted = true;
          const ready = () => client.write(frame(OP_FRAME, { cmd: 'DISPATCH', evt: 'READY' }));
          if (holdHandshake) answerHandshake = ready;
          else ready();
        } else if (payload.cmd === 'SET_ACTIVITY') {
          shown.push(payload.args?.activity?.details ?? null);
        }
      }
    });
  });
  if (posix) {
    await new Promise<void>((resolve) =>
      discord.listen(path.join(runtimeDir, 'discord-ipc-0'), resolve),
    );
  }

  vi.resetModules();
  presence = await import('../src/core/discord/rich-presence');
});

afterEach(async () => {
  for (const client of clients) client.destroy();
  if (discord.listening) await new Promise<void>((resolve) => discord.close(() => resolve()));
  for (const [key, value] of [
    ['XDG_RUNTIME_DIR', saved.runtime],
    ['RAVENFORGE_DISCORD_APP_ID', saved.appId],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(runtimeDir, { recursive: true, force: true });
});

const settled = () => new Promise((resolve) => setTimeout(resolve, 50));

describe.skipIf(!posix)('the Discord status', () => {
  it('shows the game that started and comes down when it ends', async () => {
    await presence.setGamePresence('p1', game('Survival'));
    await presence.clearGamePresence('p1');
    await settled();

    expect(shown).toEqual(['Survival', null]);
  });

  it('stays up for a game still running when another one ends', async () => {
    await presence.setGamePresence('p1', game('Survival'));
    await presence.setGamePresence('p2', game('Creative'));

    await presence.clearGamePresence('p2');
    await settled();

    // Back to the one still being played — not taken down, which is what the
    // first game to exit used to do to the other.
    expect(shown).toEqual(['Survival', 'Creative', 'Survival']);
  });

  it('comes down only after the last of two games', async () => {
    await presence.setGamePresence('p1', game('Survival'));
    await presence.setGamePresence('p2', game('Creative'));

    await presence.clearGamePresence('p1');
    await presence.clearGamePresence('p2');
    await settled();

    expect(shown.at(-1)).toBeNull();
    expect(shown.filter((entry) => entry === null)).toHaveLength(1);
  });

  it('is never put up for a game that was over before Discord answered', async () => {
    // A JVM that exits at once, or never starts. The status used to appear
    // after the game was gone and stay until the launcher was closed.
    holdHandshake = true;
    const showing = presence.setGamePresence('p1', game('Survival'));
    await vi.waitFor(() => expect(answerHandshake).not.toBeNull());

    await presence.clearGamePresence('p1');
    answerHandshake!();
    await showing;
    await settled();

    expect(shown).toEqual([]);
  });

  it('ignores the end of a game it was never told about', async () => {
    await presence.clearGamePresence('never-started');
    await settled();

    expect(shown).toEqual([]);
  });
});
