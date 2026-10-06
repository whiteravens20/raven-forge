// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

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
  'search.shown': 'Showing {shown} of {total}',
  'search.loadMore': 'Load more',
  'search.openProject': 'Open the {name} page on Modrinth',
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
  'common.export': 'Export',
  'common.import': 'Import',
  'common.back': 'Back',
  'common.close': 'Close',
  'common.dismiss': 'Dismiss',
  'common.refresh': 'Refresh',
  'common.openFolder': 'Open folder',
  'common.openFailed': 'Could not open {what}.',
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
  'home.cancelling': 'Cancelling…',
  'home.stopGame': 'Stop the game',
  'home.stopping': 'Stopping…',
  'home.stopFailed': 'Could not stop the game.',
  'home.authUnreachable':
    'Could not reach the Microsoft sign-in servers. You can play offline — singleplayer and LAN only, and online-mode servers will refuse the connection.',
  'home.launchOffline': 'Play offline',
  'home.updatingLauncher': 'Updating launcher…',
  'home.updateBeforePlay':
    'Play installs launcher {version} first: the launcher restarts, and Play has to be pressed once more.',
  'home.updateNotNow': 'Not now',
  'home.updateFailedPlayAnyway':
    'The launcher update could not be downloaded — the game will start anyway.',
  'home.launchFailed': 'Could not start the game',
  'launchError.alreadyRunning': 'This profile is already running.',
  'launchError.alreadyPreparing': 'This profile is already being prepared for launch.',
  'launchError.noAccount':
    'No account is selected. Add one or pick one on the Accounts page, then press Play again.',
  'launchError.ramTooBig':
    'This profile allocates {allocated} of RAM and this machine has {total}. Minecraft cannot start with more memory than the machine has — lower it in the profile editor, where {recommended} suits this one.',
  'launchError.loaderVersionUnknown':
    'Could not work out which {loader} build to use for Minecraft {version}. Check the connection, or pick a loader version in the profile editor.',
  'launchError.javaNotRuntime':
    'This profile is set to launch with {path}, and that is not a Java runtime this machine can run. Point it somewhere else in the profile editor, or clear the field to use the runtime the launcher installs itself.',
  'launchError.javaTooOld':
    'This profile is set to launch with {path}, which is Java {found}, and this version of Minecraft needs Java {required}. It would start and then stop with an error about class file versions. Clear the field to use the runtime the launcher installs itself.',
  'home.showConsole': 'Show console',
  'home.hideConsole': 'Hide console',
  'home.news': 'News',
  'home.refreshNews': 'Refresh news and announcements',
  'home.newsRefreshing': 'Refreshing…',
  'home.newsRefreshedSame': 'Checked at {time} — nothing new',
  'home.newsRefreshedNew.one': 'Checked at {time} — {count} new entry',
  'home.newsRefreshedNew.other': 'Checked at {time} — {count} new entries',
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
  'profiles.importDropped':
    'Profile imported. The file also carried fields an import deliberately leaves out: {fields}. They decide what runs on this computer, so set them yourself in the profile editor if you trust where the file came from.',
  'profiles.empty': 'No profiles',
  'profiles.emptyHint': 'Add your first profile with the + button',
  'profiles.pickOrCreate': 'Select a profile, or create a new one',
  'profiles.copyName': '{name} (copy)',
  'profiles.duplicate': 'Duplicate, with its mods, settings and worlds',
  'profiles.duplicated':
    'The copy has the same mods, configs, shaders, resource packs and worlds as the original. The world backups stay with the original.',
  'profiles.duplicateFailed': 'Could not duplicate the profile.',
  'profiles.deleteFailed': 'Could not delete the profile.',
  'profiles.openFolder': 'Open profile folder',
  'profiles.exportPack': 'Export as a modpack (.mrpack)',
  'profiles.exportPackFailed': 'Could not export that profile as a pack.',
  'profiles.exportPackAsk': 'The pack will hold this profile’s mods, shaders and resource packs.',
  'profiles.exportPackSettings': 'Include the game settings and the mods’ configuration',
  'profiles.exportPackSettingsHint':
    'That is options.txt and the config folder: key bindings, video settings and each mod’s own options, as they are on this computer. The server you last joined is left out either way.',
  'profiles.exportPackGo': 'Choose where to save…',
  'profiles.exportPackDone.one': 'Saved to {path}. The pack links to one file on Modrinth.',
  'profiles.exportPackDone.other': 'Saved to {path}. The pack links to {count} files on Modrinth.',
  'profiles.exportPackBundled.one':
    'One more file ({size}) is not on Modrinth, so it was written into the pack itself.',
  'profiles.exportPackBundled.other':
    'Another {count} files ({size}) are not on Modrinth, so they were written into the pack itself.',
  'profiles.exportPackSkipped.one': 'Left out one item that is switched off.',
  'profiles.exportPackSkipped.other': 'Left out {count} items that are switched off.',

  // ── Worlds and backups ───────────────────────────────────
  'worlds.title': 'Worlds',
  'worlds.none': 'This profile has no worlds yet.',
  'worlds.backupNow': 'Back up',
  'worlds.backedUp': 'The worlds were copied aside.',
  'worlds.backupFailed': 'Could not back up the worlds.',
  'worlds.noBackups': 'No copies yet. One is taken automatically before a version change.',
  'worlds.restore': 'Restore this copy',
  'worlds.confirmRestore': 'Replace the current worlds?',
  'worlds.confirmRestoreYes': 'Replace',
  'worlds.confirmDelete': 'Delete this backup?',
  'worlds.restored': 'The worlds were restored.',
  'worlds.restoredWithSafety':
    'The worlds were restored. What was there before is now a copy of its own, so this is undoable.',
  'worlds.restoreFailed': 'Could not restore that copy.',
  'worlds.deleteFailed': 'Could not delete that copy.',
  'worlds.reason.manual': 'taken by hand',
  'worlds.reason.version-change': 'before a version change',
  'worlds.reason.before-restore': 'before a restore',

  // ── Changing the Minecraft version ───────────────────────
  'versionChange.title': 'Move this profile from {from} to {to}?',
  'versionChange.mods.one':
    'Its one installed mod was built for {from} and will probably not load.',
  'versionChange.mods.other':
    'Its {count} installed mods were built for {from} and will probably not load. Update or remove them afterwards.',
  'versionChange.worlds.one':
    'It has a world. Opening a world with a newer Minecraft upgrades its format, and the older version cannot open it again.',
  'versionChange.worlds.other':
    'It has {count} worlds. Opening a world with a newer Minecraft upgrades its format, and the older version cannot open it again.',
  'versionChange.backupFirst': 'Copy the worlds aside first',
  'versionChange.backupHint':
    'The copy stays inside the profile and can be restored from the profile page.',
  'versionChange.confirm': 'Change the version',
  'versionChange.backupFailed': 'The worlds could not be copied, so nothing was changed.',
  // ── Deleting a profile ───────────────────────────────────
  'delete.title': 'Delete profile "{name}"',
  'delete.intro':
    'The profile disappears from the launcher either way. What happens to its files is up to you.',
  'delete.alsoFiles': 'Delete the files too',
  'delete.counting': 'Checking what is there…',
  'delete.countFailed': 'What is in the folder could not be counted — there may be worlds in it.',
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
  'packs.modrinthTitle': 'Find a pack on Modrinth',
  'packs.modrinthBody': 'Search public modpacks and install one as a new profile.',
  'packs.searchModrinth': 'Search modpacks on Modrinth…',
  'packs.modrinthNote':
    'The newest version of the pack that fits the filters above is installed — as a snapshot, which will not update itself.',
  'packs.importTitle': 'Import',
  'packs.importBody':
    'A .mrpack pack file, a link to a pack, or a profile file exported from the launcher.',
  'packs.loading': 'Loading the pack list…',
  'packs.none': 'No packs are published yet.',
  'packs.listFailed': 'Could not load the pack list.',
  'packs.listRetry': 'Try again',
  'packs.installFailed': 'Could not install {name}.',
  'packs.installUnfinished':
    'Profile “{name}” was created, but its files did not all arrive. Press “{action}” on the profile and the install carries on from where it stopped. The reason given: {error}',
  'packs.importFailed': 'Could not import that pack.',
  'packs.manifestFailed': 'That address holds neither a pack nor a manifest.',
  'packs.wrSyncNote': 'These profiles follow the server: every sync brings whatever changed.',
  'packs.mods.one': '{count} mod',
  'packs.mods.other': '{count} mods',
  'packs.profileFileTitle': 'A profile file (.json)',
  'packs.profileFileBody':
    'The settings of one profile, as saved by “Export” in this launcher: Minecraft version, loader, RAM, server. No mods and no worlds — a .mrpack pack carries those.',
  'packs.profileFileFailed': 'Could not import that profile file.',
  'packs.fileTitle': 'A pack file (.mrpack)',
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
  'orphans.confirmDiscard': 'Delete these files, worlds included?',
  'orphans.discardFailed': 'Could not delete those files.',

  'profiles.fieldMinecraft': 'Minecraft',
  'profiles.fieldLoader': 'Loader',
  'profiles.fieldRam': 'RAM',
  'profiles.fieldServer': 'Server',
  'profiles.manifestUrl': 'Manifest URL',
  'profiles.sync': 'Sync',
  'profiles.syncBlocked':
    'Not while the game is running or starting — a sync changes the mods it is using.',
  'profiles.importedPack': 'Imported pack',
  'profiles.importedPackHint':
    'A snapshot — it does not update itself. Repair checks the files against the pack this profile was made from and downloads whatever is missing.',
  'profiles.repair': 'Repair',
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
  'profileForm.loader': 'Loader',
  'profileForm.versionsLoading': 'Loading versions…',
  'profileForm.versionsFailed': 'Could not load the version list — type it manually',
  'profileForm.noLoaderBuilds':
    '{loader} has no builds for Minecraft {mcVersion} — pick another version or loader',
  'profileForm.loaderUnstable': 'prerelease',
  'profileForm.loaderRecommended': 'recommended',
  'profileForm.loaderVersion': 'Loader version',
  'profileForm.loaderVersionAuto': 'chosen at the first launch',
  'profileForm.ram': 'Allocated RAM',
  'profileForm.ramMachine': 'This machine has {total}. Recommended for it: {recommended}.',
  'profileForm.ramTight':
    '{value} leaves this machine ({total}) very little for anything else — the game may stutter, or be shut down while it runs.',
  'profileForm.ramOver':
    '{value} is more than this machine has ({total}). Minecraft will not start with it.',
  'profileForm.ramUseRecommended': 'Use {recommended}',
  'profileForm.ramRange': 'Between {min} and {max} MB.',
  'profileForm.manifestUrlInvalid': 'That is not an address. It has to start with https://',
  'profileForm.serverPortRange': 'A port is a whole number from 1 to 65535.',
  'profileForm.saveRefused': 'The profile was not saved.',
  'profileForm.saveFailed': 'The launcher gave no reason.',
  'profileForm.manifestUrl': 'Manifest URL (optional)',
  'profileForm.serverIp': 'Server IP',
  'profileForm.serverPort': 'Port',
  'profileForm.javaArgs': 'Java arguments (optional)',
  'profileForm.javaArgsShort': 'Java arguments',
  'profileForm.java': 'Java runtime',
  'profileForm.javaManaged': 'The one the launcher installs',
  'profileForm.javaBrowse': 'Choose a file…',
  'profileForm.javaChecking': 'Checking…',
  'profileForm.javaFound': 'Java {version}.',
  'profileForm.javaTooOld': 'Java {version} — this Minecraft version needs Java {required}.',
  'profileForm.javaNotJava': 'That file is not a Java runtime.',
  'profileForm.javaHint':
    'The launcher installs and keeps the right runtime for each Minecraft version. Choose one here only if this profile needs a particular JVM.',
  'profileForm.showSnapshots': 'Show snapshots',
  'profileForm.snapshotHint':
    'Snapshots are Mojang’s weekly test builds. Most mods have no build for one, and a world made in a snapshot may not open in the release that follows it.',
  'profileForm.advanced': 'Advanced',
  'profileForm.windowWidth': 'Game window width',
  'profileForm.windowHeight': 'Game window height',
  'profileForm.windowSizeHint': 'Leave both empty to let the game choose its own window size.',
  'profileForm.windowSizeBoth':
    'Set both or neither — the game only takes a window size as a pair.',
  'profileForm.windowSizeRange': 'Between {minWidth}×{minHeight} and {max}×{max}.',
  'profileForm.windowMode': 'Window mode',
  'profileForm.windowModeGame': 'However the game left it',
  'profileForm.windowModeWindowed': 'Windowed',
  'profileForm.windowModeFullscreen': 'Fullscreen',
  'profileForm.windowModeHint':
    'Anything other than “however the game left it” is written into the game’s own settings at every launch, so it also overrules an F11 from the last session.',
  'profileForm.gameLanguage': 'Game language',
  'profileForm.gameLanguageGame': 'As set in the game (English to begin with)',
  'profileForm.gameLanguageHint':
    'Minecraft starts in English and remembers the language picked in its own settings. A language chosen here is written into the game’s settings every time this profile starts, so it overrules a change made in the game itself.',
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
  'mods.fromManifest': 'from the pack',
  'mods.source.modrinth': 'Modrinth',
  'mods.source.url': 'direct link',
  'mods.source.local': 'local file',
  'mods.downloads.one': '{count} download',
  'mods.downloads.other': '{count} downloads',
  'mods.installedWithDeps': 'Installed {name}, along with what it needs: {deps}',
  'mods.checkUpdates': 'Check for updates',
  'mods.checkUpdatesFailed': 'Could not check for updates.',
  'mods.updatesFound.one': '{count} mod has a newer build.',
  'mods.updatesFound.other': '{count} mods have newer builds.',
  'mods.upToDate': 'Everything installed by hand is current.',
  'mods.noneToCheck': 'Nothing here to check — this profile’s mods come from its manifest.',
  'mods.unknownToModrinth.one': '{count} file is not on Modrinth and cannot be checked.',
  'mods.unknownToModrinth.other': '{count} files are not on Modrinth and cannot be checked.',
  'mods.updateAll': 'Update all',
  'mods.update': 'Update',
  'mods.updateTo': 'new: {version}',
  'mods.updated': 'Updated: {names}',
  'mods.updateFailed': 'Could not update: {names}',
  'mods.toggleFailed': 'Could not switch {name}.',
  'mods.removeFailed': 'Could not remove {name}.',
  'mods.gameBusy': 'Not while the game is running or starting — it is using these files.',

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
  'accounts.logoutAsk':
    'Sign {name} out of the launcher? The saved sign-in is removed from this computer.',
  'accounts.failed': 'That did not work.',
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
  'settings.onLaunchCloseHint':
    'The launcher window goes away once the game is running, and the launcher quits when the game does. If the game crashes the window comes back instead, so the crash report is not missed.',
  'settings.showConsole': 'Show the game console',
  'settings.offlineMode': 'Always launch offline',
  'settings.offlineModeHint':
    'Never contacts the sign-in servers. Singleplayer and LAN only — online-mode servers refuse an offline session.',
  'settings.discordPresence': 'Show the game on your Discord status',
  'settings.discordPresenceHint':
    'While the game runs, your status shows the profile name, version and loader — never the ' +
    'server address. Everyone who can see your Discord profile can see it. Presence mods such ' +
    'as CraftPresence will fight with it: Discord shows one activity at a time.',
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
  'settings.allowUnverifiedInstaller': 'Allow unverified loader installers',
  'settings.allowUnverifiedInstallerHint':
    'A Forge or NeoForge installer is a Java program the launcher runs. Normally it is checked against the checksum its repository publishes, and refused when there is none. Turn this on only if an older version you need publishes no checksum.',
  'settings.trustedKeyBuiltIn': 'Built into the launcher — always trusted',
  'settings.trustedKeyAdded': 'Added: {date}',
  'settings.trustedKeyName': 'Key name',
  'settings.trustedKeyNamePlaceholder': 'e.g. Raven SMP Admin',
  'settings.trustedKeyValue': 'Public key (base64)',
  'settings.trustedKeyAdd': 'Add key',
  'settings.trustedKeyFailed': 'Could not add the key',
  'settings.trustedKeyInvalid':
    'That is not an Ed25519 public key. One is 32 bytes in base64: 44 characters, the last of them “=”. A PEM block, or a key as OpenSSL exports it, is a longer format and will not work.',
  'settings.trustedKeyDuplicate': 'That key is already on the list.',
  'settings.trustedKeyUnusable':
    'Not an Ed25519 public key: it can verify nothing, and being on the list it still makes a signature required. Remove it.',
  'settings.trustedKeyRemoveFailed': 'Could not remove the key',
  'settings.trustedKeyConfirm': 'Remove this key?',
  'settings.trustedKeyConfirmLast':
    'Remove the last key? Signatures will no longer be required of packs from outside White Ravens.',
  'settings.dataFolder': 'Data folder',
  'settings.dataFolderHint':
    'Profiles, mods, game files, downloaded Java runtimes, logs and crash reports. Several gigabytes once a pack is installed. The full list, with sizes, is below.',
  'settings.dataFolderChange': 'Move…',
  'settings.dataFolderRestore': 'Back to the default',
  'settings.dataFolderEnv':
    'Set for this install by RAVENFORGE_DATA_DIR, so it cannot be changed here.',
  'settings.dataFolderUnavailable':
    'The chosen folder {path} could not be opened — the drive is unplugged or the folder is gone — so the launcher is using the default one. What was there is still there; plug the drive in and start the launcher again.',
  'settings.dataFolderForget': 'Forget that folder',
  'settings.dataFolderForgetHint':
    'The launcher stops looking for it and stays with the default folder. Nothing in the unreachable folder is touched.',
  'settings.logs': 'Logs',
  'settings.showLogs': 'Show logs',
  'settings.reset': 'Reset settings',
  'settings.confirmReset': 'Reset all settings to their defaults?',

  // ── Data folder ──────────────────────────────────────────
  'dataRoot.title': 'Move the data folder',
  'dataRoot.from': 'Now',
  'dataRoot.to': 'New location',
  'dataRoot.moveSameVolume':
    '{size} moves across. It is the same disk, so the files are moved without being copied — this takes a moment.',
  'dataRoot.moveCopy':
    '{size} moves across. The files are copied to the other disk, compared with the originals, and only then removed from the old location. If anything goes wrong, everything stays where it was.',
  'dataRoot.staysHome':
    'Only what is not data stays in the old folder: the file data-root.txt, which points at the new location, and the folder browser, which holds the launcher window’s own files.',
  'dataRoot.staysNothing': 'The old folder is emptied and removed.',
  'dataRoot.replacesDebris':
    'The new location holds empty launcher files, or what an unfinished move left behind — they are replaced.',
  'dataRoot.warnSpaces':
    'This path has spaces in it. Minecraft copes, but some mods and tools do not — a folder without spaces is the safer choice.',
  'dataRoot.warnNonAscii':
    'This path has characters outside the basic alphabet in it (accented letters, for example). Some mods cannot cope with them — a folder made of A–Z, digits and hyphens is the safer choice.',
  'dataRoot.done': 'Done — the launcher now uses the new folder.',
  'dataRoot.leftovers':
    'These old copies could not be removed. The data is safe in the new location and these files are no longer needed — you can delete them by hand:',
  'dataRoot.adopt':
    'That folder already holds launcher profiles, so it is used as it is — nothing is copied, and what is in the current folder stays there.',
  'dataRoot.free': 'Free at the destination: {free}',
  'dataRoot.restartNotice': 'The launcher restarts once the move is done.',
  'dataRoot.confirm': 'Move and restart',
  'dataRoot.confirmAdopt': 'Use this folder and restart',
  'dataRoot.moving': 'Moving data…',
  'dataRoot.restarting': 'The launcher is about to restart…',
  'dataRoot.failed': 'The data folder could not be moved: {error}',
  'dataRoot.problem.same': 'That is already the folder in use.',
  'dataRoot.problem.nested': 'That folder is inside the current one — pick one outside it.',
  'dataRoot.problem.notWritable': 'Nothing can be written to that folder.',
  'dataRoot.problem.notEmpty':
    'That folder holds other files, and the “raven-forge-launcher” folder the launcher would make inside it is taken as well. Pick somewhere else.',
  'dataRoot.problem.noSpace': 'Not enough room: {size} to move, {free} free.',
  'dataRoot.problem.envLocked':
    'RAVENFORGE_DATA_DIR decides where the data lives for this install.',
  'dataRoot.problem.gameRunning':
    'Close the game first, and wait for any download to finish — the launcher is working on these files right now.',

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
  'progress.titleInstalling': 'Downloading and installing',
  'progress.titlePreparing': 'Preparing to launch',
  'progress.titleChecking': 'Checking files',
  'progress.modSync': 'Syncing mods',
  'progress.loaderInstall': 'Installing the loader',
  'progress.javaDownload': 'Downloading Java',
  'progress.gameAssets': 'Game files',
  'progress.launcherUpdate': 'Updating the launcher',
  'progress.files.one': '{done}/{total} file',
  'progress.files.other': '{done}/{total} files',

  // Progress lines named by the main process — see `ProgressKey` in ipc-types.
  // Two lines for the two halves of a pack sync, so the counter under the bar
  // says which one it is counting.
  'progress.msg.checkingFiles': 'Checking the installed files…',
  'progress.msg.downloadingFile': 'Downloading {name}…',
  // Checking is its own phase and gets its own wording. On a launch with the
  // game fully installed it is the only phase there is, and calling it a
  // download made the launcher look like it was re-fetching Minecraft every
  // time somebody pressed Play.
  'progress.msg.checkingLibraries': 'Checking the Minecraft {version} libraries…',
  'progress.msg.checkingAssets': 'Checking the game assets…',
  'progress.msg.downloadComplete': 'Download complete',
  'progress.msg.gameFilesReady': 'Game files ready — nothing to download',
  'progress.msg.libraries': 'Downloading the Minecraft {version} libraries…',
  'progress.msg.assets': 'Downloading the game assets…',
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
  'progress.msg.movingData': 'Moving data…',

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
  'error.body':
    'The launcher hit an unexpected error. Reloading the window below starts its interface again — a game that is running is left alone.',
  'error.reload': 'Reload the window',

  // ── About ────────────────────────────────────────────────
  'about.tagline':
    'A custom Minecraft: Java Edition launcher with mod management, auto-sync from server manifests, and profiles.',
  'about.authorship':
    'Written from scratch by one person — {author} — under the {org} banner, for a server of his own and the players on it.',
  'about.stack': 'Electron + TypeScript + React + Vite + Tailwind CSS.',
  'about.secret': 'Secret of the forge',
  'about.privacy': 'Privacy',
  'about.legal':
    'Free software under the GNU Affero General Public License, version 3: you may share and change it on the terms of that licence. It comes with no warranty.',

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
    'Below is everything the launcher writes on this computer — with where it is and how much, measured a moment ago on your disk rather than described from memory.',
  'storage.total': 'On disk in all: {size}',
  'storage.measuring': 'Measuring the files on disk…',
  'storage.refresh': 'Measure again',
  'storage.failed': 'The launcher’s files could not be measured.',
  'storage.openFailed': 'That folder could not be opened.',
  'storage.nothingYet': 'nothing yet',
  'storage.groupData': 'The data folder — the one that moves',
  'storage.groupHome': 'The launcher folder — it stays put',
  'storage.groupSystem': 'Outside those two folders',
  'storage.homeIsData': 'Until you move the data, this is the same folder as the one above.',
  'storage.profiles.title': 'Profiles',
  'storage.profiles.body':
    'Each profile has a folder of its own here: worlds, mods, resource packs, shaders, screenshots, game settings and world backups. It is the one thing on this list that cannot be downloaded again.',
  'storage.gameFiles.title': 'Game files',
  'storage.gameFiles.body':
    'Minecraft versions, libraries and assets downloaded from Mojang, shared by every profile. Deleted, they are downloaded again at the next launch.',
  'storage.java.title': 'Java runtimes',
  'storage.java.body':
    'The Java the launcher downloaded for the Minecraft versions that need it. Deleted, it is downloaded again.',
  'storage.loaders.title': 'Loaders',
  'storage.loaders.body': 'The installed builds of Fabric, Quilt, Forge and NeoForge.',
  'storage.state.title': 'Settings and lists',
  'storage.state.body':
    'Three files: settings.json (launcher settings), profiles.json (the list of profiles) and auth.json (the list of accounts: player name and account id, no password).',
  'storage.logs.title': 'Logs',
  'storage.logs.body':
    'A record of what the launcher did and what the game printed. It has your player name and folder paths in it, so read it before sending it to anyone.',
  'storage.crashReports.title': 'Crash reports',
  'storage.crashReports.body':
    'One file per game crash, with the token and the account details already taken out. They are sent nowhere — you decide whether to attach one to a report.',
  'storage.browser.title': 'The launcher window’s files',
  'storage.browser.body':
    'The launcher’s window is an embedded browser, and this is where it keeps its own files: a cache of images (mod icons, news pictures), the announcements you dismissed, and the cookies of the Microsoft sign-in page.',
  'storage.pointer.title': 'Pointer to the data folder',
  'storage.pointer.body':
    'A text file with one line: the path of the data folder. It is how the launcher and the uninstaller find data that has been moved.',
  'storage.updateCache.title': 'A downloaded launcher update',
  'storage.updateCache.body':
    'The installer of a new version, downloaded and waiting to be installed.',
  'storage.program.title': 'The program',
  'storage.program.body': 'The launcher itself — what the installer put here.',
  'storage.legacyHome.title': 'A folder from an older version',
  'storage.legacyHome.body':
    'Versions up to 0.7.1 used this folder. This version has its own and leaves this one alone — check that nothing you need is still in it.',
  'storage.keychain.title': 'The Microsoft sign-in — in the system’s credential store',
  'storage.keychain.what':
    'The launcher does not know your password and does not keep it: you type it on Microsoft’s own page. Microsoft sends back two keys and only those are stored — a refresh token, which lets the launcher renew the sign-in without asking for the password, and a Minecraft session token, good for about a day.',
  'storage.keychain.windows':
    'On Windows they go into Credential Manager: Control Panel → User Accounts → Credential Manager → Windows Credentials, the entries beginning “com.ravenforge.launcher”. Windows encrypts them with your user account; programs running as you can ask for them, other users of the computer cannot.',
  'storage.keychain.linux':
    'On Linux they go into the desktop’s keyring through the Secret Service: GNOME Keyring (the “Passwords and Keys” app) or KWallet (KWalletManager), as entries of the service “com.ravenforge.launcher”. The keyring is encrypted with your login password and open for as long as you are logged in; programs in your session can read from it.',
  'storage.keychain.mac':
    'On macOS they go into the Keychain (the “Keychain Access” app), as entries of the service “com.ravenforge.launcher”.',
  'storage.keychain.none': 'On this computer: no entries — no Microsoft account is signed in.',
  'storage.keychain.count.one': 'On this computer: {count} entry.',
  'storage.keychain.count.other':
    'On this computer: {count} entries, two for each Microsoft account.',
  'storage.keychain.unavailable':
    'On this computer the credential store does not answer. The Microsoft sign-in is then kept in the file auth.json in the data folder, readable only by your user — the Accounts page says so outright.',
  'storage.keychain.remove':
    '“Sign out” on the Accounts page removes both of that account’s entries. You can also delete them by hand in the place described above — the launcher will then ask you to sign in again.',

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
  'privacy.dest.loaders.when': 'when choosing and installing a loader',
  'privacy.dest.modrinth.who': 'Modrinth',
  'privacy.dest.modrinth.when':
    'when you look for mods and packs, open the list of what is installed, or check for updates',
  'privacy.dest.modrinth.sends':
    'What you type in the search box, and the filters you set. Opening a profile’s list of mods, shaders or resource packs sends the identifiers of the ones you have — that is how the launcher fetches their descriptions and icons, and it remembers the answer for a week. Checking for updates, or exporting a pack, also sends a hash of each mod file in that profile. Nothing that says who you are — the request introduces the launcher that is asking, not a person.',
  'privacy.dest.packs.who': 'White Ravens',
  'privacy.dest.packs.when': 'news, the list of server packs, and the packs themselves',
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
    'Signing in: Settings → Behaviour → “Always launch offline”. The launcher then never contacts the Microsoft, Xbox or Mojang sign-in servers; game files and mods are still downloaded. An offline account (Accounts → Offline mode) signs in nowhere at all.',
  'privacy.control.feeds':
    'News: Settings → Content sources. Clear both addresses and the launcher stops fetching news and announcements. Enter your own and it asks only those.',
  'privacy.control.proxy':
    'A proxy: Settings → Network and downloads → Proxy URL. Every connection the launcher makes — downloads, sign-in, images — goes through the server you name. The game, once it is running, connects for itself and is not covered by the launcher’s proxy.',
  'privacy.control.discord':
    'Discord: Settings → Behaviour → “Show the game on your Discord status”, off by default. Switched on, it shows the profile’s name, version and loader to everyone who can see your Discord profile — never a server address.',
  'privacy.control.packs':
    'Packs: a profile that follows a pack asks the address in its “Manifest URL” field about it — when the launcher starts and before every launch of the game. Remove that address in the profile editor and the profile stops asking, and stops updating.',
  'privacy.control.updates':
    'Launcher updates: checked at every start with one request to GitHub. This cannot be switched off yet.',
  'privacy.control.diagnostics':
    'Logs and crash reports: they do not leave the computer until you send them to someone yourself. “Report a bug” opens the issue page in your browser, and you attach the file by hand.',
  'privacy.control.location':
    'Where it all is: Settings → Data → “Move…” moves the data folder to wherever you point.',
  'privacy.control.delete':
    'Deleting: “Sign out” on the Accounts page erases that account’s saved sign-in — its entries in the system’s credential store and the sign-in window’s cookies. Deleting the data folder and the launcher folder listed above removes everything else; the Windows uninstaller asks about it outright. There is nothing on our side to delete.',

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
