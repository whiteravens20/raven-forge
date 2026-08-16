import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { encodeFrame, socketCandidates } from '../src/core/discord/rich-presence';

/**
 * The two halves of Discord's IPC that can be checked without Discord: how a
 * frame is laid out, and where the socket is looked for.
 *
 * Both fail silently in the same way if they are wrong — no status appears, and
 * nothing anywhere says why.
 */

const HEADER_BYTES = 8;

function decode(frame: Buffer): { op: number; length: number; payload: unknown } {
  return {
    op: frame.readInt32LE(0),
    length: frame.readInt32LE(4),
    payload: JSON.parse(frame.subarray(HEADER_BYTES).toString('utf8')),
  };
}

describe('encodeFrame', () => {
  it('writes the opcode and payload length as little-endian int32s', () => {
    const frame = encodeFrame(1, { cmd: 'SET_ACTIVITY' });
    const body = Buffer.from(JSON.stringify({ cmd: 'SET_ACTIVITY' }), 'utf8');

    expect(frame.subarray(0, 4)).toEqual(Buffer.from([1, 0, 0, 0]));
    expect(frame.readInt32LE(4)).toBe(body.length);
    expect(frame.subarray(HEADER_BYTES)).toEqual(body);
  });

  it('measures the payload in bytes, not characters', () => {
    // The launcher opens in Polish, so a profile name with a diacritic is the
    // normal case rather than an edge one. A length counted in characters
    // leaves Discord waiting for bytes that never arrive.
    const frame = encodeFrame(1, { details: 'Wieża Kruków' });
    const { length, payload } = decode(frame);

    expect(length).toBe(frame.length - HEADER_BYTES);
    expect(length).toBeGreaterThan(JSON.stringify({ details: 'Wieża Kruków' }).length);
    expect(payload).toEqual({ details: 'Wieża Kruków' });
  });

  it('round-trips a clearing frame, where the activity is null', () => {
    const frame = encodeFrame(1, { cmd: 'SET_ACTIVITY', args: { pid: 42, activity: null } });
    expect(decode(frame)).toMatchObject({
      op: 1,
      payload: { cmd: 'SET_ACTIVITY', args: { pid: 42, activity: null } },
    });
  });
});

describe('socketCandidates', () => {
  const platform = process.platform;
  const env = { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, TMPDIR: process.env.TMPDIR };

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('looks in the runtime directory first, at index 0', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env.XDG_RUNTIME_DIR = '/run/user/1000';

    expect(socketCandidates()[0]).toBe(path.join('/run/user/1000', 'discord-ipc-0'));
  });

  it('covers all ten indices, because a second Discord takes the next one', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env.XDG_RUNTIME_DIR = '/run/user/1000';

    const plain = socketCandidates().filter((p) => path.dirname(p) === '/run/user/1000');
    expect(plain).toHaveLength(10);
    expect(plain.at(-1)).toBe(path.join('/run/user/1000', 'discord-ipc-9'));
  });

  it('looks inside the Flatpak and Snap sandboxes', () => {
    // The whole of "Rich Presence doesn't work on Linux": a sandboxed Discord
    // keeps its socket where an app watching only the runtime directory
    // will never see it.
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env.XDG_RUNTIME_DIR = '/run/user/1000';
    const candidates = socketCandidates();

    expect(candidates).toContain('/run/user/1000/app/com.discordapp.Discord/discord-ipc-0');
    expect(candidates).toContain('/run/user/1000/snap.discord/discord-ipc-0');
  });

  it('falls back to /tmp when no runtime directory is set', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    delete process.env.XDG_RUNTIME_DIR;
    delete process.env.TMPDIR;

    expect(socketCandidates()[0]).toBe(path.join('/tmp', 'discord-ipc-0'));
  });

  it('uses named pipes on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    const candidates = socketCandidates();
    expect(candidates[0]).toBe('\\\\.\\pipe\\discord-ipc-0');
    expect(candidates).toHaveLength(10);
  });
});
