/**
 * "Playing Raven Forge" on the player's Discord profile, for as long as the
 * game is running.
 *
 * Discord has two ways of showing what someone is playing, and Raven Forge gets
 * nothing from the first one. Automatic game detection matches running
 * processes against Discord's own games database, where Minecraft Java is
 * registered against `javaw.exe` — the executable the official launcher runs.
 * We run `java` from a JRE we downloaded ourselves, so from Discord's side the
 * player started an anonymous JVM.
 *
 * The second way is this one: connect to Discord's local IPC socket and declare
 * the activity ourselves. No dependency and no network — `discord-rpc` has been
 * unmaintained for years, and everything it does is an 8-byte header in front
 * of some JSON.
 *
 * What the player's friends see is our application's name from the Discord
 * developer portal, so "Raven Forge" with the profile underneath, never
 * "Minecraft" — naming the application after Mojang's game to borrow the
 * detection would be trading on their trademark.
 *
 * Fail-soft is the whole contract here. No Discord, an old Discord, a sandboxed
 * Discord, a socket that closes mid-session: every one of those is one line in
 * the log and a launch that proceeds exactly as it would have.
 */

import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { log } from '../../main/logger';
import { DISCORD_APPLICATION_ID } from '../../shared/branding';

/** Opcodes from Discord's IPC framing. */
const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

/** Header: opcode and payload length, both int32 little-endian. */
const HEADER_BYTES = 8;

/** Discord numbers its sockets; a second running client takes the next index. */
const SOCKET_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Long enough for a socket that exists, short enough not to delay a launch. */
const CONNECT_TIMEOUT_MS = 2000;

export interface GamePresence {
  profileName: string;
  minecraftVersion: string;
  /** Already display-cased — `Fabric`, `NeoForge`. */
  loader: string;
  /** Epoch ms; Discord turns it into the elapsed-time counter itself. */
  startedAt: number;
}

/**
 * Every path Discord might be listening on, in the order worth trying.
 *
 * The plain runtime directory covers a normal install. The rest is why "Discord
 * Rich Presence doesn't work on Linux" is such a common report: Flatpak and
 * Snap both confine the socket inside the sandbox, where an application that
 * only looks at `$XDG_RUNTIME_DIR/discord-ipc-0` will never find it.
 */
export function socketCandidates(): string[] {
  if (process.platform === 'win32') {
    return SOCKET_INDICES.map((i) => `\\\\.\\pipe\\discord-ipc-${i}`);
  }
  // macOS puts it under the per-user `TMPDIR`; Linux under `XDG_RUNTIME_DIR`.
  const base =
    process.env.XDG_RUNTIME_DIR ??
    process.env.TMPDIR ??
    process.env.TMP ??
    process.env.TEMP ??
    '/tmp';
  const dirs = [
    base,
    path.join(base, 'app', 'com.discordapp.Discord'),
    path.join(base, 'app', 'com.discordapp.DiscordCanary'),
    path.join(base, 'snap.discord'),
    path.join(base, 'snap.discord-canary'),
  ];
  return dirs.flatMap((dir) => SOCKET_INDICES.map((i) => path.join(dir, `discord-ipc-${i}`)));
}

/**
 * One IPC frame: the header, then the JSON.
 *
 * The length is the payload's size in *bytes*. A profile called "Wieża" is one
 * byte longer than it has characters, and a length taken from the string would
 * leave Discord waiting for a byte that never comes, then reading the next
 * frame's header as part of this one.
 */
