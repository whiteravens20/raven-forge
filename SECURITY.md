# Security Policy — Raven Forge

Raven Forge is a Minecraft launcher. That means it does three things that deserve
care: it **downloads and executes third-party code** (mods, loaders, a JRE), it
**holds Minecraft account tokens**, and it **auto-updates itself**. A bug in any
of those is a bug on someone else's machine.

---

## Reporting a Vulnerability

**Do not open a public issue for a security vulnerability.**

Use GitHub's [private vulnerability reporting](https://github.com/whiteravens20/raven-forge/security/advisories/new)
for this repository. It goes straight to the maintainer and stays private until a
fix ships.

Please include:

- The version (`package.json` `version`, or Info → the version line in the app) and your OS.
- What an attacker gains, and what they need in order to try it.
- Reproduction steps, or a proof of concept.
- Any relevant log fragments — **with tokens and usernames redacted** (see below).

What to expect:

| Stage                        | Target                    |
| ---------------------------- | ------------------------- |
| Acknowledgement              | 72 hours                  |
| Initial assessment           | 7 days                    |
| Fix or documented mitigation | 30 days for high/critical |

This is a solo, unpaid project. There is no bug bounty. Credit in the release
notes is offered for every valid report unless you prefer otherwise.

### Redact your logs before sharing them

`launcher.log` and crash reports can contain a **live Minecraft access token**
(passed to the game as `--accessToken`), your username and UUID, and local file
paths. Strip those before attaching a log to an issue or a report. If you have
already posted one publicly, sign out and back in — that invalidates the session.

---

## Supported Versions

The project is in early development and there is no LTS line. Only the latest
release receives security fixes; there are no backports to earlier tags. The
launcher updates itself, so "update first" is usually a restart rather than a
download.

| Version        | Supported         |
| -------------- | ----------------- |
| Latest release | ✅                |
| Anything older | ❌ — update first |

---

## Security Model

### Content integrity

- **Every downloaded file is hash-checked** before it is installed. `sha512` wins
  over `sha256` when a manifest carries both (`src/core/mods/integrity.ts`).
  A mismatch deletes the file and fails the sync — it is never installed "anyway".
- **Manifests can be signed** with Ed25519 (`tweetnacl`) and are verified against
  a per-profile public key before their contents are acted on
  (`src/core/updater/manifest-verify.ts`). The signature covers a canonical JSON
  form of the whole manifest with keys sorted **recursively** — see
  [`docs/MANIFEST-SCHEMA.md`](docs/MANIFEST-SCHEMA.md).
- Signature verification is only as strong as the key distribution. A profile
  with no `publicKey` configured gets no signature guarantee at all, only hashes.
- The places where a wrong answer is silent rather than loud carry tests in
  `test/` — hash selection and comparison, canonicalization, launch-argument
  assembly, offline UUID derivation, and every refusal that has to hold: a path
  that leaves its directory, a downloaded file whose hash is not the published
  one, a profile export carrying `javaArgs`, an IPC call from a frame that is not
  the launcher's own page. The canonicalization suite exists because of a real
  bug of exactly that shape: nested objects serialized as `{}`, so a manifest
  whose every mod had been swapped for a different jar still verified.

### Credentials

- Microsoft refresh tokens and Minecraft access tokens are stored in the **OS
  keychain** via `keytar` (service `com.ravenforge.launcher`) — libsecret on
  Linux, Credential Manager on Windows, Keychain on macOS.
- `auth.json` holds only account identifiers, the active account id, and each
  session's expiry. No secret material. A login made by a pre-keychain build is
  migrated into the keychain the first time a build with one reads the file, and
  anything the keychain refuses stays where it is — a failed migration is not a
  lost login. Both halves are covered in `test/token-store.test.ts`.
- Where no keyring is available (a headless Linux box, for instance), the
  launcher degrades to a `0600` `auth.json` rather than refusing to log in. That
  is a deliberate, documented trade-off, not an oversight — and it is surfaced in
  the app rather than only logged, because the person whose refresh token is in a
  plaintext file is the one who gets to decide whether that is acceptable.
- **No credential ever leaves the machine** except to Microsoft's and Mojang's own
  endpoints as part of the OAuth chain.

### Process boundary

- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`,
  `webSecurity: true`, `allowRunningInsecureContent: false` (`src/main/window.ts`).
  Verified with a window on screen: `require`, `process` and `module` are all
  `undefined` in the renderer, and the whole preload API surface still works.
- The renderer reaches the main process only through the typed IPC surface in
  `src/preload/index.ts`. There is no `remote`-style ambient Node access.
- A Content-Security-Policy in `src/renderer/index.html` restricts scripts to
  `'self'`.
- External links open in the **system browser**, never in an Electron window, and
  only for `http://`/`https://` URLs — both at the window-open handler and at the
  `system:open-url` IPC boundary.

### Supply chain

- Dependencies are kept lean and the lockfile is committed.
- Dependabot opens weekly PRs against `dev`; CodeQL and `npm audit` run on every
  push and weekly on a schedule.
- The audit gate is two-tier: production dependencies fail at **moderate**,
  because those are what ship inside the installer, and the whole tree fails at
  **high**. Anything waived is listed in `.github/scripts/audit-allowlist.json`
  with a reason **and an expiry date**, so no advisory is silenced quietly and
  none stays silenced by default — the gate fails once an entry expires, forcing
  a re-review rather than letting a waiver outlive its justification. A
  malformed allowlist fails the gate too; it never fails open.
- `npm audit signatures` verifies that every installed tarball carries a valid
  registry signature.
- Trivy scans the repository for committed secrets and misconfiguration on every
  push, with results uploaded to code scanning.
- Release binaries are built in CI from a tag, on a workflow that refuses to run
  unless the tag is reachable from `main` and matches `package.json`. Windows
  installers are Authenticode-signed when signing secrets are configured, and the
  workflow **fails** rather than publish a build that was supposed to be signed
  and is not. An unsigned build raises a SmartScreen warning, which is expected
  behaviour and not something to click past on a binary you did not get from the
  Releases page.
- Every release carries `SHA256SUMS.txt`, a CycloneDX SBOM of the production
  dependencies, and a signed SLSA build-provenance attestation:

  ```bash
  sha256sum -c SHA256SUMS.txt --ignore-missing
  gh attestation verify <file> --repo whiteravens20/raven-forge
  ```

### Telemetry

There is none. Raven Forge collects no analytics, sends no usage data, and has
no reporting endpoint — there is nothing to opt out of, which is why there is no
switch for it in Settings. Outbound requests go only where a feature needs them:
Mojang and Adoptium for game files and Java, Modrinth for mods, the
manifest URL you configured, the news and announcement feeds you configured, and
GitHub Releases for launcher updates. All of them honour the proxy set in
Settings → Network.

Every one of those is itemised, with what it sends, in
[docs/PRIVACY.md](docs/PRIVACY.md) ([po polsku](docs/PRIVACY.pl.md)) — which is
also where the local data, the credential store and the known gaps are described
in full. The launcher shows the same picture for the running install under
Info → Privacy.

---

## Known Gaps

Listed on purpose. An honest list beats a clean-looking one.

- **No signature requirement.** Manifest signing is opt-in per profile. A profile
  pointed at an unsigned manifest trusts whoever controls that URL, bounded only
  by the hashes that same manifest supplies.
- **Mods are not sandboxed.** A Minecraft mod is arbitrary Java running with your
  user's privileges. Raven Forge verifies that you got _the file the manifest
  named_; it cannot tell you that file is safe. Only add manifest sources you
  trust.
- **No reproducible builds.** You cannot currently verify that a published binary
  corresponds to the tagged source.

---

## Out of Scope

Reports on the following will be closed without a fix:

| Not a vulnerability                                                  | Why                                                             |
| -------------------------------------------------------------------- | --------------------------------------------------------------- |
| A malicious mod on a manifest you chose to trust                     | Trusting the source is the user's decision; see above           |
| Reading your own tokens from your own keychain                       | Local user with your privileges is outside the threat model     |
| "The installer is unsigned" on a self-built binary                   | Signing happens in release CI with the maintainer's certificate |
| Vulnerabilities in Minecraft, Mojang/Microsoft services, or Modrinth | Report those to their respective vendors                        |
| Anything requiring physical access to an unlocked machine            | Outside the threat model                                        |
| Denial of service against your own launcher instance                 | No multi-user surface to protect                                |
| Automated scanner output with no demonstrated impact                 | Send the analysis, not the report                               |
