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

> **Note on the licence.** Raven Forge ships under the **GNU Affero General Public License, version 3** (AGPL-3.0-only), with the attribution term in [NOTICE](NOTICE). Contributions are accepted under the same terms.

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

The native `keytar` build needs a toolchain:

- **Windows:** `keytar` is a native module and needs a C++ toolchain to build. The Node.js installer offers to set one up ("Tools for Native Modules"); otherwise install the **Desktop development with C++** workload from the Visual Studio Installer. The old `windows-build-tools` package is deprecated — npm itself now says Node ships what it used to provide.
- **Debian / Ubuntu:**

  ```bash
  sudo apt update
  sudo apt install -y build-essential libsecret-1-dev libx11-dev libxss1 libnotify4
  ```

```bash
git clone https://github.com/whiteravens20/raven-forge.git
cd raven-forge
npm install
npm run dev          # Vite renderer + tsc watch for main + Electron
```

The other scripts, and how to build the installers, are in [docs/BUILDING.md](docs/BUILDING.md).

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
├── main/           # Electron main process (Node.js)
├── preload/        # contextBridge preload scripts
├── renderer/       # React SPA (Vite-bundled)
│   ├── components/ # UI components
│   ├── pages/      # Route pages
│   ├── stores/     # Zustand state stores
│   ├── i18n/       # UI messages, one JSON file per language + tiny t() helper
│   ├── assets/     # bundled fonts
│   └── styles/     # Tailwind entry + theme tokens + backdrop animations
├── core/           # Business logic (runs in main process)
│   ├── auth/       # Microsoft OAuth + offline auth
│   ├── config/     # Settings, paths, and the movable data root
│   ├── diagnostics/# Crash reports — one redacted file per crash
│   ├── discord/    # Rich Presence over Discord's local IPC socket (opt-in)
│   ├── java/       # Adoptium JRE management
│   ├── minecraft/  # Version manifest, assets, game launcher
│   ├── modloader/  # Fabric/Quilt/Forge/NeoForge installers
│   ├── mods/       # Manifest fetch, sync, Modrinth API, integrity, compatibility
│   ├── net/        # Proxy dispatcher + the shared download helper
│   ├── news/       # News + announcement feeds
│   ├── packs/      # .mrpack reader, pack catalogue, profile-from-pack install
│   ├── profiles/   # Profile CRUD + import/export
│   ├── updater/    # electron-updater + Ed25519 manifest verification
│   └── util/       # Atomic writes, cancellation, per-file serialization, path containment
└── shared/         # Types shared between main + renderer
    ├── ipc-types.ts    # the channel contract
    └── ipc/            # payload shapes, one file per domain

test/               # Vitest suites — pure logic, the state files over a real
                    # temporary data root, the download policy over a real socket,
                    # and real subprocesses (tar, unzip) + an Electron stub
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
- Every user-facing string goes through `t()` and the message files — see [Translations](#translations).

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

The interface text lives in `src/renderer/i18n/`, one JSON file per language, named by its language code: a flat object of messages by key. `en.json` is the source the other files translate, and a message a language lacks is shown in English. A `{name}` in a message is a value the code puts in, and a translation keeps every one of them. A message that depends on a number has a key for each plural category that whole numbers fall into in the language, as `Intl.PluralRules` names them, with the category after the key: `logs.errorCount_one` and `logs.errorCount_other` in English, `_one`, `_few` and `_many` in Polish, whose `other` is for fractions only. `*emphasis*` and `**strong**` are read only in the chronicle's prose; everywhere else a message is shown as written, asterisks included.

The launcher loads and offers only the languages in `LOCALES` (`src/shared/locale.ts`), and a first start opens in the first of the system's languages that is on it, or in English. `test/i18n-messages.test.ts` holds each of them to every message of `en.json`. A file of a language not on that list may hold part of the messages, as a translation still in progress does, and is checked for what it has: each of its messages is in `en.json`, is not empty, keeps the placeholders of the English one and has the plural forms of its language.

- **Never hardcode a user-facing string in a component.** Add the message to `en.json` and to the file of every language in `LOCALES`, and show it with `t('key')` from `useT()`. A count that changes the wording goes through `t.plural('key', count)`.
- To add a language, create `src/renderer/i18n/<code>.json` and translate the messages of `en.json` into it; the tests name any plural form that is missing. The file can grow over several changes: until the language is on the list, it is not loaded. Once it has every message, add the code to `LOCALES`. TypeScript then names what else a language needs: its file in `MESSAGES` and its own name in `LOCALE_NAMES` (`src/renderer/i18n/index.ts`), and the privacy policy it is shown (`PRIVACY_POLICY_FILES` in `src/shared/branding.ts`).
- Keep the tone consistent with the existing messages.

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
is aliased to a stub (`test/stubs/electron.ts`), so anything needing a window is
faked at that seam — and everything below the seam is the real code. Nothing
under test reaches the keyring: the module that does is loaded only when a
credential is read or written. The suite is held to the same standard as what it checks:
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
  exists in `en.json` with the variables it was handed, and that the
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
- Tokens belong in the OS keychain (`src/core/auth/secret-store.ts`), never in a plaintext config file, and never in a log line. `--accessToken` must not reach `logs/main.log`.
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

This project is built using AI coding tools, as the [README](README.md#how-the-code-is-written-and-checked) describes, and the same rule applies to contributions:

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
