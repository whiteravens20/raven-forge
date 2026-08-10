# Microsoft login: registering your own Azure application

Raven Forge can sign players in with their real Microsoft account so they can
play on online-mode servers. To do that it needs an **Azure application (client)
ID** of its own.

This build does not ship one. Without it, Microsoft login fails with

> Microsoft login is not configured — this build has no Azure client ID.

and you are limited to offline mode (singleplayer and LAN). Offline mode needs
none of this — if that is all you want, you can close this page.

This guide assumes you have never opened the Azure portal before.

---

## Read this first: cost, safety, and the waiting period

**Is it free?** Yes. App registration is part of the _Microsoft Entra ID Free_
tier and is not billed — Microsoft's own guidance is explicit that registering
an application costs nothing and keeps working indefinitely. One caveat worth
knowing before you start: when you create the account, **Microsoft may ask for a
credit card to verify your identity**. It is not charged for Entra ID Free. If
handing over a card number is not acceptable to you, stop here and use offline
mode — there is no way around that check.

**Is it safe to put the ID in the app?** Yes, and this is worth understanding
rather than taking on faith. Raven Forge is a _public OAuth client_ — a desktop
app that runs on machines you do not control. Public clients are defined by the
fact that they **hold no client secret**, because any secret shipped in a
downloadable binary can be extracted by anyone who downloads it. You will never
create a secret in this guide. The client ID is a public identifier, exactly
like an app's name; every open-source launcher (Prism, ATLauncher, Helios) ships
theirs in plain sight. Leaking it costs you nothing, because it grants nothing
on its own.

What the ID _does_ is identify your app on the consent screen the player sees.
The player's password never reaches Raven Forge — they type it on Microsoft's
own page. What comes back is a token scoped to `XboxLive.signin`, which is only
good for signing in to Xbox Live and Minecraft. It cannot read email, files,
contacts, or anything else in the account.

**The catch: approval is not instant.** Since Mojang tightened this, a freshly
created Azure app **cannot** talk to `api.minecraftservices.com` until it is
reviewed. Until then the login chain runs fine right up to the last step and
then fails with **HTTP 403 / "Invalid app registration"**. You submit a form and
wait. Budget days, not minutes. Steps 5–7 below cover this, and the order
matters — you must attempt a login _before_ you request review.

---

## What you need

- A Microsoft account (the one you use for Minecraft is fine, but any works —
  the app registration is separate from the accounts that will log in through it).
- About 15 minutes, plus the review wait.

---

## Step 1 — Create the app registration

1. Go to **<https://portal.azure.com>** and sign in.
2. In the search bar at the top, type `Microsoft Entra ID` and open it.
   (If you have used Azure before, this is the service formerly called Azure
   Active Directory. Same thing, new name.)
3. In the left-hand menu, choose **App registrations**.
4. Click **+ New registration** at the top.

Fill in the form:

| Field                       | What to enter                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Name**                    | Anything you like — `Raven Forge` is fine. Players see this on the consent screen, so pick something recognisable.                                                                                                 |
| **Supported account types** | **Accounts in any identity provider or organizational directory (for authenticating users with personal Microsoft accounts)** — the option whose description mentions _personal Microsoft accounts (Skype, Xbox)_. |
| **Redirect URI**            | Leave it **empty** for now. Step 2 adds it properly.                                                                                                                                                               |

Click **Register**.

> **Why that account type?** Minecraft accounts are consumer Microsoft accounts,
> not work/school accounts. Raven Forge signs in against the `consumers`
> endpoint (`src/shared/constants.ts`), which is the only one that accepts the
> `XboxLive.signin` scope — the `common` endpoint and a specific tenant ID both
> just error out. Picking an account type that excludes personal accounts will
> make login fail no matter what else you do.

## Step 2 — Add the redirect URI

Azure needs to know where to send the player back after they log in.

