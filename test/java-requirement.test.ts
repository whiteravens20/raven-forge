// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import { parseJavaVersion, requiredJavaFor } from '../src/core/minecraft/java-requirement';

/**
 * The version meta is JSON fetched from Mojang, and `requiredJavaFor` is the
 * only place it is turned into a Java version. Whatever comes out of here
 * becomes a directory name in `jre-<n>/bin/java` that the launcher executes and
 * a path segment in the Adoptium download URL, so "it is typed `number`" is not
 * a guarantee — the type describes what the JSON is supposed to contain.
 *
 * The first group is the behaviour players depend on. The second is what stops
 * a hostile or corrupted version meta from picking the binary we run.
 */
describe('requiredJavaFor', () => {
  it('believes the version meta when it states a Java version', () => {
    expect(
      requiredJavaFor('1.20.4', { javaVersion: { component: 'java-runtime', majorVersion: 17 } }),
    ).toBe(17);
    expect(
      requiredJavaFor('1.21', { javaVersion: { component: 'java-runtime', majorVersion: 21 } }),
    ).toBe(21);
  });

  it.each([
    // What Mojang's own metadata states for each of these.
    ['1.2.5', 8],
    ['1.6.4', 8],
    ['1.8.9', 8],
    ['1.16.5', 8],
    ['1.17', 16],
    ['1.17.1', 16],
    ['1.18', 17],
    ['1.20.4', 17],
    ['1.20.5', 21],
    ['1.21', 21],
    ['1.21.11', 21],
    ['26.1', 25],
    ['26.3', 25],
  ])('knows by rule that %s needs Java %i when no metadata says', (version, java) => {
    expect(requiredJavaFor(version)).toBe(java);
  });

  it('answers with the newest for something that is not a release number', () => {
    // A snapshot. Its metadata is what a launch reads; this is only what the
    // profile editor says before that has ever been fetched.
    expect(requiredJavaFor('26.4-snapshot-2')).toBe(25);
    expect(requiredJavaFor('25w14a')).toBe(25);
  });

  it.each([
    ['a path traversal', '../../../../usr/bin/evil'],
    ['a relative segment', '..'],
    ['a shell fragment', '21; rm -rf ~'],
    ['a separator', '21/../../x'],
    ['an object', { toString: () => '21' }],
    ['null', null],
    ['a NaN', Number.NaN],
    ['an infinity', Number.POSITIVE_INFINITY],
    ['a fraction', 17.5],
    ['a negative', -21],
    ['zero', 0],
    ['an implausible major', 4096],
  ])('ignores %s in the version meta and goes by the version', (_label, majorVersion) => {
    const meta = { javaVersion: { component: 'java-runtime', majorVersion } } as never;
    // 1.8.9 needs Java 8 and nothing here says 8, so a rejected value shows.
    expect(requiredJavaFor('1.8.9', meta)).toBe(8);
  });

  it('rejects a stated version rather than coercing it to a nearby number', () => {
    // parseInt('21abc') is 21, and that is the one string worth being explicit
    // about: it is not a valid major version, and accepting it would mean the
    // value reaching the path is not the value the meta contained.
    const meta = { javaVersion: { component: 'java-runtime', majorVersion: '21abc' } } as never;
    expect(requiredJavaFor('1.20.4', meta)).toBe(17);
  });
});

/**
 * What a binary says it is, read from real `java -version` output.
 *
 * Two eras with two shapes — `1.8.0_392` and `21.0.5` — and the launcher has to
 * accept both, since a 1.8 profile wants the first and a 1.21 profile the
 * second. Getting the old form wrong reads Java 8 as Java 1, which is a version
 * no check would ever be satisfied by.
 */
describe('parseJavaVersion', () => {
  it('reads the modern form', () => {
    expect(
      parseJavaVersion(
        'openjdk version "21.0.5" 2024-10-15\nOpenJDK Runtime Environment Temurin-21.0.5+11',
      ),
    ).toBe(21);
    expect(parseJavaVersion('java version "17.0.9" 2023-10-17 LTS')).toBe(17);
  });

  it('reads the 1.x form as the version after the dot', () => {
    expect(
      parseJavaVersion(
        'openjdk version "1.8.0_392"\nOpenJDK Runtime Environment (build 1.8.0_392-b08)',
      ),
    ).toBe(8);
  });

  it('does not care which JVM it is', () => {
    expect(
      parseJavaVersion(
        'openjdk version "21.0.2" 2024-01-16\nOpenJDK Runtime Environment GraalVM CE 21.0.2+13.1',
      ),
    ).toBe(21);
  });

  it('says nothing when the output is not a Java runtime announcing itself', () => {
    expect(parseJavaVersion('')).toBeNull();
    expect(parseJavaVersion('bash: java: command not found')).toBeNull();
    expect(parseJavaVersion('Python 3.13.1')).toBeNull();
    // A quoted version that is not a number at all: `parseInt` would answer
    // NaN, which would then be compared against the requirement and lose.
    expect(parseJavaVersion('openjdk version "x.y.z"')).toBeNull();
  });
});
