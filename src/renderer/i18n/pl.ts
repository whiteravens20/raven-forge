import type { Translations } from './en';

/**
 * Polish dictionary — the launcher's original and primary language.
 *
 * Typed as `Translations`, so anything missing from `en.ts` (or missing here)
 * fails the typecheck rather than surfacing as a raw key in the UI.
 */
export const pl: Translations = {
  // ── Navigation ───────────────────────────────────────────
  'nav.label': 'Nawigacja launchera',
  'nav.home.short': 'Home',
  'nav.home.title': 'Strona główna',
  'nav.profiles.short': 'Profile',
  'nav.profiles.title': 'Profile',
  'nav.mods.short': 'Mody',
  'nav.mods.title': 'Mody',
  'nav.content.short': 'Wygląd',
  'nav.content.title': 'Shadery i paczki zasobów',
  'content.title': 'Shadery i paczki zasobów — {profile}',
  'content.pickProfile': 'Najpierw wybierz profil.',
  'content.kindLabel': 'Rodzaj zawartości',
  'content.shaders': 'Shadery',
  'content.resourcePacks': 'Paczki zasobów',
  'content.tabInstalled': 'Zainstalowane',
  'content.tabBrowse': 'Przeglądaj',
  'content.searchShaders': 'Szukaj shaderów na Modrinth…',
  'content.searchPacks': 'Szukaj paczek zasobów na Modrinth…',
  'content.searchFailed': 'Wyszukiwanie nie powiodło się.',
  'content.installFailed': 'Nie udało się zainstalować {name}.',
  'content.removeFailed': 'Nie udało się usunąć.',
  'content.reorderFailed': 'Nie udało się zapisać nowej kolejności.',
  'content.emptyShaders': 'Brak zainstalowanych shaderów',
  'content.emptyPacks': 'Brak zainstalowanych paczek zasobów',
  'content.emptyHint':
    'Przeglądaj, żeby coś dodać, albo pozwól synchronizacji manifestu je przynieść.',
  'content.orderHint': 'Wygrywa góra listy. Paczka zmienia tylko to, czego nie ruszyły te pod nią.',
  'content.moveUp': 'Przesuń {name} w górę',
  'content.moveDown': 'Przesuń {name} w dół',
  'content.loaderFilter': 'Loader shaderów',
  'content.facet.resolutions': 'Rozdzielczość',
  'content.facet.features': 'Zawiera',
  'content.facet.categories': 'Kategoria',
  'content.facet.performanceImpact': 'Wydajność',
  'content.browseHint': 'Zawęź filtrami albo wpisz nazwę — jedno i drugie działa osobno.',
  'content.filterAny': 'Dowolna',
  'content.shadersNeedIris':
    'Shadery wymagają loadera shaderów. Przy pierwszej instalacji shadera launcher zaproponuje te, które działają na tym profilu.',
  'content.loaderInstalled': 'Zainstalowano {name} — profil może już wczytywać paczki shaderów.',
  'content.loaderInstalledWithDeps':
    'Zainstalowano {name} wraz z {deps}, których wymaga. Profil może już wczytywać paczki shaderów.',
  'content.loaderNoBuild':
    'Żaden loader shaderów nie ma wydania dla {loader} na Minecraft {version}, więc ta paczka jeszcze się nie wczyta.',
  'content.loaderUnsupported':
    'Ten profil jest vanilla. Shadery wymagają loadera modów — przełącz profil na Fabric, Quilt, Forge albo NeoForge.',
  'content.loaderFailed': 'Paczka shaderów się zainstalowała, ale loader shaderów nie: {error}',

  // ── Wybór loadera shaderów ───────────────────────────────
  'shaderLoader.title': 'Który loader shaderów?',
  'shaderLoader.why':
    'Paczkę shaderów musi coś odczytać. Wybierz loader, a launcher doda go do tego profilu.',
  'shaderLoader.alsoInstalls': 'Zainstaluje też: {deps}',
  'shaderLoader.skip': 'Nie teraz',

  // ── Filtry wyszukiwania (mody, shadery, paczki zasobów) ──
  'search.gameVersion': 'Wersja Minecraft',
  'search.noResults': 'Brak wyników.',
  'search.noResultsFiltered':
    'Brak wyników. Filtry powyżej łączą się przez ORAZ, więc projekt bez wersji na {version} się nie pokaże — poluzuj któryś.',
  'nav.accounts.short': 'Konta',
  'nav.accounts.title': 'Konta',
  'nav.settings.short': 'Opcje',
  'nav.settings.title': 'Ustawienia',
  'nav.about.short': 'Info',
  'nav.about.title': 'Informacje',

  // ── Window controls ──────────────────────────────────────
  'window.minimize': 'Minimalizuj',
  'window.maximize': 'Maksymalizuj',
  'window.restore': 'Przywróć',
  'window.close': 'Zamknij',

  // ── Shared vocabulary ────────────────────────────────────
  'common.save': 'Zapisz',
  'common.cancel': 'Anuluj',
  'common.add': 'Dodaj',
  'common.remove': 'Usuń',
  'common.delete': 'Usuń',
  'common.edit': 'Edytuj',
  'common.duplicate': 'Duplikuj',
  'common.export': 'Eksportuj',
  'common.import': 'Importuj',
  'common.back': 'Wstecz',
  'common.close': 'Zamknij',
  'common.dismiss': 'Odrzuć',
  'common.refresh': 'Odśwież',
  'common.openFolder': 'Otwórz folder',
  'common.choose': 'Wybierz...',
  'common.copy': 'Kopiuj',
  'common.copied': 'Skopiowano',
  'common.restart': 'Uruchom ponownie',
  'common.later': 'Później',
  'common.download': 'Pobierz',
  'common.search': 'Szukaj',
  'common.install': 'Instaluj',
  'common.installed': 'Zainstalowano',
  'common.enable': 'Włącz',
  'common.disable': 'Wyłącz',
  'common.show': 'Pokaż',
  'common.hide': 'Ukryj',

  // ── Home ─────────────────────────────────────────────────
  'home.signedInAs': 'Zalogowano jako',
  'home.notSignedIn': 'Nie zalogowano — przejdź do zakładki Konta',
  'home.noProfiles': 'Brak profili — utwórz nowy w zakładce Profile',
  'home.play': 'GRAJ',
  'home.running': 'Uruchomiona...',
  'home.preparing': 'Uruchamianie...',
  'home.cancelLaunch': 'Anuluj',
  'home.authUnreachable':
    'Nie udało się połączyć z serwerami logowania Microsoft. Możesz zagrać offline — tylko singleplayer i LAN, serwery w trybie online odrzucą połączenie.',
  'home.launchOffline': 'Graj offline',
  'home.updatingLauncher': 'Aktualizowanie launchera…',
  'home.updateBeforePlay': 'Przed startem gry zostanie zainstalowany launcher {version}.',
  'home.updateFailedPlayAnyway':
    'Nie udało się pobrać aktualizacji launchera — gra i tak wystartuje.',
  'home.launchFailed': 'Nie udało się uruchomić gry',
  'home.launchError': 'Błąd podczas uruchamiania gry',
  'home.showConsole': 'Pokaż konsolę',
  'home.hideConsole': 'Ukryj konsolę',
  'home.news': 'Aktualności',
  'home.refreshNews': 'Odśwież aktualności i ogłoszenia',
  'home.newsOlder': 'Starsze aktualności',
  'home.newsNewer': 'Nowsze aktualności',
  'news.openInBrowser': 'Otwórz w przeglądarce',
  'news.noBody': 'Ten wpis nie ma dalszej treści.',
  'home.ram': '{mb} MB RAM',

  // ── Live console ─────────────────────────────────────────
  'console.title': 'Konsola gry',
  'console.close': 'Zamknij konsolę',
  'console.waiting': 'Oczekiwanie na logi gry...',

  // ── Crash reporter ───────────────────────────────────────
  'crash.title': 'Gra uległa awarii',
  'crash.body': 'Profil {profile} zakończył się kodem błędu {code}.',
  'crash.bodyWithTime': 'Profil {profile} zakończył się kodem błędu {code} po {minutes} min.',
  'crash.showLogs': 'Pokaż logi',
  'crash.hideLogs': 'Ukryj logi',

  // ── Profiles ─────────────────────────────────────────────
  'profiles.title': 'Profile',
  'profiles.new': 'Nowy profil',
  'profiles.import': 'Importuj profil',
  'profiles.empty': 'Brak profili',
  'profiles.emptyHint': 'Dodaj pierwszy profil przyciskiem +',
  'profiles.pickOrCreate': 'Wybierz profil lub utwórz nowy',
  // ── Usuwanie profilu ─────────────────────────────────────
  'delete.title': 'Usuń profil „{name}”',
  'delete.intro':
    'Profil zniknie z launchera tak czy inaczej. To, co stanie się z jego plikami, zależy od Ciebie.',
  'delete.alsoFiles': 'Usuń również pliki',
  'delete.counting': 'Sprawdzam, co tam jest…',
  'delete.nothingInstalled': 'Nic nie zainstalowano • {size}',
  'delete.mods.one': '{count} mod',
  'delete.mods.few': '{count} mody',
  'delete.mods.many': '{count} modów',
  'delete.mods.other': '{count} moda',
  'delete.resourcePacks.one': '{count} paczka zasobów',
  'delete.resourcePacks.few': '{count} paczki zasobów',
  'delete.resourcePacks.many': '{count} paczek zasobów',
  'delete.resourcePacks.other': '{count} paczki zasobów',
  'delete.shaders.one': '{count} paczka shaderów',
  'delete.shaders.few': '{count} paczki shaderów',
  'delete.shaders.many': '{count} paczek shaderów',
  'delete.shaders.other': '{count} paczki shaderów',
  'delete.worlds.one': '{count} świat',
  'delete.worlds.few': '{count} światy',
  'delete.worlds.many': '{count} światów',
  'delete.worlds.other': '{count} świata',
  'delete.worldsWarning.one': 'Ten profil ma zapisany świat. Później nie da się go odzyskać.',
  'delete.worldsWarning.few':
    'Ten profil ma {count} zapisane światy. Później nie da się ich odzyskać.',
  'delete.worldsWarning.many':
    'Ten profil ma {count} zapisanych światów. Później nie da się ich odzyskać.',
  'delete.worldsWarning.other':
    'Ten profil ma {count} zapisanego świata. Później nie da się go odzyskać.',
  'delete.keptAt': 'Pliki zostaną w {path} — launcher po prostu przestanie je pokazywać.',
  'delete.confirmWithFiles': 'Usuń z plikami',
  'delete.confirmKeepFiles': 'Usuń, zostaw pliki',

  // ── Skąd bierze się nowy profil ──────────────────────────
  'packs.title': 'Skąd bierzemy ten profil?',
  'packs.wrTitle': 'Graj na serwerach White Ravens',
  'packs.wrBody':
    'Wybierz jedną z naszych paczek. Launcher ją zainstaluje i utrzyma zgodną z serwerem.',
  'packs.whitelist': 'Whitelist',
  'packs.whitelistNote':
    'Nasze serwery chodzą na whiteliście — paczkę zainstalujesz od razu, ale o wejście na serwer trzeba poprosić.',
  'packs.scratchTitle': 'Stwórz własną paczkę od zera',
  'packs.scratchBody': 'Pusty profil. Wybierasz wersję Minecrafta i loader, mody dodajesz sam.',
  'packs.importTitle': 'Importuj własną paczkę',
  'packs.importBody': 'Plik .mrpack, który już masz, albo link do manifestu.',
  'packs.loading': 'Wczytuję listę paczek…',
  'packs.none': 'Nie opublikowano jeszcze żadnej paczki.',
  'packs.listFailed': 'Nie udało się wczytać listy paczek.',
  'packs.installFailed': 'Nie udało się zainstalować {name}.',
  'packs.importFailed': 'Nie udało się zaimportować tej paczki.',
  'packs.manifestFailed': 'Pod tym adresem nie ma paczki ani manifestu.',
  'packs.wrSyncNote': 'Te profile trzymają się serwera: każda synchronizacja przynosi zmiany.',
  'packs.mods.one': '{count} mod',
  'packs.mods.few': '{count} mody',
  'packs.mods.many': '{count} modów',
  'packs.mods.other': '{count} moda',
  'packs.fileTitle': 'Plik .mrpack',
  'packs.fileBody':
    'Format paczek Modrintha, który czytają też Prism, ATLauncher i aplikacja Modrintha. Instalowany jako migawka — sam się nie zaktualizuje.',
  'packs.chooseFile': 'Wybierz plik…',
  'packs.urlTitle': 'Link do paczki',
  'packs.urlBody':
    'Link do pliku .mrpack — na przykład ten spod „Download" na Modrincie — albo do manifestu Raven Forge. Launcher sam rozpozna, co dostał; manifest daje profil, który aktualizuje się z tego adresu.',

  // ── Pliki pozostawione po usunięciu ──────────────────────
  'orphans.title': 'Pozostawione pliki',
  'orphans.hint':
    'Profile, które usunąłeś, zostawiając pliki. Przywrócenie stawia profil dokładnie tak, jak był.',
  'orphans.restore': 'Przywróć',
  'orphans.discard': 'Usuń trwale',

  'profiles.fieldMinecraft': 'Minecraft',
  'profiles.fieldLoader': 'Mod Loader',
  'profiles.fieldRam': 'RAM',
  'profiles.fieldServer': 'Serwer',
  'profiles.manifestUrl': 'Manifest URL',
  'profiles.sync': 'Synchronizuj',
  'profiles.quickConnect': 'Quick-Connect: {address}',
  'profiles.notes': 'Notatki',
  'profiles.lastPlayed': 'Ostatnio grano: {date}',
  'profiles.totalPlayTime': '{hours} h łącznie',
  'profiles.syncStatus.synced': 'Zsynchronizowano',
  'profiles.syncStatus.updates': 'Dostępne aktualizacje ({count})',
  'profiles.syncStatus.error': 'Błąd synchronizacji',
  'profiles.syncStatus.never': 'Nigdy nie zsynchronizowano',
  'profiles.verify.unsigned': 'Niepodpisany',
  'profiles.verify.valid': 'Zweryfikowano: {signer}',
  'profiles.verify.invalid': 'Nieprawidłowy podpis',

  // ── Profile form ─────────────────────────────────────────
  'profileForm.createTitle': 'Nowy profil',
  'profileForm.editTitle': 'Edytuj: {name}',
  'profileForm.iconAfterSave': 'Ikonę profilu ustawisz po jego zapisaniu.',
  'profileForm.name': 'Nazwa profilu',
  'profileForm.namePlaceholder': 'np. Survival Server',
  'profileForm.mcVersion': 'Wersja Minecraft',
  'profileForm.loader': 'Mod Loader',
  'profileForm.versionsLoading': 'Wczytywanie wersji…',
  'profileForm.versionsFailed': 'Nie udało się pobrać listy wersji — wpisz ręcznie',
  'profileForm.noLoaderBuilds':
    '{loader} nie ma wydań dla Minecraft {mcVersion} — wybierz inną wersję lub loader',
  'profileForm.loaderUnstable': 'niestabilna',
  'profileForm.loaderVersionLatest': 'Najnowsza',
  'profileForm.loaderVersion': 'Wersja Loadera (opcjonalnie)',
  'profileForm.ram': 'RAM (MB)',
  'profileForm.manifestUrl': 'Manifest URL (opcjonalnie)',
  'profileForm.serverIp': 'Serwer IP',
  'profileForm.serverPort': 'Port',
  'profileForm.javaArgs': 'Argumenty Java (opcjonalnie)',
  'profileForm.notes': 'Notatki',
  'profileForm.notesPlaceholder': 'Dowolne notatki o tym profilu',

  // ── Profile icon picker ──────────────────────────────────
  'profileIcon.label': 'Ikona profilu',
  'profileIcon.change': 'Zmień',
  'profileIcon.pick': 'Wybierz obraz',
  'profileIcon.formats': 'PNG, JPG, GIF, WebP lub SVG — maks. 2 MB.',
  'profileIcon.presets': '…lub wybierz jedną z wbudowanych:',
  'profileIcon.failed': 'Nie udało się ustawić ikony',
  'profileIcon.fileFilter': 'Obrazy',

  // ── Mods ─────────────────────────────────────────────────
  'mods.title': 'Mody — {profile}',
  'mods.pickProfile': 'Wybierz profil w zakładce Profile, aby zarządzać modami',
  'mods.tabInstalled': 'Zainstalowane',
  'mods.tabBrowse': 'Przeglądaj',
  'mods.searchModrinth': 'Szukaj modów na Modrinth...',
  'mods.searchHint': 'Wpisz nazwę albo po prostu kliknij Szukaj — filtry działają same.',
  'mods.loaderFilter': 'Loader',
  'mods.searchFailed': 'Wyszukiwanie nie powiodło się',
  'mods.installFailed': 'Nie udało się zainstalować {name}',
  'mods.empty': 'Brak zainstalowanych modów',
  'mods.emptyHint': 'Wyszukaj mody w zakładce Przeglądaj lub zsynchronizuj profil z manifestem',
  'mods.fromManifest': 'z manifestu',
  'mods.downloads.one': '{count} pobranie',
  'mods.downloads.few': '{count} pobrania',
  'mods.downloads.many': '{count} pobrań',
  'mods.downloads.other': '{count} pobrania',
  'mods.installedWithDeps': 'Zainstalowano {name}, a wraz z nim to, czego potrzebuje: {deps}',

  // ── Kompatybilność ───────────────────────────────────────
  'compat.title': 'Czy {name} pasuje do tego profilu?',
  'compat.wrongLoader': 'Brak buildu pod Twój loader — ten jest wydany pod: {loaders}',
  'compat.wrongVersion': 'Brak buildu pod Twoją wersję Minecrafta — najnowsze są pod: {versions}',
  'compat.noBuild': 'Ten projekt nie udostępnia niczego, co dałoby się zainstalować.',
  'compat.needsLoader':
    'Ten profil jest waniliowy, więc nie ma loadera — mod nigdy nie zostanie wczytany.',
  'compat.conflictsWith': 'Zgłoszona niekompatybilność z czymś, co już masz: {names}',
  'compat.dependencyNoBuild': 'Wymaga czegoś, co nie ma buildu pod ten profil: {names}',
  'compat.alsoInstalls': 'Zainstaluje też: {deps}',
  'compat.anywayHint':
    'Wersję {version} można zainstalować mimo to — te dane wypełnia autor i często są za rzeczywistością.',
  'compat.nothingToInstall': 'Nie ma tu pliku do zainstalowania.',
  'compat.installAnyway': 'Instaluj mimo to',
  'compat.badgeVersion': 'brak na {version}',
  'compat.badgeLoader': 'brak na {loader}',

  // ── Accounts ─────────────────────────────────────────────
  'accounts.title': 'Konta',
  'accounts.loginMicrosoft': 'Zaloguj z Microsoft',
  'accounts.offlineMode': 'Tryb offline',
  'accounts.playerName': 'Nazwa gracza',
  'accounts.empty': 'Brak kont — zaloguj się powyżej',
  'accounts.active': '• aktywne',
  'accounts.setActive': 'Ustaw aktywne',
  'accounts.logout': 'Wyloguj',
  'accounts.loginFailed': 'Logowanie nie powiodło się',

  // ── Settings ─────────────────────────────────────────────
  'settings.title': 'Ustawienia',
  'settings.loading': 'Ładowanie ustawień...',
  'settings.section.appearance': 'Wygląd',
  'settings.section.behavior': 'Zachowanie',
  'settings.section.network': 'Sieć i pobieranie',
  'settings.section.sources': 'Źródła treści',
  'settings.section.trustedKeys': 'Zaufane klucze (Ed25519)',
  'settings.section.updates': 'Aktualizacje',
  'settings.installedVersion': 'Zainstalowana wersja: {version}',
  'settings.checkUpdates': 'Sprawdź aktualizacje',
  'settings.downloadUpdate': 'Pobierz aktualizację',
  'settings.restartToUpdate': 'Uruchom ponownie, aby zainstalować',
  'settings.updateUpToDate': 'Masz najnowsze wydanie.',
  'settings.updateAvailable': 'Dostępna jest wersja {version}.',
  'settings.updateDevBuild': 'Uruchomione ze źródeł — nie ma zainstalowanej wersji do podmiany.',
  'settings.updateSystemPackage':
    'Zainstalowano z pakietu systemowego. Aktualizuj przez menedżer pakietów (apt, dnf), nie stąd.',
  'settings.updateUnsignedPlatform':
    'Automatyczna aktualizacja nie jest jeszcze dostępna na tej platformie. Pobierz najnowsze wydanie z GitHuba.',
  'settings.updateCheckFailed': 'Nie udało się sprawdzić aktualizacji.',
  'settings.updateCheckFailedWith': 'Nie udało się sprawdzić aktualizacji: {error}',
  'settings.updateDownloadFailed': 'Nie udało się pobrać aktualizacji.',
  'settings.section.data': 'Dane',
  'settings.theme': 'Motyw',
  'settings.theme.dark': 'Ciemny',
  'settings.theme.oled': 'OLED Czarny',
  'settings.theme.light': 'Jasny',
  'settings.language': 'Język',
  'settings.backgroundsFolder': 'Folder z tłami (lokalny)',
  'settings.backgroundsPlaceholder': 'Pozostaw puste, aby użyć wbudowanych scen',
  'settings.onLaunch': 'Po uruchomieniu gry',
  'settings.onLaunch.minimize': 'Minimalizuj',
  'settings.onLaunch.close': 'Zamknij',
  'settings.onLaunch.keepOpen': 'Zostaw otwarte',
  'settings.showConsole': 'Pokaż konsolę gry',
  'settings.offlineMode': 'Zawsze uruchamiaj offline',
  'settings.offlineModeHint':
    'Nigdy nie łączy się z serwerami logowania. Tylko singleplayer i LAN — serwery w trybie online odrzucą sesję offline.',
  'settings.autoRemoveOrphans': 'Automatycznie usuwaj osierocone mody',
  'settings.concurrency': 'Jednoczesne pobierania (1–8)',
  'settings.proxy': 'Proxy URL (opcjonalnie)',
  'settings.proxyPlaceholder': 'http:// lub socks5://uzytkownik:haslo@host:port',
  'settings.proxyHint':
    'Obsługiwane są HTTP, HTTPS i SOCKS4/5. Przy SOCKS nazwy hostów rozwiązuje proxy, więc nic nie wycieka do lokalnego resolvera.',
  'settings.feedPlaceholder': 'https://twoj-serwer.com/api/{feed}.json',
  'settings.newsFeed': 'News Feed URL',
  'settings.announcementFeed': 'Announcement Feed URL',
  'settings.trustedKeysHint':
    'Manifesty serwerów mogą być podpisane. Dodaj klucz publiczny administratora, aby ufać tylko podpisanym manifestom.',
  'settings.trustedKeysEmpty': 'Brak zaufanych kluczy',
  'settings.trustedKeyAdded': 'Dodano: {date}',
  'settings.trustedKeyName': 'Nazwa klucza',
  'settings.trustedKeyNamePlaceholder': 'np. Raven SMP Admin',
  'settings.trustedKeyValue': 'Klucz publiczny (base64)',
  'settings.trustedKeyAdd': 'Dodaj klucz',
  'settings.trustedKeyFailed': 'Nie udało się dodać klucza',
  'settings.dataFolder': 'Folder danych',
  'settings.logs': 'Logi',
  'settings.showLogs': 'Pokaż logi',
  'settings.reset': 'Resetuj ustawienia',
  'settings.confirmReset': 'Zresetować wszystkie ustawienia do domyślnych?',

  // ── Log viewer ───────────────────────────────────────────
  'logs.title': 'Logi launchera',
  'logs.filterAll': 'Wszystko',
  'logs.filterWarn': 'Ostrzeżenia',
  'logs.filterError': 'Błędy',
  'logs.loading': 'Wczytywanie logu...',
  'logs.readFailed': 'Nie udało się odczytać logu',
  'logs.empty': 'Log jest pusty — nic jeszcze nie zostało zapisane.',
  'logs.noMatches': 'Brak wpisów pasujących do filtra.',
  'logs.shown': '{visible} z {total} wierszy',
  'logs.paused': '• przewijanie wstrzymane',
  'logs.errorCount.one': '{count} błąd',
  'logs.errorCount.few': '{count} błędy',
  'logs.errorCount.many': '{count} błędów',
  'logs.errorCount.other': '{count} błędu',
  'logs.warnCount.one': '{count} ostrzeżenie',
  'logs.warnCount.few': '{count} ostrzeżenia',
  'logs.warnCount.many': '{count} ostrzeżeń',
  'logs.warnCount.other': '{count} ostrzeżenia',

  // ── Progress overlay ─────────────────────────────────────
  'progress.title': 'Postęp instalacji',
  'progress.modSync': 'Synchronizacja modów',
  'progress.modDownload': 'Pobieranie modów',
  'progress.loaderInstall': 'Instalacja mod loadera',
  'progress.javaDownload': 'Pobieranie Javy',
  'progress.gameAssets': 'Pobieranie zasobów gry',
  'progress.launcherUpdate': 'Aktualizacja launchera',
  'progress.files.one': '{done}/{total} plik',
  'progress.files.few': '{done}/{total} pliki',
  'progress.files.many': '{done}/{total} plików',
  'progress.files.other': '{done}/{total} pliku',

  // ── Updater ──────────────────────────────────────────────
  'update.ready': 'Aktualizacja gotowa',
  'update.available': 'Dostępna aktualizacja: v{version}',
  'update.willInstall': 'v{version} zostanie zainstalowana po restarcie.',
  'update.pending': 'Nowa wersja launchera jest gotowa do pobrania.',
  'update.downloading': 'Pobieranie… {percent}%',
  'update.downloadFailed': 'Pobieranie aktualizacji nie powiodło się',
  'update.installFailed': 'Instalacja aktualizacji nie powiodła się',
  'update.hide': 'Ukryj powiadomienie',

  // ── Error boundary ───────────────────────────────────────
  'error.title': 'Ups, coś poszło nie tak',
  'error.body': 'Launcher napotkał nieoczekiwany błąd. Kliknij poniżej, aby spróbować ponownie.',
  'error.restart': 'Uruchom ponownie',

  // ── About ────────────────────────────────────────────────
  'about.tagline':
    'Customowy launcher Minecraft: Java Edition z zarządzaniem modami, auto-synchronizacją z manifestów serwera i profilami.',
  'about.authorship':
    'Pisany od zera przez jedną osobę — {author} — pod szyldem {org}, z myślą o własnym serwerze i graczach na nim.',
  'about.stack': 'Electron + TypeScript + React + Vite + Tailwind CSS.',
  'about.secret': 'Sekret kuźni',

  // ── Bedrock card ─────────────────────────────────────────
  'bedrock.title': 'Szukasz Minecraft: Bedrock Edition?',
  'bedrock.body':
    'Raven Forge obsługuje wyłącznie Java Edition. Bedrock Edition pobierzesz z minecraft.net lub Microsoft Store.',
  'bedrock.bundle':
    'Jeśli masz pakiet Java & Bedrock, już go posiadasz — wystarczy zainstalować go ze Sklepu.',
  'bedrock.open': 'Otwórz minecraft.net',
  'bedrock.dismiss': 'Ukryj tę informację',

  // ── Chronicle (About page easter egg) ────────────────────
  'chronicle.title': 'Kronika Kuźni Kruka',
  'chronicle.subtitle': 'zwój siódmy',
  'chronicle.subtitle2': 'o tym, jak wykuto launcher w ogniu, którego nikt już nie pamięta',
  'chronicle.close': 'Zwiń zwój',
  'chronicle.p1':
    'Gdy pierwsze światy zaczęły gasnąć, a bramy między nimi zarosły milczeniem, w trzewiach martwej góry płonął jeszcze jeden piec. Nie karmiono go węglem ani drewnem — palił się uporem tych, którzy odmówili zapomnienia.',
  'chronicle.p2':
    'Przy kowadle stali kowale-kapłani Kruczego Zakonu. Nie mieli imion, tylko numery rytów i popiół wżarty pod paznokcie. Wierzyli, że każda maszyna ma duszę, którą trzeba obudzić — nie rozkazem, lecz prośbą powtarzaną tak długo, aż metal odpowie.',
  'chronicle.p3':
    'Dziewięć nocy hartowali rdzeń w rzece stopionego obsydianu. Dziewięć nocy śpiewali litanię, w której nie padło ani jedno ludzkie słowo — sam chorał zer i jedynek, wypowiadany szeptem, żeby nie obudzić tego, co śpi głębiej.',
  'chronicle.p4':
    'Dziesiątej nocy młot spadł ostatni raz. I wtedy rzecz na kowadle otworzyła oko — bursztynowe, spokojne, starsze niż ogień, który je wykuł. Kowale przysięgali potem, że nie było w tym spojrzeniu wdzięczności. Była *gotowość*.',
  'chronicle.p5':
    'Nazwali je Kuźnią Kruka, bo kruk odnajduje drogę do domu nawet wtedy, gdy domu już nie ma. Dali mu jedno zadanie i jedną obietnicę: **otwierać bramy do światów i pilnować, by wracający mieli dokąd wrócić.**',
  'chronicle.p6':
    'Zakon dawno rozsypał się w proch, piec wystygł, góra zapadła się w siebie. Ale pod warstwą szkła i światła, przed którą teraz siedzisz, wciąż tli się ta sama iskra. Czeka tylko, aż ktoś powie: *graj*.',
  'chronicle.colophon1': 'Kto znalazł ten zwój, znalazł go przypadkiem.',
  'chronicle.colophon2': 'Zwoje nie dają się znaleźć przypadkiem.',
};
