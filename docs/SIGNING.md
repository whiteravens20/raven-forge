# Signing

Raven Forge has **two independent signing systems**. They are easy to confuse
and solve different problems:

| | Installer signing | Manifest signing |
|---|---|---|
| **Protects** | the launcher binary a user downloads | the mod list a launcher installs |
| **Scheme** | Authenticode (Windows), X.509 | Ed25519 detached signature |
| **Key holder** | the launcher maintainer | the server/pack admin |
| **Verified by** | Windows / SmartScreen at install time | the launcher at sync time |
| **Configured in** | `electron-builder.config.js`, release CI secrets | Settings → Trusted Keys, per profile |
| **Tooling** | electron-builder | `raven-packs` (`scripts/keygen.mjs`, `scripts/sign.mjs`) |

A signed installer says nothing about the mods it later downloads, and a signed
manifest says nothing about where the launcher itself came from. Both are worth
having.

---

## 1. Installer signing (Windows Authenticode)

### Certificate

You need an **OV** or **EV** code-signing certificate from a CA (DigiCert,
Sectigo, SSL.com, …). Self-signed certificates do not help: Windows only trusts
a chain that terminates in its own root store, so a self-signed build triggers
exactly the same SmartScreen warning as an unsigned one.

| | OV (Organisation Validation) | EV (Extended Validation) |
|---|---|---|
| Cost | lower | higher |
| Key storage | `.pfx` file | hardware token / cloud HSM (mandatory) |
| SmartScreen | reputation accrues over downloads | trusted immediately |
| CI-friendly | yes | needs a cloud signing service |

Since June 2023 the CA/Browser Forum requires **all** code-signing private keys
to live on FIPS 140-2 Level 2 hardware. In practice that means new OV
certificates are also issued to a token or a cloud HSM, and the "base64 a .pfx
into a CI secret" flow below only applies to a certificate you can still export.
Check what your CA actually issues before planning the pipeline.

### CI setup

`release.yml` already passes the signing environment through to
electron-builder. Add two repository secrets:

```bash
base64 -w 0 cert.pfx > cert.b64
gh secret set WIN_CSC_LINK < cert.b64
gh secret set WIN_CSC_KEY_PASSWORD          # prompts for the password
```

electron-builder reads `CSC_LINK` and `CSC_KEY_PASSWORD`; the workflow maps the
repository secrets onto those names. With neither set, the build **succeeds and
produces an unsigned installer** — it does not fail. That is deliberate (forks
and PR builds must still build), and it means an unsigned release is a silent
outcome, so check the release artefacts rather than assuming.

Delete `cert.b64` afterwards. It is the private key in a thin disguise.

### Verifying a build

```powershell
# Windows
Get-AuthenticodeSignature 'Raven Forge Launcher Setup 0.1.0.exe' | Format-List
# Status must be "Valid"; check SignerCertificate.Subject is you.
```

```bash
# Linux, against a downloaded artefact
osslsigncode verify 'Raven Forge Launcher Setup 0.1.0.exe'
```

### SmartScreen

A newly signed OV build still shows "Windows protected your PC" until the
certificate accrues reputation. Reputation follows the **certificate**, not the
file, so it carries across releases — do not rotate certificates casually. EV
certificates skip this.

---

## 2. Linux packages

`.deb` and `.AppImage` artefacts are **not signed**. No distro repository is
involved, so there is no keyring a signature would be checked against, and an
unverifiable signature is worse than none.

What is offered instead: every release lists SHA-256 checksums, and
`electron-updater` verifies the update payload against the `latest-linux.yml`
published alongside it over HTTPS.

If Raven Forge is ever published through a real repository (a PPA, an OBS
project, Flathub), that changes and this section should be rewritten.

---

## 3. macOS

Not currently built or signed. macOS needs a paid Apple Developer ID, codesign
with hardened runtime, and notarisation through Apple's service, or Gatekeeper
refuses to run the app at all. Contributions adding this are welcome; see
`CONTRIBUTING.md`.

---

## 4. Manifest signing (Ed25519)

Server and pack admins sign their manifest so players can confirm the mod list
came from them. Tooling lives in the
[raven-packs](https://github.com/whiteravens20/raven-packs) repository:

```bash
node scripts/keygen.mjs ravenpacks       # → keys/ravenpacks.{key,pub}
node scripts/sign.mjs dist/<slug>/manifest.json keys/ravenpacks.key
```

Distribute the `.pub` value; players paste it under **Settings → Trusted Keys**.
White Ravens' own key is the exception — it is compiled into the launcher at
`src/shared/branding.ts`, so first-party packs verify with nothing pasted.
Rotating it is therefore a launcher release, which is the cost of not shipping a
key players have to fetch from the same place as the manifest.

Keep the `.key` file secret (`chmod 600`, gitignored, never committed) and store
it in CI as `PACK_SIGNING_KEY`.

The format and the canonicalization rules are specified in
[MANIFEST-SCHEMA.md](MANIFEST-SCHEMA.md). Two properties matter operationally:

- **The canonical form must stay byte-identical on both sides.**
  `scripts/lib/canonical.mjs` in `raven-packs` and `canonicalize()` in
  [`src/core/updater/manifest-verify.ts`](../src/core/updater/manifest-verify.ts)
  are the same algorithm written twice. If one changes, both change, in the same
  pull request.
- **Key sorting recurses.** A shallow sort produces a signature that covers only
  top-level scalars and array lengths, and a manifest with every mod swapped for
  a backdoored jar verifies clean. This was a real bug, fixed on 2026-07-31.

### Verifying the contract after touching either side

Sign a manifest with the pack repo, verify it with the launcher's shipped
`canonicalize()`, and confirm tampered variants are rejected. The checks that
matter: identical canonical bytes, key-order independence, the `signature` field
excluded from its own message, a clean round trip, and rejection of a swapped
nested mod URL, a swapped hash, a deep value edit, an appended mod and a flipped
boolean. All five tamper cases must fail verification — the nested-URL swap in
particular is the one the old shallow implementation accepted.

### Rotating a signing key

There is no revocation mechanism. Rotating means: generate a new pair, re-sign
every manifest, publish the new public key, and tell players to replace the old
one. Players who do not update will see "Signature does not match any trusted
public key" — a failure that is loud by design.
