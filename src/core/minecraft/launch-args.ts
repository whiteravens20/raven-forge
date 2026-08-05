/**
 * Turning a version meta's argument lists into an actual command line.
 *
 * Split out of `game-launcher.ts` because none of it touches the filesystem,
 * the network or a child process: given a version meta and a feature set it is
 * a pure function, and getting the rules wrong here is how a game launches with
 * the wrong classpath or a missing token. That makes it worth testing directly.
 */

import type { ConditionalArg, Rule } from './types';

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

/** Every condition on a rule must hold; an unknown feature is off, not ignored. */
export function ruleMatches(
  rule: Rule,
  features: Record<string, boolean>,
  osName: string = getMojangOsName(),
): boolean {
  if (rule.os?.name && rule.os.name !== osName) return false;
  for (const [name, required] of Object.entries(rule.features ?? {})) {
    if ((features[name] ?? false) !== required) return false;
  }
  return true;
}

export function resolveConditionalArgs(
  args: Array<string | ConditionalArg>,
  features: Record<string, boolean>,
  osName: string = getMojangOsName(),
): string[] {
  const result: string[] = [];
  for (const arg of args) {
    if (typeof arg === 'string') {
      result.push(arg);
      continue;
    }
    // Later matching rules override earlier ones, so a disallow can veto.
    let allowed = false;
    for (const rule of arg.rules) {
      if (ruleMatches(rule, features, osName)) allowed = rule.action === 'allow';
    }
    if (allowed) {
      if (Array.isArray(arg.value)) result.push(...arg.value);
      else result.push(arg.value);
    }
  }
  return result;
}

export function substituteVars(args: string[], vars: Record<string, string>): string[] {
  return args.map((arg) => arg.replace(/\$\{(\w+)}/g, (_, key: string) => vars[key] ?? ''));
}
