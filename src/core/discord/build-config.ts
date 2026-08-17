/**
 * Discord application ID baked in at build time.
 *
 * The literal below is rewritten inside `dist/` by `scripts/inject-build-ids.mjs`
 * when `RAVENFORGE_DISCORD_APP_ID` is set for the build. The env var still wins
 * at runtime, so a dev run can point at a throwaway application.
 *
 * This identifier is **not a secret**. Every application speaking Discord's IPC
 * protocol sends its ID in the opening handshake, so it is readable from any
 * user's own socket traffic; it names an application on a status line and
 * authorises nothing. It is injected rather than committed for a different
 * reason: a fork that rebuilt this repo unchanged would otherwise declare *our*
 * application, and its players' statuses would advertise Raven Forge. Left
 * unset, the feature is simply off. See `docs/DISCORD-SETUP.md`.
 */
export const BUILD_DISCORD_APP_ID = 'REPLACE_WITH_YOUR_DISCORD_APP_ID';
