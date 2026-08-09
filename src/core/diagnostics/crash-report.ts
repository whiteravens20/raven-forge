// One file per crash, containing everything a bug report needs and nothing
// that identifies the player. See `writeCrashReport` for what "nothing" means.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { app } from 'electron';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import type { Profile } from '../../shared/ipc-types';

/** How many crash files to keep before the oldest start being deleted. */
const KEEP_REPORTS = 20;

/** Lines of Minecraft's own crash report to quote. The exception is at the top. */
const MC_CRASH_LINES = 300;

/**
 * A Microsoft session token, wherever it turns up.
 *
 * The launcher passes one to the game as `--accessToken`, and a mod that logs
 * its arguments — or a stack trace that includes them — puts it in the game
 * output this report quotes. It is a live credential to the player's Minecraft
 * account, and the whole point of this file is that it can be attached to a
 * public issue without thinking about it.
 */
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

/** The same thing again, for a token that is not a JWT and would survive above. */
const CREDENTIAL_ARG_PATTERN =
  /(--(?:accessToken|clientId|xuid|uuid|username|session)[=\s]+)(\S+)/gi;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip credentials and personal details out of anything before it is written.
 *
 * `secrets` are the values this launch is known to have used — the access
 * token, the account UUID, the player name. They are matched literally because
 * a UUID pattern also matches half the identifiers a modded game logs, and a
 * player name is whatever the player chose.
 *
 * Values shorter than three characters are skipped: a two-letter player name
 * would otherwise redact a substring of every other word in the log and leave
 * behind something nobody can read.
 */
export function redactSecrets(text: string, secrets: string[] = []): string {
  let out = text.replace(JWT_PATTERN, '<redacted>').replace(CREDENTIAL_ARG_PATTERN, '$1<redacted>');

  for (const secret of secrets) {
    if (secret.length < 3) continue;
    out = out.replace(new RegExp(escapeRegExp(secret), 'gi'), '<redacted>');
  }

  // Windows puts the account name in every absolute path — `C:\Users\Jan
  // Kowalski\AppData\…` — and so does a Linux home directory. The paths still
  // have to be readable to be useful, so only the home prefix goes.
  const home = os.homedir();
  if (home.length >= 3) {
    out = out.replace(new RegExp(escapeRegExp(home), 'gi'), '~');
  }

  return out;
}

export interface CrashReportInput {
  profile: Profile;
  exitCode: number;
  playTimeMinutes: number;
  /** `Date.now()` at spawn, so the game's own crash file can be matched to this run. */
  startedAt: number;
  /** The game's last output, as `getLogTail` returned it. */
  logTail: string[];
  /** Set when the process never started at all, in which case it is the whole finding. */
  spawnError?: string;
  /** Where the game actually ran — a profile can point somewhere else entirely. */
  gameDir: string;
  java: { path: string; version?: number; vendor?: string; managed?: boolean };
  accountType: string;
  /** Whether this particular launch went online, which is not the global setting. */
  offlineLaunch: boolean;
  /** Values to redact — token, UUID, player name. See `redactSecrets`. */
  secrets: string[];
  /**
   * The game's own crash file, already read by the caller.
   *
   * The exit handler has to read it before it can tell a crash from a shutdown
   * that overran, so it hands the result over rather than have this read the
   * same file a second time. Absent when the process never started.
   */
  minecraftCrash?: { file: string; content: string };
}

function field(label: string, value: string | number | undefined | null): string {
  return `${label}: ${value === undefined || value === null || value === '' ? '—' : value}`;
}

/**
 * Minecraft's own description for "the window closed, but the JVM would not".
 *
 * After the main loop ends, the client starts a watchdog; if the process is
 * still alive when it fires, the watchdog dumps every thread, writes this crash
 * report and halts the JVM — which reaches the launcher as a non-zero exit.
 *
 * The session was already over by then. It is almost always a mod that left a
 * non-daemon thread pool running, so the JVM had nothing left to do and no
 * permission to leave, and nothing the player did or lost has anything to do
 * with it. See `isShutdownWatchdogCrash`.
 */
const SHUTDOWN_WATCHDOG_DESCRIPTION = 'Client shutdown from post-main';

/**
 * Whether the game's crash file is the shutdown watchdog rather than a crash.
 *
 * Matched on Mojang's own description string, not on the exit code: the code is
 * just `halt()`'s argument and says nothing about why. A real crash that
 * happened to use the same code still reports as one.
 */
export function isShutdownWatchdogCrash(minecraftCrash?: { content: string }): boolean {
  return minecraftCrash?.content.includes(SHUTDOWN_WATCHDOG_DESCRIPTION) ?? false;
}

/**
 * The game's own crash report for this run, if it wrote one.
 *
 * Minecraft writes these itself and they carry the actual exception, which the
 * launcher's stdout tail often does not — a crash during startup can end with
 * nothing more informative than a stack trace scrolled past. Only files touched
 * since the game started count; the directory keeps old ones forever, and the
 * one from last month is worse than none.
 */
