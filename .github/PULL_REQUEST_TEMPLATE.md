## Description

<!-- What changed and why. The PR *title* becomes a release-note line
     (see .github/release.yml) — write it accordingly. -->

## Type of Change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change (existing profiles, settings, or manifests stop working as before)
- [ ] Documentation
- [ ] Performance
- [ ] Refactor
- [ ] Dependencies

## Related Issue

Closes #(issue number)

## How Has This Been Verified?

<!-- "It typechecks" is not a verification result. Say what you actually ran. -->

- [ ] `npm run lint` — zero errors
- [ ] `npm run typecheck` — zero errors
- [ ] `npm run build` — clean
- [ ] `npm run format:check`
- [ ] **Exercised in the running app** (`npm run dev`) — describe below

Details:

<!-- e.g. "Created a Fabric 1.21.4 profile, synced 25 mods against a signed
     manifest, launched; confirmed mods loaded in-game." -->

### If the UI changed

- [ ] Checked in all three themes (dark, OLED black, light)
- [ ] Checked with `prefers-reduced-motion: reduce` (only if animation changed)
- [ ] Keyboard reachable, visible focus state
- [ ] All new user-facing strings added to **both** `src/renderer/i18n/pl.ts` and `en.ts`
- [ ] Screenshots attached below

### If the launch or sync path changed

- [ ] Launched a real profile end to end
- [ ] Ran a real manifest sync and confirmed hashes are verified

## Security Checklist

<!-- Required for anything touching auth, IPC, downloads, hashing, signatures,
     the preload, or window options. -->

- [ ] No secret, token, or private key is committed, logged, or written outside the OS keychain
- [ ] New IPC handlers validate their arguments **in the main process**
- [ ] `contextIsolation`, `nodeIntegration`, `webSecurity` and the CSP are unchanged (or the change is justified below)
- [ ] Hash verification and manifest signature checks are not weakened, and nothing added a "continue anyway" path
- [ ] Manifest fields are treated as untrusted input where they become paths or URLs
- [ ] If `canonical.ts` changed, `scripts/lib/canonical.mjs` in `raven-packs` changed identically
- [ ] `npm audit` clean at the gate the CI enforces (moderate for production deps, high overall)

## New Dependencies

<!-- List each one with a justification, or write "none". Every package here
     ships to end users. -->

## Screenshots

## Additional Information
