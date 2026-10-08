# CI/CD

## Workflows

| Workflow                      | Trigger                               | Purpose                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `build.yml`                   | Push/PR to `main`, `dev`              | Lint, typecheck, format check and the test suite, the tests again on Windows, then the app built on Linux and on Windows                                                                                                                                                                                     |
| `package.yml`                 | Nightly; manual (`workflow_dispatch`) | The real electron-builder run: `.deb` + AppImage and the NSIS installer, the checks on what came out, the fuses read back off the binary, the `.deb` started on a clean Ubuntu, and the Windows installer run on Windows: installed, started, updated from 0.7.1 and uninstalled, with its pages and without |
| `security.yml`                | Push/PR to `main`, `dev`; weekly      | npm audit against an allowlist with expiries, registry signatures, dependency review, Trivy secret and config scan, pinned actions, actions advisory                                                                                                                                                         |
| `codeql.yml`                  | Push/PR to `main`, `dev`; weekly      | CodeQL static analysis                                                                                                                                                                                                                                                                                       |
| `scorecard.yml`               | Push to `dev`; weekly                 | OpenSSF Scorecard, published for the README badge                                                                                                                                                                                                                                                            |
| `branch-protection-audit.yml` | Daily; manual                         | Fails when the protection on `main` or `dev` has drifted from what is written in the workflow                                                                                                                                                                                                                |
| `dependabot-auto-merge.yml`   | Dependabot pull requests              | Queues a patch bump to merge once the required checks pass; labels a major for review                                                                                                                                                                                                                        |
| `release.yml`                 | Push tag `vX.Y.Z` that is on `main`   | Builds, signs and checksums the installers, reads the fuses back off them, writes the SBOM and the provenance attestation, and creates a **draft** release                                                                                                                                                   |

`package.yml` is deliberately not on push or pull request: a full packaging run
takes minutes and says nothing about a change to the docs. It runs every night
so that a packaging regression surfaces on an ordinary day rather than during a
release.

## Branch Protection Rules

| Setting                              | `main`                                                                                                                             | `dev`                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Required status checks               | `lint-and-typecheck`, `build-linux`, `build-windows`, `Analyze (javascript-typescript)`, `npm audit`, `Trivy secret & config scan` | `lint-and-typecheck`, `build-linux`, `build-windows` |
| Require branches to be up to date    | Enabled                                                                                                                            | Enabled                                              |
| Require signed commits               | Enabled                                                                                                                            | Enabled                                              |
| Required approving reviews           | 0                                                                                                                                  | 0                                                    |
| Require review from Code Owners      | Disabled                                                                                                                           | Disabled                                             |
| Require linear history               | Disabled                                                                                                                           | Disabled                                             |
| Allow force pushes / allow deletions | Disabled                                                                                                                           | Disabled                                             |

A review requirement is off on purpose. GitHub does not let anyone approve their
own pull request, so on a repository with one maintainer it would not be a gate
but a lock; the gate is the required checks. `.github/CODEOWNERS` still requests
a review and marks the paths where a change matters most.

The names in the first row are the check names GitHub reports, not workflow file
names: a check that no job ever reports can never pass, and would block every
merge. `branch-protection-audit.yml` compares these settings with the live ones
every day.

## Creating a Release

```bash
# main is green and package.json already carries the version being released
git checkout main
git tag -s v1.2.3
git push origin v1.2.3
```

`release.yml` refuses a tag that is not on `main`, and one that does not match
the `version` in `package.json` — electron-builder names every file, and writes
the update feed, from that field.

