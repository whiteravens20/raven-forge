/**
 * Azure application (client) ID baked in at build time.
 *
 * The literal below is rewritten inside `dist/` by `scripts/inject-build-ids.mjs`
 * when `RAVENFORGE_CLIENT_ID` is set for the build. The rewrite names that one
 * file rather than sweeping `dist/`, which is what keeps it off the identical
 * literal in `microsoft-auth.ts` — that one is the sentinel this value is
 * compared against to tell a configured build from an unconfigured one, and
 * rewriting both would make every build look unconfigured. The Discord
 * application ID is injected the same way, from its own file — see
 * `core/discord/build-config.ts`, and `test/build-ids.test.ts` for both.
 *
 * This identifier is **not a secret**. Raven Forge is a native OAuth *public*
 * client: it holds no client secret, because anything shipped in a downloadable
 * binary can be extracted from it. The client ID only names the app on the
 * consent screen. See `docs/AZURE-SETUP.md`.
 */
export const BUILD_CLIENT_ID = 'REPLACE_WITH_YOUR_AZURE_CLIENT_ID';
