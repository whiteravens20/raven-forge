/**
 * English dictionary — the reference locale.
 *
 * This file defines the *shape* every other locale must match: `TranslationKey`
 * is derived from its keys, so a missing or misspelled entry in another
 * dictionary is a type error rather than a string that silently renders as its
 * own key at runtime.
 *
 * Conventions:
 * - Keys are flat and dotted, `area.thing` or `area.thing.detail`.
 * - `{name}` placeholders are substituted by `translate()`; keep every one of
 *   them intact when translating.
 * - Count-dependent strings come in `.one` / `.few` / `.many` / `.other`
 *   variants, picked through `Intl.PluralRules` — see `plural()` in `index.ts`.
 *   English only ever needs `.one` and `.other`; Polish uses all four.
 * - `*emphasis*` and `**strong**` are only interpreted by `useRichT()`, which
 *   exists for the chronicle's prose. Everywhere else the string is rendered
 *   verbatim, asterisks included.
 */
export const en = {
  // ── Navigation ───────────────────────────────────────────
  'nav.label': 'Launcher navigation',
  'nav.home.short': 'Home',
  'nav.home.title': 'Home',
  'nav.profiles.short': 'Profiles',
  'nav.profiles.title': 'Profiles',
  'nav.mods.short': 'Mods',
  'nav.mods.title': 'Mods',
  'nav.content.short': 'Looks',
  'nav.content.title': 'Shaders and resource packs',
  'content.title': 'Shaders & resource packs — {profile}',
  'content.pickProfile': 'Pick a profile first.',
  'content.kindLabel': 'Content type',
  'content.shaders': 'Shaders',
  'content.resourcePacks': 'Resource packs',
  'content.tabInstalled': 'Installed',
  'content.tabBrowse': 'Browse',
  'content.searchShaders': 'Search Modrinth for shaders…',
  'content.searchPacks': 'Search Modrinth for resource packs…',
  'content.searchFailed': 'Search failed.',
  'content.installFailed': 'Could not install {name}.',
  'content.removeFailed': 'Could not remove that.',
  'content.reorderFailed': 'Could not save the new order.',
  'content.emptyShaders': 'No shaders installed',
  'content.emptyPacks': 'No resource packs installed',
  'content.emptyHint': 'Browse to add one, or let a manifest sync bring it in.',
  'content.orderHint':
    'Top of the list wins. A pack only changes what the ones below it left alone.',
  'content.moveUp': 'Move {name} up',
  'content.moveDown': 'Move {name} down',
  'content.loaderFilter': 'Shader loader',
  'content.facet.resolutions': 'Resolution',
  'content.facet.features': 'Includes',
  'content.facet.categories': 'Category',
  'content.facet.performanceImpact': 'Performance',
  'content.browseHint': 'Narrow with the filters or type a name — either works on its own.',
  'content.filterAny': 'Any',
  'content.shadersNeedIris':
    'Shaders need a shader loader. The first time you install a shader, the launcher will offer the ones that run on this profile.',
  'content.loaderInstalled': 'Installed {name} — this profile can now load shader packs.',
  'content.loaderInstalledWithDeps':
    'Installed {name}, along with {deps} which it needs. This profile can now load shader packs.',
  'content.loaderNoBuild':
    'No shader loader publishes a build for {loader} on Minecraft {version}, so this pack will not load yet.',
  'content.loaderUnsupported':
    'This profile is vanilla. Shaders need a mod loader — switch the profile to Fabric, Quilt, Forge or NeoForge first.',
  'content.loaderFailed': 'The shader pack installed, but the shader loader did not: {error}',

  // ── Shader loader picker ─────────────────────────────────
  'shaderLoader.title': 'Which shader loader?',
  'shaderLoader.why':
    'A shader pack needs a mod to read it. Pick one and the launcher will add it to this profile.',
  'shaderLoader.alsoInstalls': 'Also installs: {deps}',
  'shaderLoader.skip': 'Not now',

  // ── Search filters (mods, shaders, resource packs) ───────
  'search.gameVersion': 'Minecraft version',
  'search.noResults': 'Nothing matched.',
  'search.noResultsFiltered':
    'Nothing matched. The filters above are ANDed together, so a project with no build for {version} will not appear — widen one of them.',
  'nav.accounts.short': 'Accounts',
  'nav.accounts.title': 'Accounts',
  'nav.settings.short': 'Options',
  'nav.settings.title': 'Settings',
  'nav.about.short': 'About',
  'nav.about.title': 'About',

  // ── Window controls ──────────────────────────────────────
  'window.minimize': 'Minimise',
  'window.maximize': 'Maximise',
  'window.restore': 'Restore',
  'window.close': 'Close',

  // ── Shared vocabulary ────────────────────────────────────
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.add': 'Add',
  'common.remove': 'Remove',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.duplicate': 'Duplicate',
  'common.export': 'Export',
  'common.import': 'Import',
  'common.back': 'Back',
  'common.close': 'Close',
  'common.dismiss': 'Dismiss',
  'common.refresh': 'Refresh',
  'common.openFolder': 'Open folder',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.restart': 'Restart',
  'common.later': 'Later',
  'common.download': 'Download',
  'common.search': 'Search',
  'common.install': 'Install',
  'common.installed': 'Installed',
  'common.enable': 'Enable',
  'common.disable': 'Disable',
  'common.show': 'Show',
  'common.hide': 'Hide',

  // ── Home ─────────────────────────────────────────────────
  'home.signedInAs': 'Signed in as',
  'home.accountMicrosoft': 'Microsoft account',
  'home.accountOffline': 'offline account',
  'home.notSignedIn': 'Not signed in — go to the Accounts tab',
  'home.noProfiles': 'No profiles — create one in the Profiles tab',
  'home.play': 'PLAY',
  'home.running': 'Running…',
  'home.preparing': 'Starting…',
  'home.cancelLaunch': 'Cancel',
  'home.authUnreachable':
    'Could not reach the Microsoft sign-in servers. You can play offline — singleplayer and LAN only, and online-mode servers will refuse the connection.',
  'home.launchOffline': 'Play offline',
  'home.updatingLauncher': 'Updating launcher…',
  'home.updateBeforePlay': 'Launcher {version} will be installed before the game starts.',
  'home.updateFailedPlayAnyway':
    'The launcher update could not be downloaded — the game will start anyway.',
  'home.launchFailed': 'Could not start the game',
  'home.launchError': 'Error while starting the game',
  'home.showConsole': 'Show console',
  'home.hideConsole': 'Hide console',
  'home.news': 'News',
  'home.refreshNews': 'Refresh news and announcements',
  'home.newsOlder': 'Older news',
  'home.newsNewer': 'Newer news',
  'home.newsStale': 'Could not refresh the feed — these are the last entries loaded.',
  'home.newsUnavailable': 'Could not load the news feed. Check the feed address in Settings.',
  'news.openInBrowser': 'Open in browser',
  'news.noBody': 'This entry carries no further text.',
  'home.ram': '{mb} MB RAM',

  // ── Live console ─────────────────────────────────────────
  'console.title': 'Game console',
  'console.close': 'Close console',
  'console.waiting': 'Waiting for game logs…',

  // ── Crash reporter ───────────────────────────────────────
  'crash.title': 'The game crashed',
  'crash.body': 'Profile {profile} exited with code {code}.',
  'crash.bodyWithTime': 'Profile {profile} exited with code {code} after {minutes} min.',
  'crash.showLogs': 'Show logs',
  'crash.hideLogs': 'Hide logs',
  'crash.reportSaved':
    'A crash report was saved on this computer — nothing was sent anywhere. Access tokens and your account details are already removed from it.',
  'crash.openReport': 'Open report',
  'crash.reportBug': 'Report a bug',

  // ── Profiles ─────────────────────────────────────────────
  'profiles.title': 'Profiles',
  'profiles.new': 'New profile',
  'profiles.import': 'Import profile',
  'profiles.empty': 'No profiles',
  'profiles.emptyHint': 'Add your first profile with the + button',
  'profiles.pickOrCreate': 'Select a profile, or create a new one',
  'profiles.copyName': '{name} (copy)',
  // ── Deleting a profile ───────────────────────────────────
  'delete.title': 'Delete profile "{name}"',
  'delete.intro':
    'The profile disappears from the launcher either way. What happens to its files is up to you.',
  'delete.alsoFiles': 'Delete the files too',
  'delete.counting': 'Checking what is there…',
  'delete.nothingInstalled': 'Nothing installed • {size}',
  'delete.mods.one': '{count} mod',
  'delete.mods.other': '{count} mods',
  'delete.resourcePacks.one': '{count} resource pack',
  'delete.resourcePacks.other': '{count} resource packs',
  'delete.shaders.one': '{count} shader pack',
  'delete.shaders.other': '{count} shader packs',
  'delete.worlds.one': '{count} world',
  'delete.worlds.other': '{count} worlds',
  'delete.worldsWarning.one': 'This profile has a world save. It cannot be recovered afterwards.',
  'delete.worldsWarning.other':
    'This profile has {count} world saves. They cannot be recovered afterwards.',
  'delete.keptAt': 'The files stay at {path} — the launcher will simply stop listing them.',
  'delete.confirmWithFiles': 'Delete with files',
  'delete.confirmKeepFiles': 'Delete, keep files',

  // ── Where a new profile comes from ───────────────────────
  'packs.title': 'Where does this profile come from?',
  'packs.wrTitle': 'Play on the White Ravens servers',
  'packs.wrBody':
    'Pick one of our packs. The launcher installs it and keeps it in step with the server.',
  'packs.whitelist': 'Whitelist',
  'packs.whitelistNote':
    'Our servers run a whitelist — the pack installs straight away, but getting on the server has to be asked for.',
  'packs.scratchTitle': 'Build a pack from scratch',
  'packs.scratchBody':
    'An empty profile. Choose the Minecraft version and loader, add mods yourself.',
  'packs.importTitle': 'Import your own pack',
  'packs.importBody': 'A .mrpack file you already have, or a link to a manifest.',
  'packs.loading': 'Loading the pack list…',
  'packs.none': 'No packs are published yet.',
  'packs.listFailed': 'Could not load the pack list.',
  'packs.installFailed': 'Could not install {name}.',
  'packs.importFailed': 'Could not import that pack.',
  'packs.manifestFailed': 'That address holds neither a pack nor a manifest.',
  'packs.wrSyncNote': 'These profiles follow the server: every sync brings whatever changed.',
  'packs.mods.one': '{count} mod',
  'packs.mods.other': '{count} mods',
  'packs.fileTitle': 'A .mrpack file',
  'packs.fileBody':
    'The Modrinth pack format, which Prism, ATLauncher and the Modrinth app also read. Installed as a snapshot — it will not update itself.',
  'packs.chooseFile': 'Choose a file…',
  'packs.urlTitle': 'A pack link',
  'packs.urlBody':
    'A link to a .mrpack file — Modrinth’s “Download” link is one — or to a Raven Forge manifest. The launcher works out which it got; a manifest gives a profile that keeps updating from that address.',

  // ── Files left behind by a delete ────────────────────────
  'orphans.title': 'Leftover files',
  'orphans.hint':
    'Profiles you deleted but kept the files of. Restoring one puts it back exactly as it was.',
  'orphans.restore': 'Restore',
  'orphans.discard': 'Delete for good',

  'profiles.fieldMinecraft': 'Minecraft',
  'profiles.fieldLoader': 'Mod loader',
  'profiles.fieldRam': 'RAM',
  'profiles.fieldServer': 'Server',
  'profiles.manifestUrl': 'Manifest URL',
  'profiles.sync': 'Sync',
  'profiles.quickConnect': 'Quick connect: {address}',
  'profiles.notes': 'Notes',
  'profiles.lastPlayed': 'Last played: {date}',
  'profiles.totalPlayTime': '{hours} h total',
  'profiles.syncStatus.synced': 'In sync',
  'profiles.syncStatus.updates': 'Updates available ({count})',
  'profiles.syncStatus.error': 'Sync error',
  'profiles.syncStatus.never': 'Never synced',
  'profiles.verify.unsigned': 'Unsigned',
  'profiles.verify.notSynced': 'Not checked yet',
  'profiles.verify.valid': 'Verified: {signer}',
  'profiles.verify.invalid': 'Signature matches no trusted key',

  // ── Profile form ─────────────────────────────────────────
  'profileForm.createTitle': 'New profile',
  'profileForm.editTitle': 'Edit: {name}',
  'profileForm.iconAfterSave': 'You can set the profile icon once it is saved.',
  'profileForm.name': 'Profile name',
  'profileForm.namePlaceholder': 'e.g. Survival Server',
  'profileForm.mcVersion': 'Minecraft version',
  'profileForm.loader': 'Mod loader',
  'profileForm.versionsLoading': 'Loading versions…',
  'profileForm.versionsFailed': 'Could not load the version list — type it manually',
  'profileForm.noLoaderBuilds':
    '{loader} has no builds for Minecraft {mcVersion} — pick another version or loader',
  'profileForm.loaderUnstable': 'unstable',
  'profileForm.loaderVersionLatest': 'Latest',
  'profileForm.loaderVersion': 'Loader version (optional)',
  'profileForm.ram': 'RAM (MB)',
  'profileForm.manifestUrl': 'Manifest URL (optional)',
  'profileForm.serverIp': 'Server IP',
  'profileForm.serverPort': 'Port',
  'profileForm.javaArgs': 'Java arguments (optional)',
  'profileForm.notes': 'Notes',
  'profileForm.notesPlaceholder': 'Any notes about this profile',

  // ── Profile icon picker ──────────────────────────────────
  'profileIcon.label': 'Profile icon',
  'profileIcon.change': 'Change',
  'profileIcon.pick': 'Choose image',
  'profileIcon.formats': 'PNG, JPG, GIF, WebP or SVG — max 2 MB.',
  'profileIcon.presets': '…or pick one of the built-in ones:',
  'profileIcon.failed': 'Could not set the icon',
  'profileIcon.fileFilter': 'Images',

  // ── Mods ─────────────────────────────────────────────────
  'mods.title': 'Mods — {profile}',
  'mods.pickProfile': 'Select a profile in the Profiles tab to manage mods',
  'mods.tabInstalled': 'Installed',
  'mods.tabBrowse': 'Browse',
  'mods.searchModrinth': 'Search mods on Modrinth…',
  'mods.searchHint': 'Type a name or just press Search — the filters work on their own.',
  'mods.loaderFilter': 'Loader',
  'mods.searchFailed': 'Search failed',
  'mods.installFailed': 'Could not install {name}',
  'mods.empty': 'No mods installed',
  'mods.emptyHint': 'Search for mods in the Browse tab, or sync the profile with a manifest',
  'mods.fromManifest': 'from manifest',
  'mods.downloads.one': '{count} download',
  'mods.downloads.other': '{count} downloads',
  'mods.installedWithDeps': 'Installed {name}, along with what it needs: {deps}',

  // ── Compatibility ────────────────────────────────────────
  'compat.title': 'Does {name} fit this profile?',
  'compat.wrongLoader': 'No build for your mod loader — this one is published for: {loaders}',
  'compat.wrongVersion':
    'No build for your Minecraft version — the newest ones are for: {versions}',
  'compat.noBuild': 'This project publishes nothing that could be installed.',
  'compat.needsLoader':
    'This profile is vanilla, so it has no mod loader — a mod would never be read.',
  'compat.conflictsWith': 'Declared incompatible with something already installed: {names}',
  'compat.dependencyNoBuild': 'Needs something with no build for this profile: {names}',
  'compat.alsoInstalls': 'Also installs: {deps}',
  'compat.anywayHint':
    'Version {version} can be installed anyway — this data is what the author filled in, and it is often behind reality.',
  'compat.nothingToInstall': 'There is no file to install here.',
  'compat.installAnyway': 'Install anyway',
  'compat.badgeVersion': 'nothing for {version}',
  'compat.badgeLoader': 'nothing for {loader}',

  // ── Accounts ─────────────────────────────────────────────
  'accounts.title': 'Accounts',
  'accounts.loginMicrosoft': 'Sign in with Microsoft',
  'accounts.offlineMode': 'Offline mode',
  'accounts.privacyLink': 'What does Raven Forge do with my data?',
  'accounts.playerName': 'Player name',
  'accounts.empty': 'No accounts — sign in above',
  'accounts.active': '• active',
  'accounts.setActive': 'Set active',
  'accounts.manage': 'Account settings',
  'accounts.logout': 'Sign out',
  'accounts.loginFailed': 'Sign-in failed',
  'accounts.plaintextTitle': 'Credentials are not in the system keychain',
  'accounts.plaintextBody':
    'The OS keychain could not be used, so your Microsoft sign-in is stored unencrypted in {file} (readable only by your user). On Linux this usually means no keyring daemon — gnome-keyring or kwallet — is running. Start one and sign in again to move it back.',

  // ── Settings ─────────────────────────────────────────────
  'settings.title': 'Settings',
  'settings.loading': 'Loading settings…',
  'settings.section.appearance': 'Appearance',
  'settings.section.behavior': 'Behaviour',
  'settings.section.network': 'Network and downloads',
  'settings.section.sources': 'Content sources',
  'settings.section.trustedKeys': 'Trusted keys (Ed25519)',
  'settings.section.updates': 'Updates',
  'settings.installedVersion': 'Installed version: {version}',
  'settings.checkUpdates': 'Check for updates',
  'settings.downloadUpdate': 'Download update',
  'settings.restartToUpdate': 'Restart to install',
  'settings.updateUpToDate': 'You are on the newest release.',
  'settings.updateAvailable': 'Version {version} is available.',
  'settings.updateDevBuild': 'Running from source — there is no installed build to replace.',
  'settings.updateSystemPackage':
    'Installed from a system package. Update it with your package manager (apt, dnf), not from here.',
  'settings.updateUnsignedPlatform':
    'Self-update is not available on this platform yet. Download the newest release from GitHub.',
  'settings.updateCheckFailed': 'Could not check for updates.',
  'settings.updateCheckFailedWith': 'Could not check for updates: {error}',
  'settings.updateDownloadFailed': 'Could not download the update.',
  'settings.section.data': 'Data',
  'settings.theme': 'Theme',
  'settings.theme.dark': 'Dark',
  'settings.theme.oled': 'OLED black',
  'settings.theme.light': 'Light',
  'settings.language': 'Language',
  'settings.onLaunch': 'When the game starts',
  'settings.onLaunch.minimize': 'Minimise',
  'settings.onLaunch.close': 'Close',
  'settings.onLaunch.keepOpen': 'Stay open',
  'settings.showConsole': 'Show the game console',
  'settings.offlineMode': 'Always launch offline',
  'settings.offlineModeHint':
    'Never contacts the sign-in servers. Singleplayer and LAN only — online-mode servers refuse an offline session.',
  'settings.autoRemoveOrphans': 'Automatically remove orphaned mods',
  'settings.concurrency': 'Concurrent downloads (1–8)',
  'settings.concurrencyInvalid': 'Enter a number from 1 to 8.',
  'settings.proxy': 'Proxy URL (optional)',
  'settings.proxyPlaceholder': 'http:// or socks5://user:pass@host:port',
  'settings.proxyInvalid':
    'Not a valid address — use an http://, https://, socks4:// or socks5:// URL.',
  'settings.proxyHint':
    'HTTP, HTTPS and SOCKS4/5 are supported. With SOCKS, hostnames are resolved at the proxy, so nothing leaks to your local resolver.',
  'settings.feedPlaceholder': 'https://your-server.com/api/{feed}.json',
  'settings.newsFeed': 'News feed URL',
  'settings.feedInvalid': 'Not a valid URL. Leave it empty to turn the feed off.',
  'settings.announcementFeed': 'Announcement feed URL',
  'settings.trustedKeysHint':
    'The White Ravens key is built into the launcher, which is why White Ravens packs verify on a fresh install. Until you add a key of your own the launcher reports what it verified but blocks nothing. Adding one switches enforcement on: only a signed manifest that verifies is installed.',
  'settings.trustedKeyBuiltIn': 'Built into the launcher — always trusted',
  'settings.trustedKeyAdded': 'Added: {date}',
  'settings.trustedKeyName': 'Key name',
  'settings.trustedKeyNamePlaceholder': 'e.g. Raven SMP Admin',
  'settings.trustedKeyValue': 'Public key (base64)',
  'settings.trustedKeyAdd': 'Add key',
  'settings.trustedKeyFailed': 'Could not add the key',
  'settings.dataFolder': 'Data folder',
  'settings.crashReportsFolder': 'Crash reports',
  'settings.logs': 'Logs',
  'settings.showLogs': 'Show logs',
  'settings.reset': 'Reset settings',
  'settings.confirmReset': 'Reset all settings to their defaults?',

  // ── Log viewer ───────────────────────────────────────────
  'logs.title': 'Launcher logs',
  'logs.filterAll': 'Everything',
  'logs.filterWarn': 'Warnings',
  'logs.filterError': 'Errors',
  'logs.loading': 'Loading log…',
  'logs.readFailed': 'Could not read the log',
  'logs.empty': 'The log is empty — nothing has been written yet.',
  'logs.noMatches': 'No entries match the filter.',
  'logs.shown': '{visible} of {total} lines',
  'logs.paused': '• scrolling paused',
  'logs.errorCount.one': '{count} error',
  'logs.errorCount.other': '{count} errors',
  'logs.warnCount.one': '{count} warning',
  'logs.warnCount.other': '{count} warnings',

  // ── Progress overlay ─────────────────────────────────────
  'progress.title': 'Install progress',
  'progress.modSync': 'Syncing mods',
  'progress.modDownload': 'Downloading mods',
  'progress.loaderInstall': 'Installing mod loader',
  'progress.javaDownload': 'Downloading Java',
  'progress.gameAssets': 'Downloading game assets',
  'progress.launcherUpdate': 'Updating the launcher',
  'progress.files.one': '{done}/{total} file',
  'progress.files.other': '{done}/{total} files',

  // Progress lines named by the main process — see `ProgressKey` in ipc-types.
  'progress.msg.downloading': 'Downloading…',
  'progress.msg.downloadComplete': 'Download complete',
  'progress.msg.libraries': 'Minecraft libraries {version}',
  'progress.msg.assets': 'Game assets',
  'progress.msg.javaDownloading': 'Downloading Java {version}…',
  'progress.msg.javaReady': 'Java {version} downloaded',
  'progress.msg.syncing': 'Syncing {name}…',
  'progress.msg.synced.one': 'Synced {count} mod',
  'progress.msg.synced.other': 'Synced {count} mods',
  'progress.msg.loaderProfile': 'Downloading the {loader} profile…',
  'progress.msg.loaderInstalled': 'Installed {loader}',
  'progress.msg.installerDownloading': 'Downloading the {loader} installer…',
  'progress.msg.preparingGameFiles': 'Preparing the Minecraft files…',
  'progress.msg.preparingJava': 'Preparing the Java runtime…',
  'progress.msg.runningInstaller': 'Running the {loader} installer — this can take a few minutes…',
  'progress.msg.savingProfile': 'Saving the profile…',
  'progress.msg.updateDownloading': 'Downloading update… {percent}%',

  // ── Updater ──────────────────────────────────────────────
  'update.ready': 'Update ready',
  'update.available': 'Update available: v{version}',
  'update.willInstall': 'v{version} will be installed after a restart.',
  'update.pending': 'A new launcher version is ready to download.',
  'update.downloading': 'Downloading… {percent}%',
  'update.downloadFailed': 'Downloading the update failed',
  'update.installFailed': 'Installing the update failed',
  'update.hide': 'Hide notification',

  // ── Error boundary ───────────────────────────────────────
  'error.title': 'Something went wrong',
  'error.body': 'The launcher hit an unexpected error. Click below to try again.',
  'error.restart': 'Restart',

  // ── About ────────────────────────────────────────────────
  'about.tagline':
    'A custom Minecraft: Java Edition launcher with mod management, auto-sync from server manifests, and profiles.',
  'about.authorship':
    'Written from scratch by one person — {author} — under the {org} banner, for a server of his own and the players on it.',
  'about.stack': 'Electron + TypeScript + React + Vite + Tailwind CSS.',
  'about.secret': 'Secret of the forge',
  'about.privacy': 'Privacy',

  // ── Privacy ──────────────────────────────────────────────
  // Written for whoever is worried, not for whoever wrote the code: no file
  // names, no permission bits, no protocol names. docs/PRIVACY.md is where the
  // technical detail lives, and it is linked from the bottom of the page.
  'privacy.title': 'Privacy',
  'privacy.lead': 'Raven Forge collects nothing about you.',
  'privacy.leadBody':
    'No statistics, no profiling, no identifier for your computer. We do not run a server that receives your data — you have no account with us and there is no list anywhere with your name on it.',

  'privacy.never.title': 'What never happens',
  'privacy.never.telemetry':
    'Nothing is measured and nothing is reported back. There is nowhere for such data to go, which is why there is no switch to turn it off.',
  'privacy.never.identifier':
    'Your computer is never given a number that would let it be recognised again.',
  'privacy.never.upload':
    'When the game crashes, the report is saved on this computer. Nothing sends it anywhere — you decide whether to attach it to a bug report.',
  'privacy.never.account':
    'You do not set up an account with us. Your Minecraft account belongs to Microsoft, and you enter its password on their page, never in this launcher.',

  'privacy.local.title': 'What stays on this computer',
  'privacy.local.body':
    'All of it sits in one folder. Where that folder is depends on your system — this is the one this launcher is using:',
  'privacy.local.profiles':
    'Your profiles, and with them your worlds, screenshots, game settings and mods.',
  'privacy.local.settings':
    'Your launcher settings — the look, the language, and the addresses it downloads from.',
  'privacy.local.accounts': 'Your list of accounts: player name, and when you last signed in.',
  'privacy.local.logs':
    'A record of what the launcher has been doing. It can contain your player name and folder names, so look it over before sending it to anybody.',
  'privacy.local.crashes': 'Crash reports, with the sign-in details already taken out.',
  'privacy.local.keychain':
    'Your password is not kept here or anywhere else — you type it on Microsoft’s page, not in this launcher. What the launcher does keep is the pass Microsoft hands back, and it puts that in the safe your system provides for passwords, the same one your web browser uses. If your system offers no such safe, the launcher keeps it in its own folder instead and says so plainly on the Accounts screen.',

  'privacy.dest.title': 'Who the launcher talks to',
  'privacy.dest.body':
    'Asking any computer on the internet for something tells it your IP address — the number your internet provider gave your connection. That happens with every website you open, and with everything below. Nothing else about you goes with it.',
  'privacy.dest.nothing': 'Only the request for the files. Nothing about you.',
  'privacy.dest.auth.who': 'Microsoft, Xbox and Mojang',
  'privacy.dest.auth.when': 'when you sign in with Microsoft',
  'privacy.dest.auth.sends':
    'You sign in on Microsoft’s own page, in a window of its own — the launcher never sees your password. Back come your player name, your skin, and permission to start the game. In offline mode this never happens at all.',
  'privacy.dest.mojang.who': 'Mojang',
  'privacy.dest.mojang.when': 'when installing or starting the game',
  'privacy.dest.java.who': 'Adoptium',
  'privacy.dest.java.when': 'when the launcher installs Java for you',
  'privacy.dest.java.sends': 'Which version of Java is needed, and which system you are on.',
  'privacy.dest.loaders.who': 'Fabric, Forge, NeoForge and Quilt',
  'privacy.dest.loaders.when': 'when installing what mods need to run',
  'privacy.dest.modrinth.who': 'Modrinth',
  'privacy.dest.modrinth.when': 'when you look for mods',
  'privacy.dest.modrinth.sends':
    'What you type into the search box, and the filters you set. Nothing that says who you are — the request names the launcher that is asking, not the person.',
  'privacy.dest.packs.who': 'White Ravens',
  'privacy.dest.packs.when': 'news, and the list of server packs',
  'privacy.dest.updates.who': 'GitHub',
  'privacy.dest.updates.when': 'at every start, and when you check for updates',
  'privacy.dest.updates.sends':
    'One question: is there a newer version? It happens on its own at every start, and there is currently no way to switch that off.',
  'privacy.dest.feeds': 'News, as set up on this computer:',
  'privacy.dest.feedOff': 'off — nothing is being downloaded',

  'privacy.game.title': 'The game is its own program',
  'privacy.game.body':
    'Once the game starts, the launcher steps out of the way. The game checks with Mojang that the account is yours, and every server you join sees your IP address, your player name and your account number — exactly as it would with any other launcher.',
  'privacy.game.mods':
    'A mod is a program written by somebody else, and once it is running it can do anything you can do on this computer, including sending things over the internet. The launcher checks that a mod is exactly the file it was meant to download — it cannot check whether that file is honest. Install mods only from places you trust.',

  'privacy.control.title': 'What you decide',
  'privacy.control.offline':
    'Offline mode never contacts a sign-in server at all — you play on your own or on a home network.',
  'privacy.control.feeds': 'Clear the news address in Settings and nothing more is downloaded.',
  'privacy.control.proxy': 'A proxy sends everything through a server you choose yourself.',
  'privacy.control.delete':
    'Signing out deletes that account’s saved sign-in, and forgets it in the sign-in window too. Deleting the folder above removes everything else — on our side there is nothing to delete.',

  'privacy.fullPolicy': 'Read the full privacy policy',
  'privacy.fullPolicyHint':
    'Opens in your browser. The same ground covered in full, including the parts we know are imperfect.',

  // ── Bedrock card ─────────────────────────────────────────
  'bedrock.title': 'Looking for Minecraft: Bedrock Edition?',
  'bedrock.body':
    'Raven Forge supports Java Edition only. Bedrock Edition is available from minecraft.net or the Microsoft Store.',
  'bedrock.bundle':
    'If you own the Java & Bedrock bundle you already have it — you just need to install it from the Store.',
  'bedrock.open': 'Open minecraft.net',
  'bedrock.dismiss': 'Hide this notice',

  // ── Chronicle (About page easter egg) ────────────────────
  // Original prose written for this project. Emphasis markers are interpreted;
  // move them wherever the target language needs them.
  'chronicle.title': 'Chronicle of the Raven Forge',
  'chronicle.subtitle': 'scroll the seventh',
  'chronicle.subtitle2': 'on how the launcher was forged in a fire nobody remembers any more',
  'chronicle.close': 'Roll up the scroll',
  'chronicle.p1':
    'When the first worlds began to go dark and the gates between them grew over with silence, one furnace still burned in the belly of a dead mountain. It was fed neither coal nor wood — it burned on the stubbornness of those who refused to forget.',
  'chronicle.p2':
    'At the anvil stood the smith-priests of the Raven Order. They had no names, only rite-numbers and ash worked in under their fingernails. They held that every machine has a soul that must be woken — not by command, but by a request repeated until the metal answers.',
  'chronicle.p3':
    'For nine nights they quenched the core in a river of molten obsidian. For nine nights they sang a litany with not one human word in it — a plainchant of zeroes and ones, whispered so as not to wake what sleeps deeper.',
  'chronicle.p4':
    'On the tenth night the hammer fell for the last time. And the thing on the anvil opened an eye — amber, calm, older than the fire that forged it. The smiths swore afterwards that there was no gratitude in that look. There was *readiness*.',
  'chronicle.p5':
    'They named it the Raven Forge, because a raven finds its way home even when home is gone. They gave it one task and one promise: **to open gates to worlds, and to see that those who return have somewhere to return to.**',
  'chronicle.p6':
    'The Order long since crumbled to dust, the furnace went cold, the mountain fell in on itself. But under the glass and the light you are sitting in front of, that same spark is still smouldering. It is only waiting for someone to say: *play*.',
  'chronicle.colophon1': 'Whoever found this scroll found it by chance.',
  'chronicle.colophon2': 'Scrolls do not let themselves be found by chance.',
} as const;

export type TranslationKey = keyof typeof en;

type PluralBaseOf<K> = K extends `${infer Base}.other` ? Base : never;

/** Keys that exist in `.other` form — the ones `plural()` accepts as a base. */
export type PluralKey = PluralBaseOf<TranslationKey>;

/** CLDR categories. Which ones a language actually uses is up to the language. */
type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/**
 * Every locale must supply every key English defines — that is the whole point
 * of this type — *plus* whatever extra plural categories its own grammar needs.
 * English gets by on `.one`/`.other`; Polish also uses `.few` and `.many`, and
 * those cannot be required of every locale.
 */
export type Translations = Record<TranslationKey, string> &
  Partial<Record<`${PluralKey}.${PluralCategory}`, string>>;