1. In your new app, open **Authentication** in the left menu.
2. Click **+ Add a platform**.
3. Choose **Mobile and desktop applications**.
4. Tick the pre-filled checkbox for:

   ```
   https://login.microsoftonline.com/common/oauth2/nativeclient
   ```

   This is the exact value Raven Forge uses ([`microsoft-auth.ts:30`](../src/core/auth/microsoft-auth.ts#L30)).
   Copy it character for character if you type it by hand — a trailing slash
   will break the login.

5. Click **Configure**.

> **Do not create a client secret.** There is a "Certificates & secrets" page
> and it is tempting to fill it in. Don't. Raven Forge is a public client and
> sends no secret; creating one achieves nothing and gives you a credential to
> leak. See the safety note above.

## Step 3 — Copy your client ID

Open the **Overview** page of your app. Copy two values — you need both:

- **Application (client) ID** — a UUID like `a1b2c3d4-1234-5678-90ab-cdef12345678`
- **Directory (tenant) ID** — another UUID, needed only for the review form in step 6

## Step 4 — Wire it into Raven Forge

For development, pass it as an environment variable:

```bash
RAVENFORGE_CLIENT_ID=a1b2c3d4-1234-5678-90ab-cdef12345678 npm run dev
```

For a build you intend to install and keep, set the same variable when you
build — it gets baked into the output:

```bash
RAVENFORGE_CLIENT_ID=a1b2c3d4-1234-5678-90ab-cdef12345678 npm run dist:linux
```

In CI, set `RAVENFORGE_CLIENT_ID` as a repository **variable** (not a secret —
it is not one, and secrets are masked in logs, which only makes debugging
harder).

If you build without the variable set, the app still builds and runs; Microsoft
login refuses with the message at the top of this page and offline mode keeps
working.

## Step 5 — Attempt a login (yes, it will fail)

Start the app and click **Sign in with Microsoft**. Log in with a Microsoft
account that owns Minecraft: Java Edition.

You should get through the Microsoft login page and the consent screen, and then
fail at the last step with a 403. **This is expected and this step is not
optional** — Microsoft wants to see real sign-in activity against the app
registration before it will review it. Skipping straight to the form tends to
get the request bounced.

## Step 6 — Request approval

Submit your app for review:

**<https://aka.ms/mce-reviewappid>**

The form asks for your **Application (client) ID** and **Directory (tenant) ID**
from step 3. Describe the app honestly — a third-party Minecraft: Java Edition
launcher for personal/community use.

## Step 7 — Wait, then verify

Approval is a manual review, and changes can take up to a further 24 hours to
propagate after it lands. When it goes through, repeat step 5 — the same click
that failed with a 403 should now come back with your username and skin.

---

## Troubleshooting

| What you see                                                                  | What it means                                                                                                                  |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Microsoft login is not configured — this build has no Azure client ID`       | `RAVENFORGE_CLIENT_ID` was not set for this build or this run. Step 4.                                                         |
| **403** from Minecraft, or _"Invalid app registration"_                       | The app has not been approved yet, or approval has not propagated. Steps 5–7. This is the normal state for a new registration. |
| `AADSTS700016` / _application not found in directory_                         | The client ID is wrong, or the account type excludes personal accounts. Steps 1 and 3.                                         |
| `AADSTS50011` / redirect URI mismatch                                         | The redirect URI in Azure does not match exactly. Step 2.                                                                      |
| `This Microsoft account has no Xbox account`                                  | The account has never used Xbox Live. Sign in once at <https://www.xbox.com> to create the profile, then retry.                |
| `This account belongs to a minor and requires a parent to add it to a Family` | Microsoft family-safety restriction on the account being signed in. Not something the launcher can work around.                |
| `This account does not own Minecraft: Java Edition`                           | Auth worked. That account simply has no Java Edition licence — a Bedrock-only or Game Pass account will do this.               |

## Revoking access

Players can revoke Raven Forge's access to their account at any time from
<https://account.live.com/consent/Manage>, independently of you. If you want to
retire the registration entirely, delete the app in Azure — every token issued
through it stops refreshing.

## Where the tokens end up

Nothing from this flow is stored in plaintext where it can be avoided. Refresh
tokens and Minecraft session tokens go into the OS keychain via `keytar`; only
the expiry timestamp and the account's public profile stay in `auth.json`. On a
machine with no working keyring the tokens fall back to `auth.json` at mode
`0600` with a warning, rather than making login impossible. See
[SECURITY.md](../SECURITY.md).

One thing to be careful about: a running game process receives the session token
on its command line (`--accessToken`), so it is visible to `ps` on that machine
and it lands in launcher logs. **Redact `--accessToken` before posting a log
anywhere.**

## References

- [Microsoft authentication — Minecraft Wiki](https://minecraft.wiki/w/Microsoft_authentication)
- [Azure app registration walkthrough — HeliosLauncher](https://github.com/dscalzi/HeliosLauncher/blob/master/docs/MicrosoftAuth.md)
- [Register an application — Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
- [Microsoft Entra ID Free — Microsoft Learn](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/microsoft-entra-id-free)
