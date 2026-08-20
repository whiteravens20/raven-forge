import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Baking the build-time application IDs into a packaged build.
 *
 * This step runs in exactly one place — a release build with the secrets set —
 * which is the one build nobody runs twice. Everything about it therefore fails
 * late and expensively: a renamed source file, a changed `outDir`, a typo in a
 * repository secret. The release workflow greps for the placeholder afterwards
 * and fails the release, which is the right backstop and a terrible first line
 * of defence.
 *
 * The interesting one is the third test. The same literal appears twice in the
 * tree on purpose: once as the value to be replaced, and once as the sentinel
 * `microsoft-auth.ts` compares that value against to decide whether this build
 * has a Microsoft registration at all. A rewrite that reached both would leave
 * them equal, and an app with a perfectly good client ID would go on telling
 * everyone that Microsoft login is unavailable in this build.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const script = path.join(repo, 'scripts', 'inject-build-ids.mjs');

const AZURE = 'REPLACE_WITH_YOUR_AZURE_CLIENT_ID';
const DISCORD = 'REPLACE_WITH_YOUR_DISCORD_APP_ID';
const clientTarget = path.join('dist', 'core', 'auth', 'build-config.js');
const discordTarget = path.join('dist', 'core', 'discord', 'build-config.js');
const sentinelFile = path.join('dist', 'core', 'auth', 'microsoft-auth.js');

let stage: string;

/** Run the injector over the staged `dist/`, as `npm run build:main` would. */
function inject(env: Record<string, string>): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [script],
      // A deliberately bare environment: an ID exported in the shell running
      // the suite would otherwise decide what this tests.
      { cwd: stage, env: { PATH: process.env.PATH ?? '', ...env } },
      (err, _stdout, stderr) => {
        resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stderr });
      },
    );
  });
}

async function stageFile(relative: string, contents: string): Promise<void> {
  const full = path.join(stage, relative);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, contents);
}

const read = (relative: string) => fs.readFile(path.join(stage, relative), 'utf-8');

beforeEach(async () => {
  stage = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-inject-'));
  await stageFile(clientTarget, `export const BUILD_CLIENT_ID = '${AZURE}';\n`);
  await stageFile(discordTarget, `export const BUILD_DISCORD_APP_ID = '${DISCORD}';\n`);
  await stageFile(sentinelFile, `const MS_CLIENT_ID_PLACEHOLDER = '${AZURE}';\n`);
});

afterEach(async () => {
  await fs.rm(stage, { recursive: true, force: true });
});

describe('inject-build-ids', () => {
  it('rewrites the file each ID lives in', async () => {
    const { code } = await inject({
      RAVENFORGE_CLIENT_ID: '00000000-1111-2222-3333-444444444444',
      RAVENFORGE_DISCORD_APP_ID: '123456789012345678',
    });

    expect(code).toBe(0);
    expect(await read(clientTarget)).toContain('00000000-1111-2222-3333-444444444444');
    expect(await read(discordTarget)).toContain('123456789012345678');
  });

  it('leaves the sentinel the app checks itself against alone', async () => {
    await inject({ RAVENFORGE_CLIENT_ID: '00000000-1111-2222-3333-444444444444' });

    // If this ever fails, the build still works and Microsoft login quietly
    // stops being offered: `BUILD_CLIENT_ID === MS_CLIENT_ID_PLACEHOLDER` would
    // be comparing the real ID against itself.
    expect(await read(sentinelFile)).toContain(AZURE);
  });

  it('injects one ID without disturbing the other', async () => {
    await inject({ RAVENFORGE_CLIENT_ID: '00000000-1111-2222-3333-444444444444' });
    expect(await read(discordTarget)).toContain(DISCORD);
  });

  it('succeeds and changes nothing when neither variable is set', async () => {
    // CI has neither ID, and those builds must still produce a runnable app.
    const { code } = await inject({});
    expect(code).toBe(0);
    expect(await read(clientTarget)).toContain(AZURE);
    expect(await read(discordTarget)).toContain(DISCORD);
  });

  it('refuses a client ID that is not a GUID', async () => {
    // A wrong ID surfaces as an opaque AADSTS error on the consent screen, in
    // a build that has already been signed and published by then.
    const { code, stderr } = await inject({ RAVENFORGE_CLIENT_ID: 'my-client-id' });
    expect(code).toBe(1);
    expect(stderr).toMatch(/malformed/);
    expect(await read(clientTarget)).toContain(AZURE);
  });

  it('refuses a Discord ID that is not a snowflake', async () => {
    const { code } = await inject({ RAVENFORGE_DISCORD_APP_ID: '12345' });
    expect(code).toBe(1);
    expect(await read(discordTarget)).toContain(DISCORD);
  });

  it('fails when the placeholder is not where it should be', async () => {
    // Either the build did not run or the literal moved. Both are worth
    // stopping for: the alternative is a signed release that silently has no
    // client ID in it.
    await stageFile(clientTarget, 'export const BUILD_CLIENT_ID = "already something else";\n');
    const { code, stderr } = await inject({
      RAVENFORGE_CLIENT_ID: '00000000-1111-2222-3333-444444444444',
    });
    expect(code).toBe(1);
    expect(stderr).toMatch(/No placeholder/);
  });
});

describe('the placeholders themselves', () => {
  it('are still in the source files the injector names', async () => {
    // The injector addresses compiled output by path. A source file renamed or
    // moved compiles perfectly and only fails during a release build, hours
    // later and on somebody else's machine.
    for (const [target, placeholder] of [
      [clientTarget, AZURE],
      [discordTarget, DISCORD],
    ] as const) {
      const source = path.join(repo, target.replace(/^dist/, 'src').replace(/\.js$/, '.ts'));
      expect(await fs.readFile(source, 'utf-8')).toContain(placeholder);
    }
  });
});