export function encodeFrame(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** The one connection, or nothing. A second game does not open a second socket. */
let socket: net.Socket | null = null;

function disconnect(): void {
  if (!socket) return;
  const dying = socket;
  socket = null;
  dying.removeAllListeners();
  dying.destroy();
}

/**
 * Connect to the first socket that answers.
 *
 * Tried in sequence rather than in parallel: nine of these ten paths normally
 * do not exist, and a refused connection to a missing socket comes back
 * immediately.
 */
async function connect(): Promise<net.Socket | null> {
  for (const candidate of socketCandidates()) {
    const connected = await new Promise<net.Socket | null>((resolve) => {
      const attempt = net.createConnection(candidate);
      const settle = (result: net.Socket | null) => {
        attempt.removeAllListeners();
        clearTimeout(timer);
        if (!result) attempt.destroy();
        resolve(result);
      };
      const timer = setTimeout(() => settle(null), CONNECT_TIMEOUT_MS);
      attempt.once('connect', () => settle(attempt));
      attempt.once('error', () => settle(null));
    });
    if (connected) return connected;
  }
  return null;
}

/**
 * Handshake, then wait for Discord to say READY.
 *
 * An activity sent before that is discarded, so this waits rather than firing
 * and hoping. Resolves false on anything unexpected — a Discord too old for
 * version 1 of the protocol answers the handshake with a close frame.
 */
function handshake(sock: net.Socket): Promise<boolean> {
  return new Promise((resolve) => {
    let buffer = Buffer.alloc(0);
    let settled = false;

    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.off('data', onData);
      sock.off('error', onFailure);
      sock.off('close', onFailure);
      resolve(ok);
    };
    const onFailure = () => settle(false);
    const timer = setTimeout(() => settle(false), CONNECT_TIMEOUT_MS);

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      // Discord may coalesce frames into one chunk, or split one across two.
      while (buffer.length >= HEADER_BYTES) {
        const op = buffer.readInt32LE(0);
        const length = buffer.readInt32LE(4);
        if (buffer.length < HEADER_BYTES + length) return;
        const body = buffer.subarray(HEADER_BYTES, HEADER_BYTES + length).toString('utf8');
        buffer = buffer.subarray(HEADER_BYTES + length);

        if (op === OP_CLOSE) {
          settle(false);
          return;
        }
        if (op === OP_PING) {
          sock.write(encodeFrame(OP_PONG, JSON.parse(body)));
          continue;
        }
        if (op === OP_FRAME) {
          const frame = JSON.parse(body) as { evt?: string };
          if (frame.evt === 'READY') settle(true);
        }
      }
    };

    sock.on('data', onData);
    sock.once('error', onFailure);
    sock.once('close', onFailure);
    sock.write(encodeFrame(OP_HANDSHAKE, { v: 1, client_id: DISCORD_APPLICATION_ID }));
  });
}

function sendActivity(sock: net.Socket, activity: unknown): void {
  sock.write(
    encodeFrame(OP_FRAME, {
      cmd: 'SET_ACTIVITY',
      // Ours, not the game's: Discord clears the activity if this process dies,
      // which is the behaviour we want if the launcher is killed mid-session.
      args: { pid: process.pid, activity },
      nonce: crypto.randomUUID(),
    }),
  );
}

/**
 * Announce that a profile is running.
 *
 * Deliberately says nothing about which server the player is on. That address
 * would be handed to their entire friends list, and unlike the profile name it
 * is not something they chose to publish — the profile name, version and loader
 * are all the status has ever needed.
 */
export async function setGamePresence(presence: GamePresence): Promise<void> {
  try {
    if (!DISCORD_APPLICATION_ID) {
      log.info('Discord Rich Presence: no application ID compiled in, skipping.');
      return;
    }
    disconnect();

    const sock = await connect();
    if (!sock) {
      log.info('Discord Rich Presence: no Discord IPC socket found, skipping.');
      return;
    }
    if (!(await handshake(sock))) {
      log.info('Discord Rich Presence: Discord did not complete the handshake, skipping.');
      sock.destroy();
      return;
    }

    // Once connected, a dropped socket is not worth a reconnect loop: the
    // player quit Discord mid-session, and the status they left has gone with
    // it. Nothing here may take the launcher down with it, though.
    sock.on('error', (err) => {
      log.info(`Discord Rich Presence: connection lost (${err.message}).`);
      disconnect();
    });
    sock.on('close', () => disconnect());

    socket = sock;
    sendActivity(sock, {
      details: presence.profileName,
      state: `Minecraft ${presence.minecraftVersion} · ${presence.loader}`,
      timestamps: { start: presence.startedAt },
      // Unknown asset keys are ignored, so this lights up when the artwork is
      // uploaded to the portal and costs nothing until then.
      assets: { large_image: 'raven-forge', large_text: 'Raven Forge' },
    });
    log.info(`Discord Rich Presence: showing "${presence.profileName}".`);
  } catch (err) {
    log.info(`Discord Rich Presence: not shown (${err instanceof Error ? err.message : err}).`);
    disconnect();
  }
}

/** Take the status down. Safe to call when nothing was ever shown. */
export function clearGamePresence(): void {
  const sock = socket;
  if (!sock) return;
  socket = null;
  sock.removeAllListeners();
  try {
    sendActivity(sock, null);
    // `end` rather than `destroy`: the clearing frame is still queued, and
    // destroying the socket would throw it away. Discord also drops the
    // activity when the connection closes, so either way the status goes.
    sock.end();
  } catch {
    // A socket that died on its own is exactly the case this must not report.
    sock.destroy();
  }
}
