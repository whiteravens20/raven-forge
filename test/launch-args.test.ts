import { describe, it, expect } from 'vitest';
import {
  getMojangOsName,
  ruleMatches,
  resolveConditionalArgs,
  substituteVars,
} from '../src/core/minecraft/launch-args';
import type { ConditionalArg } from '../src/core/minecraft/types';

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
    expect(ruleMatches({ action: 'allow' }, {}, 'linux')).toBe(true);
  });

  it('matches on os name', () => {
    expect(ruleMatches({ action: 'allow', os: { name: 'osx' } }, {}, 'osx')).toBe(true);
    expect(ruleMatches({ action: 'allow', os: { name: 'osx' } }, {}, 'linux')).toBe(false);
  });

  it('requires every feature condition to hold', () => {
    const rule = {
      action: 'allow' as const,
      features: { has_custom_resolution: true, is_demo_user: false },
    };
    expect(ruleMatches(rule, { has_custom_resolution: true, is_demo_user: false }, 'linux')).toBe(
      true,
    );
    expect(ruleMatches(rule, { has_custom_resolution: false, is_demo_user: false }, 'linux')).toBe(
      false,
    );
  });

  it('treats an unknown feature as off rather than ignoring the condition', () => {
    // Mojang adds feature flags over time. An unknown one defaulting to "true"
    // would switch on arguments for a mode the launcher does not implement.
    const requiresUnknown = { action: 'allow' as const, features: { is_quick_play_realms: true } };
    expect(ruleMatches(requiresUnknown, {}, 'linux')).toBe(false);

    const forbidsUnknown = { action: 'allow' as const, features: { is_quick_play_realms: false } };
    expect(ruleMatches(forbidsUnknown, {}, 'linux')).toBe(true);
  });
});

describe('resolveConditionalArgs', () => {
  it('passes plain strings through untouched', () => {
    expect(resolveConditionalArgs(['--username', '${auth_player_name}'], {}, 'linux')).toEqual([
      '--username',
      '${auth_player_name}',
    ]);
  });

  it('drops a conditional arg whose rules do not match', () => {
    const arg: ConditionalArg = {
      rules: [{ action: 'allow', os: { name: 'osx' } }],
      value: '-XstartOnFirstThread',
    };
    expect(resolveConditionalArgs([arg], {}, 'linux')).toEqual([]);
    expect(resolveConditionalArgs([arg], {}, 'osx')).toEqual(['-XstartOnFirstThread']);
  });

  it('flattens an array value', () => {
    const arg: ConditionalArg = {
      rules: [{ action: 'allow', features: { has_custom_resolution: true } }],
      value: ['--width', '${resolution_width}', '--height', '${resolution_height}'],
    };
    expect(resolveConditionalArgs([arg], { has_custom_resolution: true }, 'linux')).toEqual([
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
    expect(resolveConditionalArgs([arg], {}, 'linux')).toEqual(['-Dfoo=bar']);
    expect(resolveConditionalArgs([arg], {}, 'osx')).toEqual([]);
  });

  it('ignores a non-matching disallow rather than treating it as an allow', () => {
    const arg: ConditionalArg = {
      rules: [{ action: 'disallow', os: { name: 'windows' } }],
      value: '-Dfoo=bar',
    };
    expect(resolveConditionalArgs([arg], {}, 'linux')).toEqual([]);
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
