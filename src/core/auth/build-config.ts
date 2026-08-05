/**
 * Azure application (client) ID baked in at build time.
 *
 * The literal below is rewritten inside `dist/` by `scripts/inject-client-id.mjs`
 * when `RAVENFORGE_CLIENT_ID` is set for the build. It is deliberately the only
 * injectable value in the tree, so the rewrite has exactly one target and cannot
 * clobber the sentinel `microsoft-auth.ts` compares against.
 *
 * This identifier is **not a secret**. Raven Forge is a native OAuth *public*
 * client: it holds no client secret, because anything shipped in a downloadable
 * binary can be extracted from it. The client ID only names the app on the
 * consent screen. See `docs/AZURE-SETUP.md`.
 */
export const BUILD_CLIENT_ID = 'REPLACE_WITH_YOUR_AZURE_CLIENT_ID';
