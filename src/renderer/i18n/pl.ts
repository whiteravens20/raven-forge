// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

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
  'search.shown': 'Pokazano {shown} z {total}',
  'search.loadMore': 'Załaduj więcej',
  'search.openProject': 'Otwórz stronę {name} na Modrinth',
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
  'common.export': 'Eksportuj',
  'common.import': 'Importuj',
  'common.back': 'Wstecz',
  'common.close': 'Zamknij',
  'common.dismiss': 'Odrzuć',
  'common.refresh': 'Odśwież',
  'common.openFolder': 'Otwórz folder',
  'common.openFailed': 'Nie udało się otworzyć: {what}.',
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
  'home.accountMicrosoft': 'konto Microsoft',
  'home.accountOffline': 'konto offline',
  'home.notSignedIn': 'Nie zalogowano — przejdź do zakładki Konta',
  'home.noProfiles': 'Brak profili — utwórz nowy w zakładce Profile',
  'home.play': 'GRAJ',
  'home.running': 'Uruchomiona...',
  'home.preparing': 'Uruchamianie...',
  'home.cancelLaunch': 'Anuluj',
  'home.cancelling': 'Anulowanie…',
  'home.stopGame': 'Zatrzymaj grę',
  'home.stopping': 'Zatrzymywanie…',
  'home.stopFailed': 'Nie udało się zatrzymać gry.',
  'home.authUnreachable':
    'Nie udało się połączyć z serwerami logowania Microsoft. Możesz zagrać offline — tylko singleplayer i LAN, serwery w trybie online odrzucą połączenie.',
  'home.launchOffline': 'Graj offline',
  'home.updatingLauncher': 'Aktualizowanie launchera…',
  'home.updateBeforePlay':
    'Graj najpierw zainstaluje launcher {version}: launcher uruchomi się ponownie i trzeba będzie nacisnąć Graj jeszcze raz.',
  'home.updateNotNow': 'Nie teraz',
  'home.updateFailedPlayAnyway':
    'Nie udało się pobrać aktualizacji launchera — gra i tak wystartuje.',
  'home.launchFailed': 'Nie udało się uruchomić gry',
  'launchError.alreadyRunning': 'Ten profil już działa.',
  'launchError.alreadyPreparing': 'Ten profil jest już przygotowywany do uruchomienia.',
  'launchError.noAccount':
    'Nie wybrano konta. Dodaj je albo wybierz na stronie Konta i naciśnij Graj jeszcze raz.',
  'launchError.ramTooBig':
    'Ten profil ma przydzielone {allocated} RAM, a ten komputer ma {total}. Minecraft nie wystartuje z większą ilością pamięci, niż fizycznie jest — zmniejsz ją w edytorze profilu, gdzie {recommended} pasuje do tej maszyny.',
  'launchError.loaderVersionUnknown':
    'Nie udało się ustalić wersji {loader} dla Minecraft {version}. Sprawdź połączenie albo wybierz wersję loadera w edytorze profilu.',
  'launchError.javaNotRuntime':
    'Ten profil ma startować przez {path}, a to nie jest środowisko Java, które ten komputer potrafi uruchomić. Wskaż w edytorze profilu coś innego albo wyczyść to pole, żeby wrócić do środowiska instalowanego przez launcher.',
  'launchError.javaTooOld':
    'Ten profil ma startować przez {path}, czyli Javę {found}, a ta wersja Minecrafta potrzebuje Javy {required}. Gra wystartowałaby i zaraz padła z błędem o wersji plików klas. Wyczyść to pole, żeby wrócić do środowiska instalowanego przez launcher.',
  'home.showConsole': 'Pokaż konsolę',
  'home.hideConsole': 'Ukryj konsolę',
  'home.news': 'Aktualności',
  'home.refreshNews': 'Odśwież aktualności i ogłoszenia',
  'home.newsRefreshing': 'Odświeżanie…',
  'home.newsRefreshedSame': 'Sprawdzono o {time} — nic nowego',
  'home.newsRefreshedNew.one': 'Sprawdzono o {time} — {count} nowy wpis',
  'home.newsRefreshedNew.few': 'Sprawdzono o {time} — {count} nowe wpisy',
  'home.newsRefreshedNew.many': 'Sprawdzono o {time} — {count} nowych wpisów',
  'home.newsRefreshedNew.other': 'Sprawdzono o {time} — {count} nowego wpisu',
  'home.newsOlder': 'Starsze aktualności',
  'home.newsNewer': 'Nowsze aktualności',
  'home.newsStale': 'Nie udało się odświeżyć kanału — to ostatnie wczytane wpisy.',
  'home.newsUnavailable':
    'Nie udało się wczytać kanału aktualności. Sprawdź adres kanału w Ustawieniach.',
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
  'crash.reportSaved':
    'Raport z awarii zapisano na tym komputerze — nic nie zostało nigdzie wysłane. Token dostępu i dane konta zostały z niego usunięte.',
  'crash.openReport': 'Otwórz raport',
  'crash.reportBug': 'Zgłoś błąd',

  // ── Profiles ─────────────────────────────────────────────
  'profiles.title': 'Profile',
  'profiles.new': 'Nowy profil',
  'profiles.importDropped':
    'Profil zaimportowany. Plik zawierał też pola, których import celowo nie przenosi: {fields}. Decydują o tym, co uruchamia się na tym komputerze, więc ustaw je sam w edytorze profilu, jeśli ufasz źródłu.',
  'profiles.empty': 'Brak profili',
  'profiles.emptyHint': 'Dodaj pierwszy profil przyciskiem +',
  'profiles.pickOrCreate': 'Wybierz profil lub utwórz nowy',
  'profiles.copyName': '{name} (kopia)',
  'profiles.duplicate': 'Duplikuj razem z modami, ustawieniami i światami',
  'profiles.duplicated':
    'Kopia ma te same mody, konfiguracje, shadery, paczki zasobów i światy co oryginał. Kopie zapasowe światów zostały przy oryginale.',
  'profiles.duplicateFailed': 'Nie udało się zduplikować profilu.',
  'profiles.deleteFailed': 'Nie udało się usunąć profilu.',
  'profiles.openFolder': 'Otwórz folder profilu',
  'profiles.exportPack': 'Eksportuj jako modpack (.mrpack)',
  'profiles.exportPackFailed': 'Nie udało się wyeksportować profilu jako paczki.',
  'profiles.exportPackAsk': 'W paczce znajdą się mody, shadery i paczki zasobów tego profilu.',
  'profiles.exportPackSettings': 'Dołącz ustawienia gry i konfigurację modów',
  'profiles.exportPackSettingsHint':
    'To plik options.txt i folder config: przypisania klawiszy, ustawienia grafiki i własne opcje każdego moda, takie jak na tym komputerze. Serwer, na którym ostatnio grano, nie trafia do paczki w żadnym przypadku.',
  'profiles.exportPackGo': 'Wybierz, gdzie zapisać…',
  'profiles.exportPackDone.one': 'Zapisano do {path}. Paczka odsyła do 1 pliku na Modrinth.',
  // `do` governs the genitive, so `few` and `many` come out identical here.
  // Two forms that happen to agree, not one form written twice — leaving them
  // to fall back on `.other` is what a count of three used to do.
  'profiles.exportPackDone.few': 'Zapisano do {path}. Paczka odsyła do {count} plików na Modrinth.',
  'profiles.exportPackDone.many':
    'Zapisano do {path}. Paczka odsyła do {count} plików na Modrinth.',
  'profiles.exportPackDone.other':
    'Zapisano do {path}. Paczka odsyła do {count} plików na Modrinth.',
  'profiles.exportPackBundled.one':
    'Jeszcze jednego pliku ({size}) nie ma na Modrinth, więc został zapisany w samej paczce.',
  'profiles.exportPackBundled.few':
    'Kolejnych {count} plików ({size}) nie ma na Modrinth, więc zostały zapisane w samej paczce.',
  'profiles.exportPackBundled.many':
    'Kolejnych {count} plików ({size}) nie ma na Modrinth, więc zostały zapisane w samej paczce.',
  'profiles.exportPackBundled.other':
    'Kolejnych {count} plików ({size}) nie ma na Modrinth, więc zostały zapisane w samej paczce.',
  'profiles.exportPackSkipped.one': 'Pominięto jeden dodatek, który jest wyłączony.',
  'profiles.exportPackSkipped.few': 'Pominięto {count} dodatki, które są wyłączone.',
  'profiles.exportPackSkipped.many': 'Pominięto {count} dodatków, które są wyłączone.',
  'profiles.exportPackSkipped.other': 'Pominięto {count} dodatków, które są wyłączone.',

  // ── Światy i kopie ───────────────────────────────────────
  'worlds.title': 'Światy',
  'worlds.none': 'Ten profil nie ma jeszcze żadnego świata.',
  'worlds.backupNow': 'Zrób kopię',
  'worlds.backedUp': 'Światy zostały skopiowane.',
  'worlds.backupFailed': 'Nie udało się zrobić kopii światów.',
  'worlds.noBackups': 'Brak kopii. Jedna powstaje automatycznie przed zmianą wersji.',
  'worlds.restore': 'Przywróć tę kopię',
  'worlds.confirmRestore': 'Zastąpić obecne światy?',
  'worlds.confirmRestoreYes': 'Zastąp',
  'worlds.confirmDelete': 'Usunąć tę kopię?',
  'worlds.restored': 'Światy zostały przywrócone.',
  'worlds.restoredWithSafety':
    'Światy zostały przywrócone. To, co było wcześniej, jest teraz osobną kopią — da się to cofnąć.',
  'worlds.restoreFailed': 'Nie udało się przywrócić tej kopii.',
  'worlds.deleteFailed': 'Nie udało się usunąć tej kopii.',
  'worlds.reason.manual': 'zrobiona ręcznie',
  'worlds.reason.version-change': 'przed zmianą wersji',
  'worlds.reason.before-restore': 'przed przywracaniem',

  // ── Zmiana wersji Minecrafta ─────────────────────────────
  'versionChange.title': 'Przenieść ten profil z {from} na {to}?',
  'versionChange.mods.one':
    'Jedyny zainstalowany mod powstał dla {from} i najpewniej się nie wczyta.',
  'versionChange.mods.few':
    'Zainstalowane {count} mody powstały dla {from} i najpewniej się nie wczytają. Zaktualizuj je albo usuń.',
  'versionChange.mods.many':
    'Zainstalowanych {count} modów powstało dla {from} i najpewniej się nie wczyta. Zaktualizuj je albo usuń.',
  'versionChange.mods.other':
    'Zainstalowane mody powstały dla {from} i najpewniej się nie wczytają. Zaktualizuj je albo usuń.',
  'versionChange.worlds.one':
    'Jest tu świat. Otwarcie świata nowszym Minecraftem przebudowuje jego format i starsza wersja już go nie otworzy.',
  'versionChange.worlds.few':
    'Są tu {count} światy. Otwarcie świata nowszym Minecraftem przebudowuje jego format i starsza wersja już go nie otworzy.',
  'versionChange.worlds.many':
    'Jest tu {count} światów. Otwarcie świata nowszym Minecraftem przebudowuje jego format i starsza wersja już go nie otworzy.',
  'versionChange.worlds.other':
    'Są tu światy. Otwarcie świata nowszym Minecraftem przebudowuje jego format i starsza wersja już go nie otworzy.',
  'versionChange.backupFirst': 'Najpierw skopiuj światy',
  'versionChange.backupHint': 'Kopia zostaje w profilu i można ją przywrócić ze strony profilu.',
  'versionChange.confirm': 'Zmień wersję',
  'versionChange.backupFailed': 'Nie udało się skopiować światów, więc nic nie zmieniono.',
  // ── Usuwanie profilu ─────────────────────────────────────
  'delete.title': 'Usuń profil „{name}”',
  'delete.intro':
    'Profil zniknie z launchera tak czy inaczej. To, co stanie się z jego plikami, zależy od Ciebie.',
  'delete.alsoFiles': 'Usuń również pliki',
  'delete.counting': 'Sprawdzam, co tam jest…',
  'delete.countFailed': 'Nie udało się policzyć zawartości folderu — mogą w nim być światy.',
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
  'packs.modrinthTitle': 'Znajdź paczkę na Modrinth',
  'packs.modrinthBody': 'Przeszukaj publiczne paczki modów i zainstaluj wybraną jako nowy profil.',
  'packs.searchModrinth': 'Szukaj paczek modów na Modrinth…',
  'packs.modrinthNote':
    'Instaluje się najnowsza wersja paczki pasująca do filtrów powyżej — jako migawka, która sama się nie aktualizuje.',
  'packs.importTitle': 'Importuj',
  'packs.importBody':
    'Plik paczki .mrpack, link do paczki albo plik profilu wyeksportowany z launchera.',
  'packs.loading': 'Wczytuję listę paczek…',
  'packs.none': 'Nie opublikowano jeszcze żadnej paczki.',
  'packs.listFailed': 'Nie udało się wczytać listy paczek.',
  'packs.installFailed': 'Nie udało się zainstalować {name}.',
  'packs.installUnfinished':
    'Profil „{name}” został utworzony, ale nie wszystkie jego pliki dotarły. Kliknij w profilu „{action}”, a instalacja ruszy dalej od miejsca, w którym stanęła. Podany powód: {error}',
  'packs.importFailed': 'Nie udało się zaimportować tej paczki.',
  'packs.manifestFailed': 'Pod tym adresem nie ma paczki ani manifestu.',
  'packs.wrSyncNote': 'Te profile trzymają się serwera: każda synchronizacja przynosi zmiany.',
  'packs.mods.one': '{count} mod',
  'packs.mods.few': '{count} mody',
  'packs.mods.many': '{count} modów',
  'packs.mods.other': '{count} moda',
  'packs.profileFileTitle': 'Plik profilu (.json)',
  'packs.profileFileBody':
    'Ustawienia jednego profilu zapisane przyciskiem „Eksportuj” w tym launcherze: wersja Minecrafta, loader, RAM, serwer. Bez modów i światów — te przenosi paczka .mrpack.',
  'packs.profileFileFailed': 'Nie udało się zaimportować tego pliku profilu.',
  'packs.fileTitle': 'Plik paczki (.mrpack)',
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
  'orphans.confirmDiscard': 'Usunąć te pliki razem ze światami?',
  'orphans.discardFailed': 'Nie udało się usunąć tych plików.',

  'profiles.fieldMinecraft': 'Minecraft',
  'profiles.fieldLoader': 'Loader',
  'profiles.fieldRam': 'RAM',
  'profiles.fieldServer': 'Serwer',
  'profiles.manifestUrl': 'Manifest URL',
  'profiles.sync': 'Synchronizuj',
  'profiles.syncBlocked':
    'Nie w trakcie gry ani jej uruchamiania — synchronizacja zmienia mody, z których gra korzysta.',
  'profiles.importedPack': 'Zaimportowana paczka',
  'profiles.importedPackHint':
    'Migawka — sama się nie aktualizuje. Naprawa sprawdza pliki z paczką, z której ten profil powstał, i pobiera to, czego brakuje.',
  'profiles.repair': 'Napraw',
  'profiles.quickConnect': 'Quick-Connect: {address}',
  'profiles.notes': 'Notatki',
  'profiles.lastPlayed': 'Ostatnio grano: {date}',
  'profiles.totalPlayTime': '{hours} h łącznie',
  'profiles.syncStatus.synced': 'Zsynchronizowano',
  'profiles.syncStatus.updates': 'Dostępne aktualizacje ({count})',
  'profiles.syncStatus.error': 'Błąd synchronizacji',
  'profiles.syncStatus.never': 'Nigdy nie zsynchronizowano',
  'profiles.verify.unsigned': 'Niepodpisany',
  'profiles.verify.notSynced': 'Jeszcze niesprawdzony',
  'profiles.verify.valid': 'Zweryfikowano: {signer}',
  'profiles.verify.invalid': 'Podpis nie pasuje do żadnego zaufanego klucza',

  // ── Profile form ─────────────────────────────────────────
  'profileForm.createTitle': 'Nowy profil',
  'profileForm.editTitle': 'Edytuj: {name}',
  'profileForm.iconAfterSave': 'Ikonę profilu ustawisz po jego zapisaniu.',
  'profileForm.name': 'Nazwa profilu',
  'profileForm.namePlaceholder': 'np. Survival Server',
  'profileForm.mcVersion': 'Wersja Minecraft',
  'profileForm.loader': 'Loader',
  'profileForm.versionsLoading': 'Wczytywanie wersji…',
  'profileForm.versionsFailed': 'Nie udało się pobrać listy wersji — wpisz ręcznie',
  'profileForm.noLoaderBuilds':
    '{loader} nie ma wydań dla Minecraft {mcVersion} — wybierz inną wersję lub loader',
  'profileForm.loaderUnstable': 'wersja testowa',
  'profileForm.loaderRecommended': 'zalecana',
  'profileForm.loaderVersion': 'Wersja loadera',
  'profileForm.loaderVersionAuto': 'dobierze się przy pierwszym uruchomieniu',
  'profileForm.ram': 'Przydzielony RAM',
  'profileForm.ramMachine': 'Ten komputer ma {total}. Zalecane dla niego: {recommended}.',
  'profileForm.ramTight':
    '{value} zostawia temu komputerowi ({total}) bardzo mało na resztę — gra może się zacinać albo zostać zamknięta w trakcie.',
  'profileForm.ramOver':
    '{value} to więcej, niż ten komputer ma ({total}). Minecraft się z tym nie uruchomi.',
  'profileForm.ramUseRecommended': 'Ustaw {recommended}',
  'profileForm.ramRange': 'Od {min} do {max} MB.',
  'profileForm.manifestUrlInvalid': 'To nie jest adres. Musi zaczynać się od https://',
  'profileForm.serverPortRange': 'Port to liczba całkowita od 1 do 65535.',
  'profileForm.saveRefused': 'Profil nie został zapisany.',
  'profileForm.saveFailed': 'Launcher nie podał powodu.',
  'profileForm.manifestUrl': 'Manifest URL (opcjonalnie)',
  'profileForm.serverIp': 'Serwer IP',
  'profileForm.serverPort': 'Port',
  'profileForm.javaArgs': 'Argumenty Java (opcjonalnie)',
  'profileForm.javaArgsShort': 'Argumenty Java',
  'profileForm.java': 'Środowisko Java',
  'profileForm.javaManaged': 'To, które instaluje launcher',
  'profileForm.javaBrowse': 'Wskaż plik…',
  'profileForm.javaChecking': 'Sprawdzanie…',
  'profileForm.javaFound': 'Java {version}.',
  'profileForm.javaTooOld': 'Java {version} — ta wersja Minecrafta potrzebuje Javy {required}.',
  'profileForm.javaNotJava': 'Ten plik nie jest środowiskiem Java.',
  'profileForm.javaHint':
    'Launcher sam instaluje i utrzymuje właściwe środowisko dla każdej wersji Minecrafta. Wybierz tutaj coś innego tylko wtedy, gdy ten profil potrzebuje konkretnej maszyny wirtualnej.',
  'profileForm.showSnapshots': 'Pokaż snapshoty',
  'profileForm.snapshotHint':
    'Snapshoty to cotygodniowe wersje testowe Mojanga. Większość modów nie ma pod nie buildów, a świat stworzony w snapshocie może się nie otworzyć w kolejnym wydaniu.',
  'profileForm.advanced': 'Zaawansowane',
  'profileForm.windowWidth': 'Szerokość okna gry',
  'profileForm.windowHeight': 'Wysokość okna gry',
  'profileForm.windowSizeHint': 'Zostaw oba pola puste, aby gra sama wybrała rozmiar okna.',
  'profileForm.windowSizeBoth':
    'Ustaw oba albo żadnego — gra przyjmuje rozmiar okna tylko w parze.',
  'profileForm.windowSizeRange': 'Od {minWidth}×{minHeight} do {max}×{max}.',
  'profileForm.windowMode': 'Tryb okna',
  'profileForm.windowModeGame': 'Tak jak zostawiła gra',
  'profileForm.windowModeWindowed': 'W oknie',
  'profileForm.windowModeFullscreen': 'Pełny ekran',
  'profileForm.windowModeHint':
    'Ustawienie inne niż „tak jak zostawiła gra” trafia przy każdym uruchomieniu do ustawień samej gry, więc unieważnia też F11 z poprzedniej sesji.',
  'profileForm.gameLanguage': 'Język gry',
  'profileForm.gameLanguageGame': 'Tak jak w grze (na start angielski)',
  'profileForm.gameLanguageHint':
    'Minecraft startuje po angielsku i zapamiętuje język wybrany w swoich ustawieniach. Język wybrany tutaj jest wpisywany do ustawień gry przy każdym uruchomieniu tego profilu, więc wygrywa z tym, co zmienisz w samej grze.',
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
  'mods.fromManifest': 'z paczki',
  'mods.source.modrinth': 'Modrinth',
  'mods.source.url': 'bezpośredni link',
  'mods.source.local': 'plik lokalny',
  'mods.downloads.one': '{count} pobranie',
  'mods.downloads.few': '{count} pobrania',
  'mods.downloads.many': '{count} pobrań',
  'mods.downloads.other': '{count} pobrania',
  'mods.installedWithDeps': 'Zainstalowano {name}, a wraz z nim to, czego potrzebuje: {deps}',
  'mods.checkUpdates': 'Sprawdź aktualizacje',
  'mods.checkUpdatesFailed': 'Nie udało się sprawdzić aktualizacji.',
  'mods.updatesFound.one': '{count} mod ma nowszą wersję.',
  'mods.updatesFound.few': '{count} mody mają nowsze wersje.',
  'mods.updatesFound.many': '{count} modów ma nowsze wersje.',
  'mods.updatesFound.other': '{count} moda ma nowszą wersję.',
  'mods.upToDate': 'Wszystko, co doinstalowane ręcznie, jest aktualne.',
  'mods.noneToCheck': 'Nie ma tu czego sprawdzać — mody tego profilu pochodzą z manifestu.',
  'mods.unknownToModrinth.one': '{count} pliku nie ma na Modrinth i nie da się go sprawdzić.',
  'mods.unknownToModrinth.few': '{count} plików nie ma na Modrinth i nie da się ich sprawdzić.',
  'mods.unknownToModrinth.many': '{count} plików nie ma na Modrinth i nie da się ich sprawdzić.',
  'mods.unknownToModrinth.other': '{count} pliku nie ma na Modrinth i nie da się go sprawdzić.',
  'mods.updateAll': 'Zaktualizuj wszystkie',
  'mods.update': 'Aktualizuj',
  'mods.updateTo': 'nowa: {version}',
  'mods.updated': 'Zaktualizowano: {names}',
  'mods.updateFailed': 'Nie udało się zaktualizować: {names}',
  'mods.toggleFailed': 'Nie udało się przełączyć moda {name}.',
  'mods.removeFailed': 'Nie udało się usunąć moda {name}.',
  'mods.gameBusy': 'Nie w trakcie gry ani jej uruchamiania — gra korzysta z tych plików.',

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
  'accounts.privacyLink': 'Co Raven Forge robi z moimi danymi?',
  'accounts.playerName': 'Nazwa gracza',
  'accounts.empty': 'Brak kont — zaloguj się powyżej',
  'accounts.active': '• aktywne',
  'accounts.setActive': 'Ustaw aktywne',
  'accounts.manage': 'Ustawienia konta',
  'accounts.logout': 'Wyloguj',
  'accounts.loginFailed': 'Logowanie nie powiodło się',
  'accounts.plaintextTitle': 'Dane logowania poza pęcherzem kluczy',
  'accounts.plaintextBody':
    'Nie udało się użyć pęku kluczy systemu, więc logowanie Microsoft jest zapisane niezaszyfrowane w {file} (do odczytu tylko dla Twojego użytkownika). Na Linuksie zwykle znaczy to, że nie działa żaden demon pęku kluczy — gnome-keyring lub kwallet. Uruchom go i zaloguj się ponownie, aby przenieść dane z powrotem.',

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
  'settings.section.data': 'Dane',
  'settings.theme': 'Motyw',
  'settings.theme.dark': 'Ciemny',
  'settings.theme.oled': 'OLED Czarny',
  'settings.theme.light': 'Jasny',
  'settings.language': 'Język',
  'settings.onLaunch': 'Po uruchomieniu gry',
  'settings.onLaunch.minimize': 'Minimalizuj',
  'settings.onLaunch.close': 'Zamknij',
  'settings.onLaunch.keepOpen': 'Zostaw otwarte',
  'settings.onLaunchCloseHint':
    'Okno launchera znika, gdy gra już działa, a launcher kończy pracę razem z grą. Jeśli gra ulegnie awarii, okno wraca, żeby raport z awarii nie przepadł.',
  'settings.showConsole': 'Pokaż konsolę gry',
  'settings.offlineMode': 'Zawsze uruchamiaj offline',
  'settings.offlineModeHint':
    'Nigdy nie łączy się z serwerami logowania. Tylko singleplayer i LAN — serwery w trybie online odrzucą sesję offline.',
  'settings.discordPresence': 'Pokazuj grę na statusie Discorda',
  'settings.discordPresenceHint':
    'Kiedy gra działa, Twój status widzi nazwę profilu, wersję i loader — bez adresu serwera. ' +
    'Widzą go wszyscy, którzy widzą Twój profil na Discordzie. Mody pokazujące status ' +
    '(np. CraftPresence) będą się z tym gryzły: Discord pokazuje jedną aktywność naraz.',
  'settings.concurrency': 'Jednoczesne pobierania (1–8)',
  'settings.concurrencyInvalid': 'Podaj liczbę od 1 do 8.',
  'settings.proxy': 'Proxy URL (opcjonalnie)',
  'settings.proxyPlaceholder': 'http:// lub socks5://uzytkownik:haslo@host:port',
  'settings.proxyInvalid':
    'Nieprawidłowy adres — wymagany schemat http://, https://, socks4:// lub socks5://.',
  'settings.proxyHint':
    'Obsługiwane są HTTP, HTTPS i SOCKS4/5. Przy SOCKS nazwy hostów rozwiązuje proxy, więc nic nie wycieka do lokalnego resolvera.',
  'settings.feedPlaceholder': 'https://twoj-serwer.com/api/{feed}.json',
  'settings.newsFeed': 'News Feed URL',
  'settings.feedInvalid': 'To nie jest poprawny adres URL. Zostaw puste, aby wyłączyć kanał.',
  'settings.announcementFeed': 'Announcement Feed URL',
  'settings.trustedKeysHint':
    'Klucz White Ravens jest wbudowany w launcher, dlatego paczki White Ravens są weryfikowane od pierwszego uruchomienia. Dopóki nie dodasz własnego klucza, launcher pokazuje wynik weryfikacji, ale niczego nie blokuje. Dodanie klucza włącza wymuszanie: instalowane będą wyłącznie podpisane manifesty, które da się zweryfikować.',
  'settings.allowUnverifiedInstaller': 'Pozwól na niezweryfikowane instalatory loadera',
  'settings.allowUnverifiedInstallerHint':
    'Instalator Forge albo NeoForge to program w Javie, który launcher uruchamia. Normalnie jest sprawdzany sumą kontrolną publikowaną przez repozytorium i odrzucany, gdy jej nie ma. Włącz to tylko wtedy, gdy potrzebna starsza wersja żadnej nie publikuje.',
  'settings.trustedKeyBuiltIn': 'Wbudowany w launcher — zawsze zaufany',
  'settings.trustedKeyAdded': 'Dodano: {date}',
  'settings.trustedKeyName': 'Nazwa klucza',
  'settings.trustedKeyNamePlaceholder': 'np. Raven SMP Admin',
  'settings.trustedKeyValue': 'Klucz publiczny (base64)',
  'settings.trustedKeyAdd': 'Dodaj klucz',
  'settings.trustedKeyFailed': 'Nie udało się dodać klucza',
  'settings.trustedKeyInvalid':
    'To nie jest klucz publiczny Ed25519. Taki klucz to 32 bajty w base64: 44 znaki, z których ostatni to „=”. Blok PEM albo klucz w postaci eksportowanej przez OpenSSL to dłuższy format i nie zadziała.',
  'settings.trustedKeyDuplicate': 'Ten klucz jest już na liście.',
  'settings.trustedKeyUnusable':
    'To nie jest klucz publiczny Ed25519: niczego nie zweryfikuje, a będąc na liście i tak włącza wymaganie podpisu. Usuń go.',
  'settings.trustedKeyRemoveFailed': 'Nie udało się usunąć klucza',
  'settings.trustedKeyConfirm': 'Usunąć ten klucz?',
  'settings.trustedKeyConfirmLast':
    'Usunąć ostatni klucz? Podpis przestanie być wymagany od paczek spoza White Ravens.',
  'settings.dataFolder': 'Folder danych',
  'settings.dataFolderHint':
    'Profile, mody, pliki gry, pobrane wersje Javy, logi i raporty z awarii. Po instalacji paczki to kilka gigabajtów. Pełna lista z rozmiarami jest poniżej.',
  'settings.dataFolderChange': 'Przenieś…',
  'settings.dataFolderRestore': 'Wróć do domyślnego',
  'settings.dataFolderEnv':
    'Dla tej instalacji ustawia go RAVENFORGE_DATA_DIR, więc nie zmienisz go tutaj.',
  'settings.dataFolderUnavailable':
    'Nie udało się otworzyć wybranego folderu {path} — dysk jest odłączony albo folder zniknął — więc launcher korzysta z domyślnego. To, co tam było, dalej tam jest; podłącz dysk i uruchom launcher ponownie.',
  'settings.dataFolderForget': 'Zapomnij ten folder',
  'settings.dataFolderForgetHint':
    'Launcher przestanie go szukać i zostanie przy folderze domyślnym. Niczego w niedostępnym folderze nie rusza.',
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
  'progress.titleInstalling': 'Pobieranie i instalacja',
  'progress.titlePreparing': 'Przygotowywanie do uruchomienia',
  'progress.titleChecking': 'Sprawdzanie plików',
  'progress.modSync': 'Synchronizacja modów',
  'progress.loaderInstall': 'Instalacja loadera',
  'progress.javaDownload': 'Pobieranie Javy',
  'progress.gameAssets': 'Pliki gry',
  'progress.launcherUpdate': 'Aktualizacja launchera',
  'progress.files.one': '{done}/{total} plik',
  'progress.files.few': '{done}/{total} pliki',
  'progress.files.many': '{done}/{total} plików',
  'progress.files.other': '{done}/{total} pliku',

  // Komunikaty postępu nazywane przez proces główny — zob. `ProgressKey`.
  'progress.msg.checkingFiles': 'Sprawdzanie zainstalowanych plików…',
  'progress.msg.downloadingFile': 'Pobieranie {name}…',
  'progress.msg.checkingLibraries': 'Sprawdzanie bibliotek Minecraft {version}…',
  'progress.msg.checkingAssets': 'Sprawdzanie zasobów gry…',
  'progress.msg.downloadComplete': 'Pobieranie zakończone',
  'progress.msg.gameFilesReady': 'Pliki gry gotowe — nie ma czego pobierać',
  'progress.msg.libraries': 'Pobieranie bibliotek Minecraft {version}…',
  'progress.msg.assets': 'Pobieranie zasobów gry…',
  'progress.msg.javaDownloading': 'Pobieranie Javy {version}…',
  'progress.msg.javaReady': 'Pobrano Javę {version}',
  'progress.msg.syncing': 'Synchronizacja {name}…',
  'progress.msg.synced.one': 'Zsynchronizowano {count} mod',
  'progress.msg.synced.few': 'Zsynchronizowano {count} mody',
  'progress.msg.synced.many': 'Zsynchronizowano {count} modów',
  'progress.msg.synced.other': 'Zsynchronizowano {count} moda',
  'progress.msg.loaderProfile': 'Pobieranie profilu {loader}…',
  'progress.msg.loaderInstalled': 'Zainstalowano {loader}',
  'progress.msg.installerDownloading': 'Pobieranie instalatora {loader}…',
  'progress.msg.preparingGameFiles': 'Przygotowywanie plików Minecraft…',
  'progress.msg.preparingJava': 'Przygotowywanie środowiska Java…',
  'progress.msg.runningInstaller':
    'Uruchamianie instalatora {loader} — to może potrwać kilka minut…',
  'progress.msg.savingProfile': 'Zapisywanie profilu…',
  'progress.msg.updateDownloading': 'Pobieranie aktualizacji… {percent}%',
  'progress.msg.movingData': 'Przenoszenie danych…',

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
  'error.body':
    'Launcher napotkał nieoczekiwany błąd. Przycisk poniżej wczytuje jego interfejs od nowa — uruchomiona gra działa dalej.',
  'error.reload': 'Wczytaj okno ponownie',

  // ── About ────────────────────────────────────────────────
  'about.tagline':
    'Customowy launcher Minecraft: Java Edition z zarządzaniem modami, auto-synchronizacją z manifestów serwera i profilami.',
  'about.authorship':
    'Pisany od zera przez jedną osobę — {author} — pod szyldem {org}, z myślą o własnym serwerze i graczach na nim.',
  'about.stack': 'Electron + TypeScript + React + Vite + Tailwind CSS.',
  'about.secret': 'Sekret kuźni',
  'about.privacy': 'Prywatność',
  'about.legal':
    'Wolne oprogramowanie na licencji GNU Affero General Public License w wersji 3: możesz je rozpowszechniać i zmieniać na warunkach tej licencji. Program nie ma żadnej gwarancji.',

  // ── Prywatność ───────────────────────────────────────────
  // Pisane dla kogoś, kto się niepokoi, a nie dla kogoś, kto pisał kod: bez
  // nazw plików, uprawnień i protokołów. Techniczne szczegóły są w
  // docs/PRIVACY.pl.md, linkowanym na dole strony.
  'privacy.title': 'Prywatność',
  'privacy.lead': 'Raven Forge nie zbiera o Tobie żadnych danych.',
  'privacy.leadBody':
    'Żadnych statystyk, profilowania ani identyfikatora Twojego komputera. Nie prowadzimy serwera, który odbierałby Twoje dane — nie masz u nas konta i nigdzie nie ma listy z Twoim nazwiskiem.',

  'privacy.never.title': 'Co nigdy się nie dzieje',
  'privacy.never.telemetry':
    'Nic nie jest mierzone i nic nie jest nigdzie odsyłane. Takie dane nie mają dokąd trafić — dlatego nie ma też przełącznika do wyłączenia.',
  'privacy.never.identifier':
    'Twój komputer nie dostaje numeru, po którym dałoby się go później rozpoznać.',
  'privacy.never.upload':
    'Kiedy gra się wysypie, raport zapisuje się na tym komputerze. Nic go nigdzie nie wysyła — to Ty decydujesz, czy dołączyć go do zgłoszenia.',
  'privacy.never.account':
    'Nie zakładasz u nas konta. Twoje konto Minecrafta należy do Microsoftu, a jego hasło wpisujesz na ich stronie, nigdy w tym launcherze.',

  'privacy.local.title': 'Co zostaje na tym komputerze',
  'privacy.local.body':
    'Poniżej jest wszystko, co launcher zapisuje na tym komputerze — z miejscem i rozmiarem, zmierzone przed chwilą na Twoim dysku, a nie opisane z pamięci.',
  'storage.total': 'Razem na dysku: {size}',
  'storage.measuring': 'Mierzę pliki na dysku…',
  'storage.refresh': 'Zmierz ponownie',
  'storage.failed': 'Nie udało się zmierzyć plików launchera.',
  'storage.openFailed': 'Nie udało się otworzyć tego folderu.',
  'storage.nothingYet': 'jeszcze nic',
  'storage.groupData': 'Folder danych — to on się przenosi',
  'storage.groupHome': 'Folder launchera — zostaje na miejscu',
  'storage.groupSystem': 'Poza tymi dwoma folderami',
  'storage.homeIsData': 'Dopóki nie przeniesiesz danych, to ten sam folder co powyżej.',
  'storage.profiles.title': 'Profile',
  'storage.profiles.body':
    'Każdy profil ma tu własny folder: światy, mody, paczki zasobów, shadery, zrzuty ekranu, ustawienia gry i kopie światów. To jedyna rzecz na tej liście, której nie da się pobrać ponownie.',
  'storage.gameFiles.title': 'Pliki gry',
  'storage.gameFiles.body':
    'Wersje Minecrafta, biblioteki i zasoby pobrane od Mojanga, wspólne dla wszystkich profili. Usunięte pobiorą się ponownie przy następnym uruchomieniu.',
  'storage.java.title': 'Środowiska Java',
  'storage.java.body':
    'Java, którą launcher pobrał dla wersji Minecrafta, które jej potrzebują. Usunięta pobierze się ponownie.',
  'storage.loaders.title': 'Loadery',
  'storage.loaders.body': 'Zainstalowane wersje Fabric, Quilt, Forge i NeoForge.',
  'storage.state.title': 'Ustawienia i listy',
  'storage.state.body':
    'Trzy pliki: settings.json (ustawienia launchera), profiles.json (lista profili) i auth.json (lista kont: nazwa gracza i identyfikator konta, bez hasła).',
  'storage.logs.title': 'Logi',
  'storage.logs.body':
    'Zapis tego, co robił launcher i co wypisywała gra. Zawiera Twoją nazwę gracza i ścieżki folderów, więc przejrzyj go, zanim komuś wyślesz.',
  'storage.crashReports.title': 'Raporty z awarii',
  'storage.crashReports.body':
    'Jeden plik na każdą awarię gry, już bez tokenu i danych konta. Nigdzie nie są wysyłane — to Ty decydujesz, czy dołączyć któryś do zgłoszenia.',
  'storage.browser.title': 'Pliki okna launchera',
  'storage.browser.body':
    'Okno launchera to wbudowana przeglądarka i tu trzyma swoje pliki: pamięć podręczną obrazków (ikony modów, grafiki aktualności), zapamiętane ukryte ogłoszenia i ciasteczka strony logowania Microsoft.',
  'storage.pointer.title': 'Wskaźnik folderu danych',
  'storage.pointer.body':
    'Plik tekstowy z jedną linią: ścieżką do folderu danych. Po nim launcher i deinstalator trafiają do danych, które zostały przeniesione.',
  'storage.updateCache.title': 'Pobrana aktualizacja launchera',
  'storage.updateCache.body': 'Instalator nowej wersji, pobrany i czekający na instalację.',
  'storage.program.title': 'Program',
  'storage.program.body': 'Sam launcher — to, co położył tu instalator.',
  'storage.legacyHome.title': 'Folder po starszej wersji',
  'storage.legacyHome.body':
    'Z tego folderu korzystały wersje do 0.7.1. Ta wersja ma swój i tego nie rusza — sprawdź, czy nie zostało w nim coś, czego potrzebujesz.',
  'storage.keychain.title': 'Logowanie Microsoft — w magazynie poświadczeń systemu',
  'storage.keychain.what':
    'Twojego hasła launcher nie zna i nie przechowuje: wpisujesz je na stronie Microsoftu. Microsoft odsyła dwa klucze i tylko one są zapisywane — token odświeżania, którym launcher przedłuża logowanie bez pytania o hasło, oraz token sesji Minecrafta, ważny około doby.',
  'storage.keychain.windows':
    'W Windows trafiają do Menedżera poświadczeń: Panel sterowania → Konta użytkowników → Menedżer poświadczeń → Poświadczenia systemu Windows, wpisy zaczynające się od „com.ravenforge.launcher”. Windows szyfruje je Twoim kontem użytkownika; programy uruchomione na Twoim koncie mogą o nie poprosić, inni użytkownicy komputera nie.',
  'storage.keychain.linux':
    'W Linuksie trafiają do pęku kluczy pulpitu przez usługę Secret Service: GNOME Keyring (aplikacja „Hasła i klucze”) albo KWallet (KWalletManager), jako wpisy usługi „com.ravenforge.launcher”. Pęk jest zaszyfrowany hasłem logowania i otwarty, dopóki jesteś zalogowany; programy z Twojej sesji mogą z niego czytać.',
  'storage.keychain.mac':
    'W macOS trafiają do Pęku kluczy (aplikacja „Dostęp do pęku kluczy”), jako wpisy usługi „com.ravenforge.launcher”.',
  'storage.keychain.none':
    'Na tym komputerze: brak wpisów — nie jest zalogowane żadne konto Microsoft.',
  'storage.keychain.count.one': 'Na tym komputerze: {count} wpis.',
  'storage.keychain.count.few':
    'Na tym komputerze: {count} wpisy, po dwa na każde konto Microsoft.',
  'storage.keychain.count.many':
    'Na tym komputerze: {count} wpisów, po dwa na każde konto Microsoft.',
  'storage.keychain.count.other': 'Na tym komputerze: {count} wpisu.',
  'storage.keychain.unavailable':
    'Na tym komputerze magazyn poświadczeń nie odpowiada. Logowanie Microsoft jest wtedy zapisane w pliku auth.json w folderze danych, czytelnym tylko dla Twojego użytkownika — ekran Konta mówi o tym wprost.',
  'storage.keychain.remove':
    '„Wyloguj” w zakładce Konta usuwa oba wpisy tego konta. Możesz je też usunąć ręcznie w miejscu opisanym wyżej — launcher poprosi wtedy o ponowne logowanie.',

  'privacy.dest.title': 'Z kim launcher się kontaktuje',
  'privacy.dest.body':
    'Poproszenie o cokolwiek dowolnego komputera w internecie mówi mu Twój adres IP — numer, który Twój dostawca przypisał Twojemu łączu. Dzieje się tak przy każdej otwartej stronie i przy wszystkim poniżej. Nic więcej o Tobie tam nie idzie.',
  'privacy.dest.nothing': 'Tylko prośba o pliki. Nic o Tobie.',
  'privacy.dest.auth.who': 'Microsoft, Xbox i Mojang',
  'privacy.dest.auth.when': 'gdy logujesz się przez Microsoft',
  'privacy.dest.auth.sends':
    'Logujesz się na stronie samego Microsoftu, w osobnym oknie — launcher nigdy nie widzi Twojego hasła. Wracają z niej Twoja nazwa gracza, skórka i zgoda na uruchomienie gry. W trybie offline nie dzieje się to w ogóle.',
  'privacy.dest.mojang.who': 'Mojang',
  'privacy.dest.mojang.when': 'przy instalacji i uruchamianiu gry',
  'privacy.dest.java.who': 'Adoptium',
  'privacy.dest.java.when': 'gdy launcher instaluje za Ciebie Javę',
  'privacy.dest.java.sends': 'Która wersja Javy jest potrzebna i na jakim jesteś systemie.',
  'privacy.dest.loaders.who': 'Fabric, Forge, NeoForge i Quilt',
  'privacy.dest.loaders.when': 'przy wyborze i instalacji loadera',
  'privacy.dest.modrinth.who': 'Modrinth',
  'privacy.dest.modrinth.when':
    'gdy szukasz modów i paczek, otwierasz listę zainstalowanych albo sprawdzasz aktualizacje',
  'privacy.dest.modrinth.sends':
    'To, co wpisujesz w wyszukiwarkę, i ustawione filtry. Otwarcie listy modów, shaderów albo paczek zasobów profilu wysyła identyfikatory tych, które masz — tak launcher pobiera ich opisy i ikony, a odpowiedź pamięta przez tydzień. Sprawdzenie aktualizacji albo eksport paczki wysyła dodatkowo skrót każdego pliku moda z tego profilu. Nic, co mówiłoby, kim jesteś — zapytanie przedstawia launcher, który pyta, a nie osobę.',
  'privacy.dest.packs.who': 'White Ravens',
  'privacy.dest.packs.when': 'wiadomości, lista paczek serwerowych i same paczki',
  'privacy.dest.updates.who': 'GitHub',
  'privacy.dest.updates.when': 'przy każdym starcie i gdy sprawdzasz aktualizacje',
  'privacy.dest.updates.sends':
    'Jedno pytanie: czy jest nowsza wersja? Dzieje się samo przy każdym starcie i na razie nie da się tego wyłączyć.',
  'privacy.dest.feeds': 'Wiadomości, tak jak są ustawione na tym komputerze:',
  'privacy.dest.feedOff': 'wyłączone — nic nie jest pobierane',

  'privacy.game.title': 'Gra to osobny program',
  'privacy.game.body':
    'Kiedy gra już wystartuje, launcher schodzi jej z drogi. Gra sprawdza u Mojanga, że konto jest Twoje, a każdy serwer, na który wejdziesz, widzi Twój adres IP, nazwę gracza i numer konta — dokładnie tak samo jak przy każdym innym launcherze.',
  'privacy.game.mods':
    'Mod to program napisany przez kogoś innego i kiedy już działa, może zrobić wszystko to, co Ty możesz zrobić na tym komputerze — łącznie z wysyłaniem rzeczy przez internet. Launcher sprawdza, czy mod to dokładnie ten plik, który miał pobrać — nie jest w stanie sprawdzić, czy ten plik jest uczciwy. Instaluj mody tylko z miejsc, którym ufasz.',

  'privacy.control.title': 'O czym decydujesz Ty',
  'privacy.control.offline':
    'Logowanie: Ustawienia → Zachowanie → „Zawsze uruchamiaj offline”. Launcher nie łączy się wtedy z serwerami logowania Microsoft, Xbox ani Mojang; pliki gry i mody nadal się pobierają. Konto offline (Konta → Tryb offline) nie loguje się nigdzie w ogóle.',
  'privacy.control.feeds':
    'Wiadomości: Ustawienia → Źródła treści. Wyczyść oba adresy, a launcher przestanie pobierać aktualności i ogłoszenia. Wpisz własne, a będzie pytał tylko je.',
  'privacy.control.proxy':
    'Pośrednik: Ustawienia → Sieć i pobieranie → Proxy URL. Przez wskazany serwer idą wszystkie połączenia launchera — pobieranie, logowanie, obrazki. Gra, kiedy już działa, łączy się po swojemu i proxy launchera jej nie obejmuje.',
  'privacy.control.discord':
    'Discord: Ustawienia → Zachowanie → „Pokazuj grę na statusie Discorda”, domyślnie wyłączone. Włączone pokazuje nazwę profilu, wersję i loader każdemu, kto widzi Twój profil na Discordzie — bez adresu serwera.',
  'privacy.control.packs':
    'Paczki: profil, który śledzi paczkę, pyta o nią adres ze swojego pola „Manifest URL” — przy starcie launchera i przed każdym uruchomieniem gry. Usuń ten adres w edytorze profilu, a profil przestanie pytać i przestanie się aktualizować.',
  'privacy.control.updates':
    'Aktualizacje launchera: sprawdzane przy każdym starcie jednym zapytaniem do GitHuba. Tego na razie nie da się wyłączyć.',
  'privacy.control.diagnostics':
    'Logi i raporty z awarii: nie opuszczają komputera, dopóki sam ich komuś nie wyślesz. „Zgłoś błąd” otwiera stronę zgłoszeń w przeglądarce, a plik dołączasz ręcznie.',
  'privacy.control.location':
    'Miejsce na dysku: Ustawienia → Dane → „Przenieś…” przenosi folder danych tam, gdzie wskażesz.',
  'privacy.control.delete':
    'Usuwanie: „Wyloguj” w zakładce Konta kasuje zapisane logowanie tego konta — wpisy w systemowym magazynie poświadczeń i ciasteczka okna logowania. Usunięcie folderu danych i folderu launchera z listy powyżej usuwa całą resztę; deinstalator w Windows pyta o to wprost. Po naszej stronie nie ma czego usuwać.',

  'privacy.fullPolicy': 'Przeczytaj pełną politykę prywatności',
  'privacy.fullPolicyHint':
    'Otwiera się w przeglądarce. To samo opisane w całości, razem z tym, co wiemy, że jest niedoskonałe.',

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

  // ── Folder danych ────────────────────────────────────────
  'dataRoot.title': 'Przenieś folder danych',
  'dataRoot.from': 'Teraz',
  'dataRoot.to': 'Nowe miejsce',
  'dataRoot.moveSameVolume':
    'Przeniesione zostanie {size}. To ten sam dysk, więc pliki zostaną przesunięte bez kopiowania — potrwa to chwilę.',
  'dataRoot.moveCopy':
    'Przeniesione zostanie {size}. Pliki zostaną skopiowane na drugi dysk, porównane z oryginałem i dopiero wtedy usunięte ze starego miejsca. Gdyby coś się nie udało, wszystko zostaje tam, gdzie było.',
  'dataRoot.staysHome':
    'W starym folderze zostanie tylko to, co nie jest danymi: plik data-root.txt, który wskazuje nowe miejsce, i folder browser z plikami okna launchera.',
  'dataRoot.staysNothing': 'Stary folder zostanie opróżniony i usunięty.',
  'dataRoot.replacesDebris':
    'W nowym miejscu są puste pliki launchera albo pozostałość po niedokończonym przenoszeniu — zostaną zastąpione.',
  'dataRoot.warnSpaces':
    'Ta ścieżka zawiera spacje. Minecraft sobie z tym radzi, ale część modów i narzędzi nie — bezpieczniejszy jest folder bez spacji.',
  'dataRoot.warnNonAscii':
    'Ta ścieżka zawiera znaki spoza podstawowego alfabetu (na przykład polskie litery). Część modów sobie z nimi nie radzi — bezpieczniejszy jest folder z samych liter A–Z, cyfr i myślników.',
  'dataRoot.done': 'Gotowe — launcher korzysta teraz z nowego folderu.',
  'dataRoot.leftovers':
    'Tych starych kopii nie udało się usunąć. Dane są bezpieczne w nowym miejscu, a te pliki są już zbędne — możesz je skasować ręcznie:',
  'dataRoot.adopt':
    'W tym folderze są już profile launchera, więc zostanie użyty tak, jak jest — nic nie jest kopiowane, a to, co jest w obecnym folderze, tam zostaje.',
  'dataRoot.free': 'Wolne miejsce w miejscu docelowym: {free}',
  'dataRoot.restartNotice': 'Po przeniesieniu launcher uruchomi się ponownie.',
  'dataRoot.confirm': 'Przenieś i uruchom ponownie',
  'dataRoot.confirmAdopt': 'Użyj tego folderu i uruchom ponownie',
  'dataRoot.moving': 'Przenoszenie danych…',
  'dataRoot.restarting': 'Launcher zaraz uruchomi się ponownie…',
  'dataRoot.failed': 'Nie udało się przenieść folderu danych: {error}',
  'dataRoot.problem.same': 'To już jest używany folder.',
  'dataRoot.problem.nested': 'Ten folder jest wewnątrz obecnego — wybierz taki spoza niego.',
  'dataRoot.problem.notWritable': 'Do tego folderu nie da się nic zapisać.',
  'dataRoot.problem.notEmpty':
    'W tym folderze są inne pliki, a podfolder „raven-forge-launcher”, który launcher by w nim utworzył, też jest zajęty. Wybierz inne miejsce.',
  'dataRoot.problem.noSpace': 'Za mało miejsca: do przeniesienia {size}, wolne {free}.',
  'dataRoot.problem.envLocked':
    'O miejscu na dane dla tej instalacji decyduje RAVENFORGE_DATA_DIR.',
  'dataRoot.problem.gameRunning':
    'Najpierw zamknij grę i poczekaj, aż skończy się pobieranie — launcher pracuje teraz na tych plikach.',
};
