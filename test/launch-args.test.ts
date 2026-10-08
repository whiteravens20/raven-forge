// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import {
  getMojangOsName,
  quickPlayAddress,
  resolveConditionalArgs,
  ruleMatches,
  rulesAllow,
  splitArguments,
  substituteVars,
  takesQuickPlayMultiplayer,
  type RuleHost,
} from '../src/core/minecraft/launch-args';
import type { ConditionalArg } from '../src/core/minecraft/types';

const linux: RuleHost = { osName: 'linux', arch: 'x64' };
const osx: RuleHost = { osName: 'osx', arch: 'arm64' };

describe('getMojangOsName', () => {
  it('maps Node platform names to Mojang ones', () => {
    expect(getMojangOsName('win32')).toBe('windows');
    expect(getMojangOsName('darwin')).toBe('osx');
    expect(getMojangOsName('linux')).toBe('linux');
  });

  it('treats anything unfamiliar as linux', () => {
    expect(getMojangOsName('freebsd')).toBe('linux');
  });
});

describe('ruleMatches', () => {
  it('matches a rule with no conditions', () => {
    expect(ruleMatches({ action: 'allow' }, {}, linux)).toBe(true);
  });

  it('matches on os name', () => {
    expect(ruleMatches({ action: 'allow', os: { name: 'osx' } }, {}, osx)).toBe(true);
    expect(ruleMatches({ action: 'allow', os: { name: 'osx' } }, {}, linux)).toBe(false);
  });

  it('requires every feature condition to hold', () => {
    const rule = {
      action: 'allow' as const,
      features: { has_custom_resolution: true, is_demo_user: false },
    };
    expect(ruleMatches(rule, { has_custom_resolution: true, is_demo_user: false }, linux)).toBe(
      true,
    );
    expect(ruleMatches(rule, { has_custom_resolution: false, is_demo_user: false }, linux)).toBe(
      false,
    );
  });

  it('treats an unknown feature as off rather than ignoring the condition', () => {
    // Mojang adds feature flags over time. An unknown one defaulting to "true"
    // would switch on arguments for a mode the launcher does not implement.
    const requiresUnknown = { action: 'allow' as const, features: { is_quick_play_realms: true } };
    expect(ruleMatches(requiresUnknown, {}, linux)).toBe(false);

    const forbidsUnknown = { action: 'allow' as const, features: { is_quick_play_realms: false } };
    expect(ruleMatches(forbidsUnknown, {}, linux)).toBe(true);
  });
});

describe('rulesAllow', () => {
  it('reads a processor condition instead of taking it as "any"', () => {
    // The one Mojang ships: a thread stack size for 32-bit Windows, which used
    // to land on every command line.
    const only32bit = [{ action: 'allow' as const, os: { arch: 'x86' } }];
    expect(rulesAllow(only32bit, {}, linux)).toBe(false);
    expect(rulesAllow(only32bit, {}, { osName: 'windows', arch: 'x86' })).toBe(true);
  });

  it('lets a later rule veto an earlier one, as a library list does', () => {
    // 1.16.5 names LWJGL this way: for everything, then not for macOS.
    const rules = [
      { action: 'allow' as const },
      { action: 'disallow' as const, os: { name: 'osx' } },
    ];
    expect(rulesAllow(rules, {}, linux)).toBe(true);
    expect(rulesAllow(rules, {}, osx)).toBe(false);
  });

  it('allows nothing when no rule matches', () => {
    expect(rulesAllow([{ action: 'allow', os: { name: 'osx' } }], {}, linux)).toBe(false);
  });
});

describe('resolveConditionalArgs', () => {
  it('passes plain strings through untouched', () => {
    expect(resolveConditionalArgs(['--username', '${auth_player_name}'], {}, linux)).toEqual([
      '--username',
      '${auth_player_name}',
    ]);
  });

  it('drops a conditional arg whose rules do not match', () => {
    const arg: ConditionalArg = {
      rules: [{ action: 'allow', os: { name: 'osx' } }],
      value: '-XstartOnFirstThread',
    };
    expect(resolveConditionalArgs([arg], {}, linux)).toEqual([]);
    expect(resolveConditionalArgs([arg], {}, osx)).toEqual(['-XstartOnFirstThread']);
  });

  it('flattens an array value', () => {
    const arg: ConditionalArg = {
      rules: [{ action: 'allow', features: { has_custom_resolution: true } }],
      value: ['--width', '${resolution_width}', '--height', '${resolution_height}'],
    };
    expect(resolveConditionalArgs([arg], { has_custom_resolution: true }, linux)).toEqual([
      '--width',
      '${resolution_width}',
      '--height',
      '${resolution_height}',
    ]);
  });

  it('lets a later disallow veto an earlier allow', () => {
    // This is how Mojang expresses "on macOS, except on this architecture".
    const arg: ConditionalArg = {
      rules: [{ action: 'allow' }, { action: 'disallow', os: { name: 'osx' } }],
      value: '-Dfoo=bar',
    };
    expect(resolveConditionalArgs([arg], {}, linux)).toEqual(['-Dfoo=bar']);
    expect(resolveConditionalArgs([arg], {}, osx)).toEqual([]);
  });

  it('ignores a non-matching disallow rather than treating it as an allow', () => {
    const arg: ConditionalArg = {
      rules: [{ action: 'disallow', os: { name: 'windows' } }],
      value: '-Dfoo=bar',
    };
    expect(resolveConditionalArgs([arg], {}, linux)).toEqual([]);
  });
});