export async function readMinecraftCrash(
  gameDir: string,
  startedAt: number,
): Promise<{ file: string; content: string } | undefined> {
  const dir = path.join(gameDir, 'crash-reports');
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return undefined;
  }

  let newest: { file: string; mtimeMs: number } | undefined;
  for (const entry of entries) {
    if (!entry.endsWith('.txt')) continue;
    try {
      const stat = await fs.stat(path.join(dir, entry));
      if (stat.mtimeMs < startedAt) continue;
      if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { file: entry, mtimeMs: stat.mtimeMs };
    } catch {
      // Raced with the game deleting it, or unreadable. Either way, not this one.
    }
  }
  if (!newest) return undefined;

  try {
    const raw = await fs.readFile(path.join(dir, newest.file), 'utf-8');
    const lines = raw.split(/\r?\n/);
    const content =
      lines.length > MC_CRASH_LINES
        ? [
            ...lines.slice(0, MC_CRASH_LINES),
            `… ${lines.length - MC_CRASH_LINES} more lines in ${newest.file}`,
          ].join('\n')
        : raw;
    return { file: newest.file, content };
  } catch {
    return undefined;
  }
}

/** The mods that were actually in the game directory, by file name. */
async function listMods(gameDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path.join(gameDir, 'mods'));
    return entries.filter((e) => e.endsWith('.jar')).sort();
  } catch {
    return [];
  }
}

export function buildCrashReport(
  input: CrashReportInput,
  mods: string[],
  minecraftCrash?: { file: string; content: string },
): string {
  const { profile } = input;
  const sections: string[] = [];

  sections.push(
    [
      '# Raven Forge crash report',
      '',
      'Generated automatically when the game exited with an error. Access tokens,',
      'the account UUID, the player name and the home directory have been replaced',
      'with `<redacted>` — read it through before attaching it anyway.',
      '',
      '## Launcher',
      field('Version', app.getVersion()),
      field('Platform', `${process.platform} ${process.arch}`),
      field('OS', `${os.type()} ${os.release()}`),
      field(
        'Electron / Chrome / Node',
        `${process.versions.electron ?? '—'} / ${process.versions.chrome ?? '—'} / ${process.versions.node}`,
      ),
      field('System RAM', `${Math.round(os.totalmem() / 1024 / 1024)} MB`),
    ].join('\n'),
  );

  sections.push(
    [
      '## Profile',
      field('Minecraft', profile.minecraftVersion),
      field(
        'Mod loader',
        profile.modLoader === 'vanilla'
          ? 'vanilla'
          : `${profile.modLoader} ${profile.modLoaderVersion ?? '(version not recorded)'}`,
      ),
      field(
        'Java',
        `${input.java.version ?? 'unknown version'} — ${input.java.vendor ?? 'not managed by the launcher'} — ${input.java.path}`,
      ),
      field('Allocated RAM', `${profile.allocatedRamMb} MB`),
      field('Custom JVM args', profile.javaArgs),
      field('Manifest', profile.manifestUrl),
      field('Pre-launch command', profile.preLaunchCommand),
      field('Game directory', input.gameDir),
      field(
        'Account type',
        `${input.accountType}${input.offlineLaunch ? ' (launched offline)' : ''}`,
      ),
    ].join('\n'),
  );

  sections.push(
    [
      '## Exit',
      field('Exit code', input.exitCode),
      field('Played', `${input.playTimeMinutes} min`),
      ...(input.spawnError ? [field('The process never started', input.spawnError)] : []),
    ].join('\n'),
  );

  sections.push(
    mods.length > 0
      ? `## Mods (${mods.length})\n\n${mods.join('\n')}`
      : '## Mods\n\nNo jars in the mods directory.',
  );

  if (minecraftCrash) {
    sections.push(
      `## Minecraft crash report (${minecraftCrash.file})\n\n\`\`\`\n${minecraftCrash.content}\n\`\`\``,
    );
  }

  sections.push(
    input.logTail.length > 0
      ? `## Last ${input.logTail.length} lines of game output\n\n\`\`\`\n${input.logTail.join('\n')}\n\`\`\``
      : '## Game output\n\nThe game produced no output before it exited.',
  );

  return redactSecrets(`${sections.join('\n\n')}\n`, input.secrets);
}

/** `White Ravens Classic` → `white-ravens-classic`, for use in a file name. */
function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'profile'
  );
}

/** `2026-08-07T15:46:31.129Z` → `20260807-154631`. */
function stamp(at: number): string {
  return new Date(at).toISOString().replace(/[-:]/g, '').replace(/T/, '-').slice(0, 15);
}

/** Delete all but the newest `KEEP_REPORTS` files, so this never grows forever. */
async function prune(dir: string): Promise<void> {
  const entries = (await fs.readdir(dir)).filter(
    (e) => e.startsWith('crash-') && e.endsWith('.txt'),
  );
  if (entries.length <= KEEP_REPORTS) return;
  // The name ends in a sortable timestamp, so lexical order is chronological.
  for (const stale of entries.sort().slice(0, entries.length - KEEP_REPORTS)) {
    await fs.rm(path.join(dir, stale), { force: true });
  }
}

/**
 * Write the report and answer with its path.
 *
 * Never throws: this runs on the way out of a crashed launch, and failing to
 * write a diagnostic must not turn into a second failure on top of the one the
 * player is already looking at. A problem here is logged and the caller simply
 * gets no path, which the UI reads as "no report to offer".
 */
export async function writeCrashReport(input: CrashReportInput): Promise<string | undefined> {
  try {
    const mods = await listMods(input.gameDir);

    const dir = paths.crashReportsDir;
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `crash-${slug(input.profile.name)}-${stamp(Date.now())}.txt`);
    await fs.writeFile(file, buildCrashReport(input, mods, input.minecraftCrash), 'utf-8');
    await prune(dir);

    log.info(`Wrote crash report for ${input.profile.name} to ${file}`);
    return file;
  } catch (err) {
    log.warn('Could not write a crash report:', err);
    return undefined;
  }
}
