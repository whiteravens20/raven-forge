/**
 * Bake the build-time application IDs into the compiled main process.
 *
 * `tsc` has no `define`-style substitution, so without this step a packaged
 * build ships the placeholders and every user gets the unconfigured behaviour —
 * `process.env` is read at runtime, and end users have no reason to have these
 * variables set. The env vars still win at runtime so a dev run can point a
 * packaged-style build at a different registration.
 *
 * Neither value is a secret; both are injected rather than committed so that a
 * fork rebuilding this repo unchanged declares nothing of ours. See
 * `docs/AZURE-SETUP.md` and `docs/DISCORD-SETUP.md`.
 *
 * A variable that is not set leaves its placeholder alone and says so. Those
 * builds must still succeed — CI has neither ID.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * One placeholder, one target file. Keeping them one-to-one is what stops a
 * `replaceAll` for one ID from touching the sentinel another module compares
 * its own value against.
 */
const INJECTIONS = [
  {
    env: 'RAVENFORGE_CLIENT_ID',
    target: path.join('dist', 'core', 'auth', 'build-config.js'),
    placeholder: 'REPLACE_WITH_YOUR_AZURE_CLIENT_ID',
    // A wrong value here fails at the consent screen with an opaque AADSTS
    // error, which is a miserable thing to debug. Reject it at build time.
    valid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    expected: 'the Application (client) ID from the Azure portal Overview page',
    describe: 'client ID',
    whenAbsent: 'offline-mode-only build.',
  },
  {
    env: 'RAVENFORGE_DISCORD_APP_ID',
    target: path.join('dist', 'core', 'discord', 'build-config.js'),
    placeholder: 'REPLACE_WITH_YOUR_DISCORD_APP_ID',
    // Discord IDs are snowflakes: 17-20 digits, no dashes.
    valid: /^\d{17,20}$/,
    expected: "the Application ID from the Discord portal's General Information page",
    describe: 'Discord application ID',
    whenAbsent: 'the Discord status is unavailable in this build.',
  },
];

for (const injection of INJECTIONS) {
  const value = process.env[injection.env];

  if (!value) {
    console.log(`[inject-build-ids] ${injection.env} not set — ${injection.whenAbsent}`);
    continue;
  }

  if (!injection.valid.test(value)) {
    console.error(
      `[inject-build-ids] ${injection.env} is malformed: ${JSON.stringify(value)}\n` +
        `  Expected ${injection.expected}.`,
    );
    process.exit(1);
  }

  const source = await readFile(injection.target, 'utf8');

  if (!source.includes(injection.placeholder)) {
    console.error(
      `[inject-build-ids] No placeholder in ${injection.target}.\n` +
        '  Either the build did not run, or that file no longer holds the literal.',
    );
    process.exit(1);
  }

  await writeFile(injection.target, source.replaceAll(injection.placeholder, value));
  console.log(`[inject-build-ids] Baked ${injection.describe} ${value} into ${injection.target}.`);
}
