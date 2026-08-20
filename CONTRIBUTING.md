# Contributing to Raven Forge

Thanks for considering a contribution. Raven Forge downloads and runs third-party
code on other people's machines and handles their Minecraft account tokens, so
correctness and caution matter more here than velocity. Please read this guide
before opening a pull request.

---

## Table of Contents

- [Before You Start](#before-you-start)
- [Scope of Contributions](#scope-of-contributions)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Guidelines](#coding-guidelines)
- [Verifying Your Change](#verifying-your-change)
- [Secure Contributing](#secure-contributing)
- [Submitting Changes](#submitting-changes)
- [Reporting Security Vulnerabilities](#reporting-security-vulnerabilities)

---

## Before You Start

- Check the [open issues](../../issues) and [pull requests](../../pulls) to avoid duplicating work.
- For anything larger than a bug fix, open an issue first and agree on the approach. The roadmap is not published, so a feature that cuts across it is better discussed than discovered in review.
- By contributing you agree to the [License](LICENSE) and the [Code of Conduct](CODE_OF_CONDUCT.md).

> **Note on the licence.** Raven Forge ships under **PolyForm Noncommercial 1.0.0** — free for any noncommercial use, not an OSI open-source licence. Contributions are accepted under the same terms.

---

## Scope of Contributions

**Welcome:**

- Bug fixes, especially in the launch path (version merging, library resolution, natives extraction)
- Mod loader coverage — Fabric, Quilt, Forge and NeoForge all install today, so the useful work is a loader/Minecraft-version pair that fails, or a loader the launcher does not know yet
- Tests for `src/core/` — the suite covers the pure logic and stops there; anything that widens that honestly is welcome
- Security hardening
- Platform coverage: macOS support, or fixes for a Windows/Linux path that is broken
- Accessibility and keyboard navigation in the UI
- Translations (see [i18n](#translations))
- Documentation corrections

**Not accepted:**

- Anything that helps run Minecraft without a licence — cracked-client support, auth-server bypasses, "premium" account generators. Offline mode exists for playing without a _network connection_, not without a _licence_.
- Telemetry, analytics, ads, or bundled affiliate links.
- Weakening hash verification or manifest signature checks, or adding a way to click past a failed one.
- Auto-installing content from an unverified source.
- Bundled mod binaries in this repository — mods are fetched from their upstream host at runtime.

---

## Development Setup

### Requirements

| Tool    | Version                  |
| ------- | ------------------------ |
| Node.js | ≥ 24.0.0                 |
| npm     | ≥ 11 (bundled with Node) |
| Git     | any recent               |

Platform prerequisites for the native `keytar` build are listed in the [README](README.md#dev-setup) — build tools on Windows, `libsecret-1-dev` on Debian/Ubuntu.

```bash
git clone https://github.com/whiteravens20/raven-forge.git
cd raven-forge
npm install
npm run dev          # Vite renderer + tsc watch for main + Electron
```

### Microsoft login in development

The Azure client ID is baked into `dist/` at build time by `scripts/inject-build-ids.mjs`, and `RAVENFORGE_CLIENT_ID` overrides it at runtime. Without either, `loginMicrosoft()` fails with a readable message and you are limited to offline mode — which is fine for most UI work:

```bash
RAVENFORGE_CLIENT_ID=<your-azure-app-id> npm run dev
```

Register your own Azure application rather than asking for the project's client id — [docs/AZURE-SETUP.md](docs/AZURE-SETUP.md) walks through it from scratch. Note that Mojang must approve a new registration before it can call their API, so budget for that wait rather than expecting online mode to work the same afternoon.

---

## Project Structure

```
src/
  core/          # main-process logic; no Electron window or React imports
    auth/        # Microsoft OAuth → Xbox Live → Minecraft JWT; keychain token store
    config/      # settings manager, path resolution, defaults
    java/        # Adoptium Temurin download and JRE selection
    minecraft/   # version manifest, inheritsFrom merging, assets, launch
    modloader/   # loader install + loader-profile merge over vanilla
    mods/        # Modrinth API, manifest sync, hashing
    net/         # undici dispatcher + Chromium session proxy — all egress
    news/        # news and announcement feed fetching
    profiles/    # profile CRUD, per-profile directories, icons
    updater/     # electron-updater wiring, Ed25519 manifest verification
    util/        # small shared helpers
  main/          # Electron main: window creation, IPC handlers, logging
  preload/       # the ONLY bridge between main and renderer
  renderer/      # React UI — pages/, components/, stores/ (zustand), i18n/, styles/
  shared/        # types and Zod schemas used on both sides of the bridge
test/            # Vitest suites + Electron/keytar stubs (linted and typechecked like src/)
```

Two boundaries worth respecting:

1. **`core/` must not import from `renderer/`, and never the reverse.** The renderer talks to the main process exclusively through the typed IPC surface in `src/preload/index.ts`.
2. **`shared/` is the only module both sides may import.** If a type is needed on both sides, it belongs there.

Architecture detail lives in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); the manifest format is specified in [`docs/MANIFEST-SCHEMA.md`](docs/MANIFEST-SCHEMA.md).

---

## Coding Guidelines

### General

- **TypeScript everywhere.** No `any`, and no type assertion without a comment explaining why it is sound.
- Keep functions small and single-purpose. Match the surrounding style; ESLint is the source of truth.
- **No dead code, no commented-out blocks, no speculative abstraction, no backwards-compatibility shims.** If something is unused, delete it.
- Comments explain _why_, not _what_. A comment restating the line below it is noise; a comment recording why the obvious approach failed is worth its weight.
- Every user-facing string goes through the i18n dictionary — see [Translations](#translations).

### Naming

| Context               | Convention                                             |
| --------------------- | ------------------------------------------------------ |
| Files                 | `kebab-case.ts`, `PascalCase.tsx` for React components |
| Variables / functions | `camelCase`                                            |
| Types / interfaces    | `PascalCase`                                           |
| Constants             | `UPPER_SNAKE_CASE`                                     |
| IPC channels          | `namespace:verb-noun` (e.g. `system:open-url`)         |

### Dependencies

- **Justify every new dependency** in the PR description. This app ships to end users; each package is code running on their machine.
- Prefer Node built-ins and packages already in the tree.
- Native modules raise the cost of every platform build — expect a high bar.
- Run `npm audit` before submitting and flag anything new.

### Commits

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add a shader loader picker to the content page
fix: keep the classifier in the library dedupe key
docs: document the canonicalization contract for signed manifests
security: sort manifest keys recursively before signature verification
```

One logical change per commit, and the **subject line is the whole commit** — the
topic, no body. Do not mix a refactor into a feature commit.

**There is no `CHANGELOG.md`** in this repository, by design — release notes are generated by GitHub from everything that landed since the previous tag, grouped by [`.github/release.yml`](.github/release.yml). Your PR title (or, for a direct push, the commit subject) is the release-note line.

### Translations

UI strings live in `src/renderer/i18n/`. Polish (`pl.ts`) is the reference locale and English (`en.ts`) is the fallback; both carry the same keys, and the type system enforces that.

- **Never hardcode a user-facing string in a component.** Add the key to both dictionaries and use the `t()` helper.
- To add a language, copy `en.ts`, translate the values, and register it in `src/renderer/i18n/index.ts`. TypeScript will name any key you missed.
- Keep placeholders (`{name}`) intact and keep the tone consistent with the existing entries.

---

## Verifying Your Change

Five gates run in CI ([`build.yml`](.github/workflows/build.yml)) and must pass locally first:

```bash
npm run lint         # src/ and test/, zero errors
npm run typecheck    # main, renderer and test projects, zero errors
npm test             # vitest, test/**/*.test.ts
npm run format:check # prettier
npm run build        # must produce a clean dist/
```

Tests live in `test/` and run under Vitest in a plain Node environment. Electron
and `keytar` are aliased to stubs (`test/stubs/electron.ts`), so anything needing
a window or a keyring daemon is faked at that seam — and everything below the
seam is the real code. The suite is held to the same standard as what it checks:
`eslint` and `tsc` (`tsconfig.test.json`) both cover `test/`, and a `.only` left
in a file fails the lint rather than quietly switching off everything around it.
Five kinds of suite:

- **Pure logic.** Launch-argument assembly, hash selection, manifest
  canonicalization, offline UUIDs, version merging, feed parsing, loader
  compatibility, contrast ratios.
- **Real filesystem.** Every state file and everything that writes one, under a
  temporary data root named by `RAVENFORGE_DATA_DIR`: `profiles.json`,
  `settings.json`, `auth.json`, `installed.lock`, the shader and resource-pack
  indexes, profile icons, loader profiles, and path containment. Concurrency is
  exercised rather than assumed — several of these fire overlapping writes and
  assert that neither one is lost.
- **Real sockets.** A `node:http` server on an ephemeral port stands in for
  Mojang, Modrinth, Adoptium and a pack host, so the download policy, the size
  caps and the hash refusals are tested against an actual response instead of a
  mock of one.
- **Real subprocesses.** `tar` unpacks a JRE archive the suite built a moment
  earlier, `unzip -t` reads back an exported `.mrpack`, and a shell script that
  prints a version banner stands in for a JVM — enough for `java-manager.ts` to
  be tested end to end on a machine with no Java on it at all.
- **Contracts between two files.** Things the type system cannot state and
  nothing else would notice: that every channel the preload can invoke has a
  handler registered for it, that every message key the main process names
  exists in both dictionaries with the variables it was handed, and that the
  build-time ID injector still finds the literal it rewrites.

Out of scope is what needs a real JVM, a real Microsoft account or a published
release: launching the game, the OAuth chain end to end, and self-update. Those
are verified by hand, and
[ARCHITECTURE.md](docs/ARCHITECTURE.md#open-implementation-gaps) records what was
proven that way and when.

Add a test with your change when the logic is the kind that can be wrong
quietly. A rule of thumb from this codebase: nearly everything that has cost a
user something — a wiped `settings.json`, a launch that silently ran vanilla, a
progress bar reading "downloading" while it was hashing — failed with no
exception attached to it.

**And then actually run it.** A change that typechecks is not a change that works:

- **UI changes** — exercise the feature in the running app and attach a screenshot. Check all three themes (dark, OLED black, light) if you touched anything visual, and check `prefers-reduced-motion` if you touched an animation.
- **Launch-path changes** — launch a real profile. The single worst bug in this project's history typechecked perfectly: the launcher downloaded a Fabric profile and then booted vanilla with no mods, because nothing read the file it had just fetched.
- **Download/sync changes** — run a real sync against a real manifest and confirm the hashes are checked.

State in the PR description what you actually ran. "Typechecks" is not a test result.

---

## Secure Contributing

### Credentials and tokens

- **Never commit secrets** — no tokens, no client ids, no private keys, not even in a test fixture.
- Tokens belong in the OS keychain (`src/core/auth/secret-store.ts`), never in a plaintext config file, and never in a log line. `--accessToken` must not reach `launcher.log`.
- If you commit a secret by accident, treat it as compromised, rotate it, and report it privately.

### Integrity

- **Do not relax hash verification.** A file whose hash does not match is deleted, not installed. There is no "continue anyway" path and there should not be one.
- The manifest canonicalization in `src/core/updater/canonical.ts` must stay **byte-identical** to `scripts/lib/canonical.mjs` in the `raven-packs` repository. Any divergence silently breaks every signature. If you change one, change both in the same PR and say so.
- Treat everything in a manifest as attacker-controlled input: file names become paths, URLs become requests. Validate before use.

### Process boundary

- Do not add `nodeIntegration`, do not disable `contextIsolation`, do not widen the CSP without saying why in the PR.
- Every new IPC handler validates its arguments in the **main process**. A renderer-side check is a UX affordance, not a security control.
- Do not pass user input into a shell. Use `execFile`/`spawn` with an argument array.

### AI-assisted code

This project has been built with AI assistance, and the same rule applies to contributions:

- AI-generated code **must be reviewed line by line** before you submit it.
- Do not submit code you cannot explain and defend in review.
- Plausible-looking, subtly wrong code is the characteristic failure mode. The launch path, hashing, signature verification and the token store are where it does real damage — read those diffs twice.

---

## Submitting Changes

`dev` is the working branch and `main` is a release snapshot the maintainer syncs
from it. There are no long-lived feature branches here — maintainer work is
pushed straight to `dev`, so the branch you fork is always current.

1. **Fork** and branch from `dev`, never from `main`.
2. Branch naming: `feat/short-description`, `fix/…`, `docs/…`, `security/…`.
3. Run the checks above and exercise the feature.
4. Open the PR **against `dev`**. A PR opened against `main` is asked to retarget, not merged.
5. Fill out the PR template. Incomplete PRs get sent back for the missing detail.
6. Respond to review comments; PRs idle for 30 days may be closed.

Your PR description should cover **what** changed and **why**, link the issue (`Closes #123`), state how you verified it, and justify any new dependency.

---

## Reporting Security Vulnerabilities

**Do not open a public issue.** Follow [SECURITY.md](SECURITY.md) — use GitHub's
[private vulnerability reporting](https://github.com/whiteravens20/raven-forge/security/advisories/new).