What it produces is a **draft**. electron-updater ignores drafts, so nothing
reaches an installed launcher until the draft is published by hand, which leaves
time to check it first:

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
gh attestation verify <file> --repo whiteravens20/raven-forge
```

The `.yml` and `.blockmap` files attached to a release are the update feed.
Removing them breaks in-app updates for everybody already on an older version.

## Required GitHub Repository Configuration

| Secret                                 | Needed for                                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAVENFORGE_CLIENT_ID`                 | A release. The Azure application id Microsoft sign-in runs under; without it the build stops rather than ship a launcher nobody can sign in to. See [docs/AZURE-SETUP.md](../docs/AZURE-SETUP.md) |
| `RAVENFORGE_DISCORD_APP_ID`            | Optional. The Discord status feature; absent, the setting is there and does nothing. See [docs/DISCORD-SETUP.md](../docs/DISCORD-SETUP.md)                                                        |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Optional. The Windows code-signing certificate; absent, the installer is built unsigned and the job says so. See [docs/SIGNING.md](../docs/SIGNING.md)                                            |
| `BRANCH_PROTECTION_READ_TOKEN`         | Optional. A fine-grained token with `Administration: read` on this repository, for `branch-protection-audit.yml` where the workflow's own token cannot read the rules                             |

Every other workflow runs on `GITHUB_TOKEN` alone. Each workflow starts from
read-only permissions and a job is given write access only where it needs it.

## Supply-Chain Hardening

The 7-day release-age policy is enforced in layers, each covering what the one
before it cannot.

### 1. Dependabot cooldown — the primary control

`.github/dependabot.yml` sets `cooldown: default-days: 7` on both ecosystems.
Dependabot will not propose a version until it has been public for a week, so a
too-fresh version never becomes a PR and therefore can never be merged early —
including by `dependabot-auto-merge.yml`, which merges patch bumps once the
required checks on `dev` are green.

Cooldown covers **version** updates only. Dependabot **security** updates are
exempt by design and open the moment an advisory lands; that is intended — a
known-exploitable dependency should not wait out a quarantine window.

### 2. `.npmrc` — the client-side backstop

| Setting           | Value | Effect                                                                 |
| ----------------- | ----- | ---------------------------------------------------------------------- |
| `min-release-age` | `7`   | Refuses to resolve any package version published less than 7 days ago. |

It applies at **resolution** — `npm install`, `npm update` — which in practice
means a person adding or bumping a package by hand. It does **not** apply to
`npm ci`, which installs exactly what the lockfile pins. That is why it cannot
be the primary control, and why cooldown exists above it.

`ignore-scripts` is not set in `.npmrc`, and the file says why: `electron`
downloads its binary and `keytar` builds a native module from their install
scripts, and the root `postinstall` rebuilds native modules for Electron. The
workflows that only read the tree — `codeql.yml`, the signature audit in
`security.yml`, the SBOM job in `release.yml` — pass `--ignore-scripts`
themselves.

### 3. CI verification — what actually shipped

`security.yml` installs the tree and runs `npm audit signatures`, verifying
every installed tarball against its registry signature. This is the only place
signature verification happens; there is **no** npmrc setting for it.
`audit-signatures` is a flag on the `npm audit` command — setting it in `.npmrc`
makes npm warn `Unknown project config` and changes nothing.

The same workflow runs `audit-check.mjs`: `npm audit` at `moderate` for what
ships inside the installer and at `high` for everything, with an allowlist in
`audit-allowlist.json` whose every entry carries a justification and an expiry
date. An expired entry fails the job, so no suppression outlives its review.
Dependency review, on pull requests, also refuses a dependency under a licence
the AGPL cannot be combined with.

### 4. Pinned actions

Every action is pinned to a commit SHA with the version it stands for in a
comment — `uses: actions/checkout@<sha> # v7.0.1`. A tag is a pointer its
publisher can move; a SHA names the code.

Two jobs of `security.yml` keep that honest. `Pinned actions` fails when a
reference is not a SHA, has no version comment, or is not the commit its version
tag points at. `Actions audit` asks GitHub's advisory database about every
pinned version, because Dependabot raises no alert for an action pinned by SHA.
Dependabot rewrites the SHA and the comment together when it updates one.
