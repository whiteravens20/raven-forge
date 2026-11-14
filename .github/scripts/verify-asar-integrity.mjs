// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

// Changes one character of a packaged launcher's app.asar and holds the program
// to refusing it.
//
// Two fuses (`electronFuses` in electron-builder.config.js) tie the program to
// its archive: it runs the app from app.asar or not at all, and on Windows it
// checks the archive against the digest electron-builder wrote into the .exe.
// Reading the fuses back says they are on, not that a changed archive is
// refused. So a copy of the unpacked program is started twice: as it was built,
// which has to stay up — a refusal would prove nothing if that one did not —
// and with one character of the archive's index changed, which has to be
// stopped before it is up. Electron makes the check on Windows and macOS only,
// so this is for the Windows build.
//
//   node .github/scripts/verify-asar-integrity.mjs <unpacked folder> <program file name>
//
// Exit codes: 0 the changed archive was refused, 1 it was not, 2 the check
// itself could not be made.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** How long a program that was not stopped is given to show that it stays up. */
const STAYS_UP_MS = 20_000;

const [unpacked, programName] = process.argv.slice(2);
if (!unpacked || !programName) {
  console.error('usage: verify-asar-integrity.mjs <unpacked folder> <program file name>');
  process.exit(2);
}

/** The check itself could not be made: exit 2, with the copies cleared away. */
class CannotCheck extends Error {}

/** The whole tree, so that nothing a launcher started is left behind. */
function stop(child) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGKILL');
  }
}

/**
 * Start the program and see what it does in the time it is given: `null` when
 * it is still up at the end of it, otherwise how it ended and what it said.
 */
async function run(program) {
  const child = spawn(program, [], { stdio: ['ignore', 'pipe', 'pipe'] });
  let said = '';
  child.stdout.on('data', (chunk) => (said += chunk));
  child.stderr.on('data', (chunk) => (said += chunk));
  const ended = new Promise((resolve) => {
    child.on('error', (err) => resolve({ code: null, signal: null, said: String(err) }));
    child.on('exit', (code, signal) => resolve({ code, signal, said }));
  });
  const outcome = await Promise.race([
    ended,
    new Promise((resolve) => setTimeout(() => resolve(null), STAYS_UP_MS)),
  ]);
  if (outcome === null) {
    stop(child);
    await ended;
  }
  return outcome;
}

/**
 * Change one character of the archive's index, and nothing about its shape.
 *
 * An asar file begins with two sizes and then the index, a JSON document whose
 * length is the 32-bit number at byte 12, starting at byte 16. Every file in it
 * has a `"hash":"…"` of hex digits; one digit of the first of them is changed,
 * so the index still reads as before and no longer has the digest the program
 * holds for it.
 */
async function changeIndex(archive) {
  const bytes = await fs.readFile(archive);
  const length = bytes.readUInt32LE(12);
  const at = bytes.indexOf('"hash":"', 16, 'latin1') + '"hash":"'.length;
  if (at < '"hash":"'.length || at >= 16 + length) {
    throw new CannotCheck(`${archive} has no file digests in it`);
  }
  bytes[at] = bytes[at] === 0x30 ? 0x31 : 0x30;
  await fs.writeFile(archive, bytes);
}

/** 0 when the changed archive was refused, 1 when it was not. */
async function check(work) {
  const asBuilt = path.join(work, 'as-built');
  const changed = path.join(work, 'changed');
  try {
    await fs.cp(unpacked, asBuilt, { recursive: true });
    await fs.cp(unpacked, changed, { recursive: true });
  } catch (err) {
    throw new CannotCheck(`could not copy ${unpacked}: ${err?.message ?? err}`);
  }
  await changeIndex(path.join(changed, 'resources', 'app.asar'));

  const first = await run(path.join(asBuilt, programName));
  if (first !== null) {
    console.error(first.said);
    throw new CannotCheck(
      `the program as it was built did not stay up (exit ${first.code ?? first.signal}), ` +
        'so a refusal of the changed one would prove nothing',
    );
  }
  console.log(`  OK      as built, it stayed up for ${STAYS_UP_MS / 1000} s`);

  const second = await run(path.join(changed, programName));
  if (second === null) {
    console.error('::error::with its app.asar changed, the program started and stayed up');
    return 1;
  }
  if (second.code === 0) {
    // A launcher that leaves by itself with nothing wrong has not been stopped:
    // another one already running is the usual reason.
    console.error(second.said);
    console.error('::error::with its app.asar changed, the program left by itself, with 0');
    return 1;
  }
  console.log(second.said.trim());
  console.log(
    `  OK      with its app.asar changed, it was stopped (exit ${second.code ?? second.signal})`,
  );
  return 0;
}

const work = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-asar-'));
let outcome = 2;
try {
  outcome = await check(work);
} catch (err) {
  console.error(`::error::${err instanceof CannotCheck ? err.message : (err?.stack ?? err)}`);
} finally {
  await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
}
process.exit(outcome);