describe('splitArguments', () => {
  it('splits on blanks, however many', () => {
    expect(splitArguments('  -Xss2M   -XX:+UseG1GC\t-Dfoo=bar ')).toEqual([
      '-Xss2M',
      '-XX:+UseG1GC',
      '-Dfoo=bar',
    ]);
  });

  it('keeps what is inside quotes together and drops the quotes', () => {
    expect(splitArguments(`-Dname="a b" -Dpath='C:\\My Games\\x'`)).toEqual([
      '-Dname=a b',
      '-Dpath=C:\\My Games\\x',
    ]);
  });

  it('keeps an argument that is deliberately empty', () => {
    expect(splitArguments('-Dempty "" -Dafter')).toEqual(['-Dempty', '', '-Dafter']);
  });

  it('answers with nothing for a line of blanks', () => {
    expect(splitArguments('   ')).toEqual([]);
  });

  it('takes an unclosed quote to run to the end', () => {
    expect(splitArguments('-Dname="a b')).toEqual(['-Dname=a b']);
  });
});

describe('substituteVars', () => {
  it('replaces ${…} placeholders', () => {
    expect(
      substituteVars(['--username', '${auth_player_name}'], { auth_player_name: 'pavlojs' }),
    ).toEqual(['--username', 'pavlojs']);
  });

  it('replaces several placeholders in one argument', () => {
    expect(substituteVars(['${a}/${b}'], { a: 'x', b: 'y' })).toEqual(['x/y']);
  });

  it('substitutes an unknown placeholder with the empty string', () => {
    // Leaving the literal `${…}` in place would hand Minecraft a nonsense
    // value; an empty one at least fails predictably.
    expect(substituteVars(['--token', '${nope}'], {})).toEqual(['--token', '']);
  });

  it('leaves text that is not a placeholder alone', () => {
    expect(substituteVars(['-Xmx4096M', '$notaplaceholder', '{also_not}'], { a: '1' })).toEqual([
      '-Xmx4096M',
      '$notaplaceholder',
      '{also_not}',
    ]);
  });
});

/**
 * Minecraft 1.20 replaced `--server` and `--port` with `--quickPlayMultiplayer`
 * and took the old pair out. The game does not complain about an option it does
 * not know, so a quick connect went on starting every newer version and joining
 * nothing.
 */
describe('takesQuickPlayMultiplayer', () => {
  // As Mojang's own metadata lists it, from 1.20 to 26.3.
  const sinceQuickPlay = [
    '--username',
    '${auth_player_name}',
    { rules: [{ action: 'allow' as const, features: { is_demo_user: true } }], value: '--demo' },
    {
      rules: [{ action: 'allow' as const, features: { is_quick_play_multiplayer: true } }],
      value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'],
    },
  ];

  it('is what a version that lists the argument does', () => {
    expect(takesQuickPlayMultiplayer(sinceQuickPlay)).toBe(true);
  });

  it('is not what a version from before it does', () => {
    // 1.13 to 1.19.4: conditional arguments, and none of them this one.
    expect(takesQuickPlayMultiplayer(sinceQuickPlay.slice(0, 3))).toBe(false);
    // Up to 1.12.2: one line of arguments and no list at all.
    expect(takesQuickPlayMultiplayer(undefined)).toBe(false);
  });

  it('is switched on by exactly the feature the argument waits for', () => {
    const on = resolveConditionalArgs(sinceQuickPlay, { is_quick_play_multiplayer: true });
    expect(on.slice(-2)).toEqual(['--quickPlayMultiplayer', '${quickPlayMultiplayer}']);
    expect(resolveConditionalArgs(sinceQuickPlay, {})).toEqual([
      '--username',
      '${auth_player_name}',
    ]);
  });
});

describe('quickPlayAddress', () => {
  it('is the address alone when the profile names no port', () => {
    expect(quickPlayAddress('mc.whiteravens.net', undefined)).toBe('mc.whiteravens.net');
    expect(quickPlayAddress('::1', undefined)).toBe('::1');
  });

  it('carries the port after a colon', () => {
    expect(quickPlayAddress('mc.whiteravens.net', 25570)).toBe('mc.whiteravens.net:25570');
    expect(quickPlayAddress('192.168.2.20', 25565)).toBe('192.168.2.20:25565');
  });

  it('puts a bare IPv6 address in brackets before its port', () => {
    expect(quickPlayAddress('2001:db8::20', 25565)).toBe('[2001:db8::20]:25565');
    expect(quickPlayAddress('[2001:db8::20]', 25565)).toBe('[2001:db8::20]:25565');
  });

  it('leaves alone an address that came with a port of its own', () => {
    expect(quickPlayAddress('mc.whiteravens.net:25570', 25565)).toBe('mc.whiteravens.net:25570');
    expect(quickPlayAddress('[2001:db8::20]:25570', 25565)).toBe('[2001:db8::20]:25570');
  });
});
