/**
 * Bake RAVENFORGE_CLIENT_ID into the compiled main process.
 *
 * `tsc` has no `define`-style substitution, so without this step a packaged
 * build ships the placeholder and Microsoft login is dead on arrival for every
 * user — `process.env` is read at runtime, and end users have no reason to have
 * that variable set. The env var still wins at runtime so a dev run can point a
 * packaged-style build at a different registration.
 *
 * No variable set: leave the placeholder alone and say so. That build is
 * offline-mode-only by design and must still succeed (CI has no client ID).
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TARGET = path.join('dist', 'core', 'auth', 'build-config.js');
const PLACEHOLDER = 'REPLACE_WITH_YOUR_AZURE_CLIENT_ID';

const clientId = process.env.RAVENFORGE_CLIENT_ID;

if (!clientId) {
  console.log('[inject-client-id] RAVENFORGE_CLIENT_ID not set — offline-mode-only build.');
  process.exit(0);
}

// A wrong value here fails at the consent screen with an opaque AADSTS error,
// which is a miserable thing to debug. Reject it at build time instead.
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
  console.error(
    `[inject-client-id] RAVENFORGE_CLIENT_ID is not a UUID: ${JSON.stringify(clientId)}\n` +
      '  Expected the Application (client) ID from the Azure portal Overview page.',
  );
  process.exit(1);
}

const source = await readFile(TARGET, 'utf8');

if (!source.includes(PLACEHOLDER)) {
  console.error(
    `[inject-client-id] No placeholder in ${TARGET}.\n` +
      '  Either the build did not run, or build-config.ts no longer holds the literal.',
  );
  process.exit(1);
}

await writeFile(TARGET, source.replaceAll(PLACEHOLDER, clientId));
console.log(`[inject-client-id] Baked client ID ${clientId} into ${TARGET}.`);
