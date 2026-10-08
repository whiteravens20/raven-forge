// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

/**
 * Turning a version meta's argument lists into an actual command line.
 *
 * Split out of `game-launcher.ts` because none of it touches the filesystem,
 * the network or a child process: given a version meta and a feature set it is
 * a pure function, and getting the rules wrong here is how a game launches with
 * the wrong classpath or a missing token. That makes it worth testing directly.
 */

import { MAX_GAME_DIMENSION, MIN_GAME_HEIGHT, MIN_GAME_WIDTH } from '../../shared/constants';
import type { ConditionalArg, Rule } from './types';

/** A dimension the game could actually be given. */
function usable(value: number | undefined, min: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= MAX_GAME_DIMENSION
  );
}

/**
 * The window size to launch at, or null for "let the game choose".
 *
 * Both or neither, and that rule is Mojang's rather than ours: the version meta
 * gates `--width` and `--height` behind a single `has_custom_resolution`
 * feature. A width with no height is therefore not half a setting — it is no
 * setting at all, and the `${resolution_width}` template variable would quietly
 * pair the one that was set with the 854×480 default for the one that was not.
 *
 * The bounds are re-checked here rather than trusted from the profile because
 * `profiles.json` is read back without being validated: the schema polices what
 * the editor writes, not what a hand-edited file says, and these two numbers go
 * into the game's own argument list.
 */
export function customResolution(
  width: number | undefined,
  height: number | undefined,
): { width: number; height: number } | null {
  if (!usable(width, MIN_GAME_WIDTH) || !usable(height, MIN_GAME_HEIGHT)) return null;
  return { width, height };
}

/** Mojang's own platform names, which differ from Node's on two of three. */
export function getMojangOsName(platform: NodeJS.Platform = process.platform): string {
  switch (platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'osx';
    default:
      return 'linux';
  }
}

/** Mojang's names for the processor, as its rules spell them. */
function mojangArch(arch: string = process.arch): string {
  return arch === 'ia32' ? 'x86' : arch;
}

/** The machine a rule is asked about. The default is this one. */
export interface RuleHost {
  osName: string;
  arch: string;
}

const thisHost = (): RuleHost => ({ osName: getMojangOsName(), arch: mojangArch() });

/**
 * Every condition on a rule must hold; an unknown feature is off, not ignored.
 *
 * `os.version` is the one condition not evaluated. Mojang has used two patterns
 * for it: `^10\.` on Windows, which holds on every Windows this launcher runs
 * on, and one for OS X 10.5. Evaluating it would mean compiling a pattern that
 * arrives as JSON off the network, for an answer that cannot differ.
 */
export function ruleMatches(
  rule: Rule,
  features: Record<string, boolean>,
  host: RuleHost = thisHost(),
): boolean {
  if (rule.os?.name && rule.os.name !== host.osName) return false;
  // Read as "any processor" before this, so the `-Xss1M` meant for 32-bit
  // Windows went onto every command line.
  if (rule.os?.arch && rule.os.arch !== host.arch) return false;
  for (const [name, required] of Object.entries(rule.features ?? {})) {
    if ((features[name] ?? false) !== required) return false;
  }
  return true;
}

/**
 * Whether a list of rules lets something through: an argument, or a library.
 *
 * Later matching rules override earlier ones, so a disallow can veto; nothing
 * matching at all means no.
 */
export function rulesAllow(
  rules: Rule[],
  features: Record<string, boolean> = {},
  host: RuleHost = thisHost(),
): boolean {
  let allowed = false;
  for (const rule of rules) {
    if (ruleMatches(rule, features, host)) allowed = rule.action === 'allow';
  }
  return allowed;
}

export function resolveConditionalArgs(
  args: Array<string | ConditionalArg>,
  features: Record<string, boolean>,
  host: RuleHost = thisHost(),
): string[] {
  const result: string[] = [];
  for (const arg of args) {
    if (typeof arg === 'string') {
      result.push(arg);
      continue;
    }
    if (rulesAllow(arg.rules, features, host)) {
      if (Array.isArray(arg.value)) result.push(...arg.value);
      else result.push(arg.value);
    }
  }
  return result;
}

/** The feature a version's own arguments keep `--quickPlayMultiplayer` behind. */
export const JOINS_BY_QUICK_PLAY = 'is_quick_play_multiplayer';

/**
 * Whether a version is told which server to join with `--quickPlayMultiplayer`.
 *
 * Minecraft 1.20 brought that option in and took `--server` and `--port` out,
 * and the game says nothing about an option it does not know. So the old pair,
 * handed to a newer game, was a quick connect that started the game and joined
 * nothing — on every version from 1.20 on.
 *
 * A version that takes the new option lists it among its own arguments, behind
 * a feature a launcher switches on. The version is asked, then, and no table of
 * release numbers is kept.
 */
export function takesQuickPlayMultiplayer(
  args: Array<string | ConditionalArg> | undefined,
): boolean {
  return (args ?? []).some(
    (arg) =>
      typeof arg !== 'string' &&
      arg.rules.some((rule) => rule.features?.[JOINS_BY_QUICK_PLAY] === true),
  );
}

/**
 * A server as the one argument `--quickPlayMultiplayer` takes: the address,
 * and after a colon the port when the profile names one.
 *
 * An address that already ends in a port is left as it is. A bare IPv6 address
 * is given its brackets first, without which the port would read as one more
 * group of it.
 */
export function quickPlayAddress(host: string, port: number | undefined): string {
  if (port === undefined) return host;
  const colons = host.split(':').length - 1;
  if (host.startsWith('[')) return host.includes(']:') ? host : `${host}:${port}`;
  if (colons === 1) return host;
  return colons > 1 ? `[${host}]:${port}` : `${host}:${port}`;
}

/**
 * Split a line of JVM arguments the way a shell would: on blanks, except inside
 * quotes, which group and are then dropped.
 *
 * Splitting on every blank turned `-Dname="a b"` into two arguments, and the
 * second of them — `b"` — landed where the JVM expects the main class.
 */
export function splitArguments(line: string): string[] {
  const args: string[] = [];
  let current = '';
  let started = false;
  let quote: string | null = null;
  for (const char of line) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) args.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) args.push(current);
  return args;
}

export function substituteVars(args: string[], vars: Record<string, string>): string[] {
  return args.map((arg) => arg.replace(/\$\{(\w+)}/g, (_, key: string) => vars[key] ?? ''));
}
