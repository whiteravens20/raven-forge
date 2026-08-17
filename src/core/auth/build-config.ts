/**
 * Azure application (client) ID baked in at build time.
 *
 * The literal below is rewritten inside `dist/` by `scripts/inject-build-ids.mjs`
 * when `RAVENFORGE_CLIENT_ID` is set for the build. This placeholder appears in
 * exactly one file and nowhere else in the tree, so the rewrite cannot clobber
 * the sentinel `microsoft-auth.ts` compares against. The Discord application ID
 * is injected the same way, from its own file — see `core/discord/build-config.ts`.
 *
 * This identifier is **not a secret**. Raven Forge is a native OAuth *public*
 * client: it holds no client secret, because anything shipped in a downloadable
 * binary can be extracted from it. The client ID only names the app on the
 * consent screen. See `docs/AZURE-SETUP.md`.
 */
export const BUILD_CLIENT_ID = 'REPLACE_WITH_YOUR_AZURE_CLIENT_ID';
