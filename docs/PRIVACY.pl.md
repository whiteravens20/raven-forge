# Polityka prywatności — Raven Forge

[English](PRIVACY.md) · **Polski**

**Ostatnia aktualizacja: 2026-08-18**

Ten dokument opisuje każdą daną, którą Raven Forge przechowuje, każdy serwer, z
którym się łączy, i to, co tam wysyła. Powstał na podstawie kodu źródłowego, a
nie szablonu — za każdym stwierdzeniem poniżej stoi coś, co można pójść i
przeczytać.

Jeśli znajdziesz różnicę między tym dokumentem a tym, co launcher robi
naprawdę, to jest błąd — [zgłoś go](https://github.com/whiteravens20/raven-forge/issues/new?template=bug_report.md),
a poprawimy to z tych dwóch, które się myli.

---

## W skrócie

- **Raven Forge nie zbiera o Tobie niczego.** Żadnej analityki, telemetrii,
  statystyk użycia, unikalnego identyfikatora instalacji ani wysyłania raportów
  z awarii.
- **White Ravens nie ma serwera, który odbierałby Twoje dane.** Nie zakładasz u
  nas konta i nie ma bazy danych z Twoim nazwiskiem. Kanały wiadomości i katalog
  paczek, które publikujemy, to statyczne pliki — nie widzimy, kto je pobiera.
- **Twoje dane logowania do Minecrafta trafiają do Microsoftu i Mojanga, i
  nigdzie indziej.** Launcher nigdy nie widzi Twojego hasła — wpisujesz je na
  stronie samego Microsoftu.
- **Cała reszta zostaje na Twoim komputerze**, w jednym folderze, który możesz
  otworzyć z Ustawień i w każdej chwili usunąć.
- Launcher wykonuje połączenia wychodzące, żeby wykonywać swoją pracę — pobrać
  Minecrafta, znaleźć mody, sprawdzić aktualizacje. Każde z nich jest wymienione
  niżej razem z tym, co ujawnia.

---

## Czego Raven Forge nie robi

|                                    |                                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Analityka lub telemetria           | Nie ma. W kodzie nie istnieje żaden endpoint raportujący — dlatego nie ma też przełącznika do wyłączenia.               |
| Identyfikator instalacji           | Nie jest generowany ani wysyłany.                                                                                       |
| Wysyłanie raportów z awarii do nas | Raporty zapisują się do pliku lokalnie. Nic ich nie wysyła; to Ty decydujesz, czy i kiedy dołączyć jeden do zgłoszenia. |
| Konto w White Ravens               | Nie istnieje. Twoje konto Minecrafta jest kontem Microsoftu.                                                            |
| Sprzedaż lub udostępnianie danych  | Nie ma czego sprzedawać ani udostępniać.                                                                                |
| Reklamy lub skrypty śledzące       | Interfejs launchera nie ładuje żadnego zdalnego kodu — zabrania tego jego Content-Security-Policy.                      |

---

## Co jest przechowywane na Twoim komputerze

Wszystko, co launcher o Tobie trzyma, leży w jednym folderze i nic poza nim.
Są tam Twoje profile razem ze światami, ustawienia launchera, lista kont, zapis
tego, co launcher robił, oraz raporty z awarii.

Nie musisz szukać tego folderu ręcznie: **Ustawienia → Dane → Folder danych**
otwiera go na każdym systemie, a strona prywatności w apce (Informacje →
Prywatność) pokazuje dokładną ścieżkę tej instalacji. Jeśli go nie przeniosłeś,
jest to:

| System  | Lokalizacja                                          |
| ------- | ---------------------------------------------------- |
| Windows | `%APPDATA%\Raven Forge Launcher`                     |
| Linux   | `~/.config/Raven Forge Launcher`                     |
| macOS   | `~/Library/Application Support/Raven Forge Launcher` |

**Ustawienia → Dane → Przenieś…** przenosi go, gdzie chcesz — zwykle na inny
dysk, bo pliki gry to gigabajty. Launcher przenosi zawartość i uruchamia się
ponownie już w nowym miejscu. Dwie rzeczy zostają w folderze powyżej, bo są
diagnostyką launchera, a nie danymi o Tobie — i bo chcesz je móc przeczytać w
dniu, w którym tamten dysk nie jest podpięty: `logs/` i `crash-reports/`.
Zostaje tam też jednolinijkowy `data-root.txt` z informacją, dokąd poszła
reszta — czyta go deinstalator Windows, żeby „usuń moje dane" nadal znaczyło
wszystkie.

W środku:

| Ścieżka                       | Zawartość                                                                                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings.json`               | Twoje ustawienia — motyw, język, adres proxy, adresy kanałów, liczba równoległych pobrań, zaufane klucze podpisu.                                                                         |
| `profiles.json`               | Twoje profile: nazwy, wersje Minecrafta, loadery, przydzielony RAM, adresy manifestów, czas gry i daty ostatniego uruchomienia.                                                           |
| `profiles/<id>/.minecraft/`   | Prawdziwy katalog gry, osobny dla każdego profilu — światy, zrzuty ekranu, `options.txt`, mody, paczki zasobów, shadery. To pliki samego Minecrafta, trzymane osobno dla każdego profilu. |
| `auth.json`                   | Lista kont: nazwa gracza, UUID, typ konta, adres skórki i data ostatniego uwierzytelnienia. Zapisywany z uprawnieniami `0600`. **Sekrety normalnie w tym pliku nie leżą** — patrz niżej.  |
| `logs/main.log`               | Log launchera, rotowany przy 5 MB. Patrz „Co trafia do logu”.                                                                                                                             |
| `crash-reports/`              | Po jednym pliku na awarię, ze zredagowaną treścią, przechowywane 20 najnowszych. Patrz „Raporty z awarii”.                                                                                |
| `java/`, `loaders/`, `cache/` | Pobrane środowiska Javy, instalatory loaderów i zbuforowane metadane. Nic osobistego.                                                                                                     |
| `data-root.txt`               | Jest tylko wtedy, gdy przeniosłeś folder danych: jedna linia ze ścieżką, pod którą go przeniosłeś, i nic poza tym. Zostaje w lokalizacji powyżej.                                         |

Chromium trzyma w tym folderze także własne dane, w tym ciasteczka z okna
logowania Microsoftu. Są kasowane, gdy wylogujesz konto Microsoft.

### Gdzie leżą poświadczenia

**Twoje hasło nie jest przechowywane nigdzie.** Wpisujesz je na stronie
Microsoftu, w osobnym oknie; launcher nie jest w stanie go odczytać. Trzyma
jedynie przepustkę, którą Microsoft odsyła, i wkłada ją do systemowego sejfu na
hasła — tego samego, z którego korzysta Twoja przeglądarka. Poniżej to samo,
tylko technicznie.

Na jedno konto Microsoft przypadają dwa sekrety: **token odświeżający
Microsoftu** (którym można uzyskać nowe sesje) i **token sesji Minecrafta**
(którym udowadniasz serwerom gry, że to Ty).

Oba trafiają do magazynu poświadczeń systemu operacyjnego — Menedżera
poświadczeń na Windows, Keychain na macOS, libsecret/kwallet na Linuksie — pod
nazwą usługi `com.ravenforge.launcher`. Sam launcher nie zapisuje ich na dysk.

**Wyjątek jest powiedziany wprost.** Na maszynie bez działającego pęku kluczy
(częsty przypadek na Linuksie: nie działa `gnome-keyring` ani `kwallet`) zapis
do magazynu się nie udaje. Zamiast uniemożliwiać logowanie, launcher zapisuje je
awaryjnie w `auth.json` z uprawnieniami `0600` — i mówi Ci o tym ostrzeżeniem na
stronie Konta, podając dokładną ścieżkę do pliku. To Twoja decyzja, więc
dostajesz ją do podjęcia, a nie tylko wpis w logu.

Konta offline nie mają żadnych tokenów. „Token dostępu” przy uruchomieniu
offline to dosłownie znak `0`.

### Co trafia do logu

`logs/main.log` zapisuje, co launcher robił: który profil wystartował, jakie
pliki pobrał, jakie błędy wystąpiły. Zawiera Twoją nazwę gracza
(`Authenticated Microsoft account: <nazwa>`) i bezwzględne ścieżki plików, w
których na Windows siedzi nazwa Twojego konta systemowego.

Przepisuje też **dosłownie wyjście samej gry** — i to jest ta część, na którą
trzeba uważać: mod może wypisać tam cokolwiek, łącznie z argumentami
uruchomienia zawierającymi żywy token sesji. Własna linia launchera
(„Launching:”) jest ucięta do 200 znaków i sięga wyłącznie opcji JVM, nigdy
tokenu — ale wyjście gry nie jest filtrowane.

**Zatem: zredaguj `logs/main.log`, zanim go komuś wyślesz.** Opisane niżej
raporty z awarii istnieją właśnie po to, żebyś nie musiał.

---

## Dokąd launcher się łączy

Każde z poniższych żądań ujawnia serwerowi, który je odbiera, Twój adres IP i
fakt, że używasz Raven Forge. To wynika z samego wykonania żądania sieciowego, a
nie z czegoś, co launcher dokłada.

Wszystko to respektuje proxy ustawione w **Ustawienia → Sieć i pobieranie**.

### Tylko przy logowaniu przez Microsoft

| Host                                               | Co jest wysyłane                                                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `login.microsoftonline.com`                        | Strona logowania Microsoftu otwiera się w osobnym oknie. **Dane wpisujesz na stronie Microsoftu; launcher nie może ich odczytać.** Dostaje tylko kod autoryzacyjny, który wymienia na tokeny z użyciem PKCE. |
| `user.auth.xboxlive.com`, `xsts.auth.xboxlive.com` | Token dostępu Microsoftu, w zamian za token Xbox Live.                                                                                                                                                       |
| `api.minecraftservices.com`                        | Token Xbox, w zamian za sesję Minecrafta. Zwraca Twoje UUID, nazwę gracza i adres skórki.                                                                                                                    |

Launcher prosi dokładnie o dwa zakresy OAuth: `XboxLive.signin` i
`offline_access`. Nie może odczytać Twojej poczty, kontaktów ani niczego innego
na Twoim koncie Microsoft.

**Tryb offline (Ustawienia → Zachowanie) nie kontaktuje się z żadnym z nich.**

### Żeby zainstalować i uruchomić grę

| Host                                                                                                                   | Kiedy                                   | Co jest wysyłane                         |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------- |
| `piston-meta.mojang.com`, `resources.download.minecraft.net`, serwery bibliotek Mojanga                                | Instalacja lub uruchomienie wersji      | Nic poza samym żądaniem.                 |
| `api.adoptium.net`                                                                                                     | Instalacja zarządzanego środowiska Javy | Wersja Javy, Twój system i architektura. |
| `meta.fabricmc.net`, `meta.quiltmc.org`, `maven.minecraftforge.net`, `files.minecraftforge.net`, `maven.neoforged.net` | Instalacja loadera                      | Nic poza samym żądaniem.                 |

### Żeby znaleźć i zainstalować zawartość

| Host                                                     | Kiedy                                                                           | Co jest wysyłane                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.modrinth.com`, `cdn.modrinth.com`                   | Przeglądanie lub instalowanie modów, shaderów i paczek zasobów                  | **Twoje frazy wyszukiwania i filtry.** Regulamin API Modrinth wymaga identyfikującego się User-Agenta, więc żądania niosą `whiteravens20/raven-forge/<wersja> (<adres repo>)` — nazwę i wersję launchera, nie Ciebie.                                                                                                                       |
| `api.modrinth.com`                                       | Sprawdzanie aktualizacji zainstalowanych modów albo eksport profilu jako paczki | **Skrót SHA-512 każdego pliku moda w tym profilu.** Tak właśnie pyta się Modrinth, czym jest dany plik i co go zastąpiło — i tylko dzięki temu da się rozpoznać jar wrzucony ręcznie. Skrót nazywa plik, nie Ciebie, ale ich zestaw opisuje, jakie mody ma ten profil, więc idzie wyłącznie po naciśnięciu jednego z tych dwóch przycisków. |
| Serwer, na którym leży ikona moda lub obrazek wiadomości | Przy ich wyświetlaniu                                                           | Żądanie idzie do tego serwera. Obrazki ładują się prosto stamtąd, gdzie projekt je opublikował.                                                                                                                                                                                                                                             |

### Do White Ravens

| Host                      | Kiedy                                                         | Co jest wysyłane         |
| ------------------------- | ------------------------------------------------------------- | ------------------------ |
| `whiteravens20.github.io` | Kanał wiadomości, kanał ogłoszeń i katalog paczek serwerowych | Nic poza samym żądaniem. |

To **statyczne pliki na GitHub Pages**. Nie prowadzimy żadnego serwera ani
własnych logów — co oznacza też, że to GitHub, a nie White Ravens, odbiera i
kontroluje logi tych żądań, na warunkach
[oświadczenia o prywatności GitHuba](https://docs.github.com/site-policy/privacy-policies/github-privacy-statement).
My ich nigdy nie widzimy.

Oba adresy kanałów możesz zmienić lub wyczyścić w **Ustawienia → Źródła
treści**. Wyczyszczenie pola wyłącza dany kanał całkowicie.

### Do manifestu, który sam skonfigurowałeś

Profil może być związany z adresem manifestu — naszym, Twojego serwera albo
czyimkolwiek. Launcher pobiera go, żeby zsynchronizować mody. Wysyła tylko samo
żądanie wraz z nagłówkiem `If-None-Match` niosącym ETag poprzedniej odpowiedzi.
Ten, kto prowadzi tamten adres, widzi Twoje IP.

### Do GitHuba

| Host            | Kiedy                                                                            | Co jest wysyłane                                                                   |
| --------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| GitHub Releases | **Automatycznie przy każdym starcie** oraz po naciśnięciu „Sprawdź aktualizacje” | Nic poza samym żądaniem. Ujawnia GitHubowi Twoje IP, wersję launchera i platformę. |

Patrz „Znane luki” — obecnie nie ma przełącznika wyłączającego automatyczne
sprawdzanie.

### Odnośniki, które przekazują Cię przeglądarce

Część przycisków sama z niczym się nie łączy — otwiera adres w Twojej zwykłej
przeglądarce i w tym momencie przestaje być sprawą launchera. Ta strona widzi
wtedy wizytę Twojej przeglądarki, z wszystkimi ciasteczkami i historią, które
ona już ma.

| Gdzie                                       | Otwiera                                     |
| ------------------------------------------- | ------------------------------------------- |
| Konta → Ustawienia konta Minecraft          | `minecraft.net`                             |
| Informacja o Bedrock Edition                | `minecraft.net`                             |
| Info → O programie oraz raporter awarii     | `github.com` i `whiteravens.net`            |
| „Przeczytaj na stronie” przy aktualnościach | Adres, pod którym opublikowano dany artykuł |

Launcher nigdy nie otwiera żadnego z nich sam z siebie.

---

## Status na Discordzie

Domyślnie wyłączony. Po włączeniu w **Ustawieniach → Zachowanie** launcher pisze
do gniazda Discorda na Twoim komputerze, dopóki gra działa, a Discord pokazuje na
Twoim statusie nazwę profilu, wersję Minecrafta i loader.

- Przez Raven Forge nic nie opuszcza Twojego komputera. Gniazdo jest lokalne; co
  Discord robi ze statusem dalej, to już zachowanie Discorda — widzi go każdy,
  kto widzi Twój profil.
- **Adres serwera nie jest wysyłany**, choć launcher go zna. Trafiłby do całej
  Twojej listy znajomych, a ten adres nie jest wyłącznie Twój.
- Status znika, gdy gra się kończy, wywala albo nie startuje.
- Przy wyłączonym ustawieniu żadne gniazdo nie jest otwierane i nic nie jest
  wysyłane.

---

## Gra to osobny program

Kiedy Minecraft już wystartuje, jest własnym procesem, a Raven Forge nie pośredniczy
w niczym, co on robi.

- Minecraft łączy się z serwerami sesji Mojanga, żeby zweryfikować Cię przy
  wchodzeniu na serwery w trybie online.
- Serwery multiplayer, na które wchodzisz, widzą Twoje IP, nazwę gracza i UUID.
- **Mody to dowolny kod Javy z uprawnieniami Twojego użytkownika.** Mod może
  otworzyć dowolne połączenie sieciowe, odczytać każdy plik, który Ty możesz
  odczytać, i wysłać go gdziekolwiek. Raven Forge weryfikuje, że dostałeś
  dokładnie ten plik, który manifest wskazał — nie jest w stanie powiedzieć, że
  ten plik jest godny zaufania.

Dodawaj tylko te źródła manifestów i te mody, którym faktycznie ufasz. Szerzej
opisuje to [SECURITY.md](../SECURITY.md).

---

## Raporty z awarii

Kiedy gra kończy się błędem, launcher zapisuje jeden plik do `crash-reports/`.
Zawiera wersje launchera i Javy, Twój system, konfigurację profilu, listę
zainstalowanych modów, własny raport awarii Minecrafta i ostatnie 100 linii
wyjścia gry.

**Zapisuje się już zredagowany.** Zanim plik trafi na dysk, launcher usuwa:
każdy token o kształcie JWT, wartość każdego argumentu `--accessToken` /
`--clientId` / `--xuid` / `--uuid` / `--username` / `--session`, dosłowny token
dostępu, UUID i nazwę gracza użyte w tym uruchomieniu, oraz ścieżkę Twojego
katalogu domowego — która na Windows zawiera nazwę Twojego konta — zastępowaną
znakiem `~`.

**Nic go nie wysyła.** Leży w folderze, dopóki nie zdecydujesz inaczej. Karta
pokazywana po awarii proponuje jego otwarcie; **Ustawienia → Dane → Raporty z
awarii** otwiera ten folder w dowolnym momencie.

Redakcja nie może wiedzieć, co mod postanowił wypisać w wyjściu gry, więc
przejrzyj raport, zanim dołączysz go do publicznego zgłoszenia.

---

## Co możesz wyłączyć

| Ustawienie                                                          | Efekt                                                                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Tryb offline** (Ustawienia → Zachowanie)                          | Nigdy nie kontaktuje się z serwerami uwierzytelniania. Tylko gra jednoosobowa i LAN.                                                  |
| **Adres kanału wiadomości / ogłoszeń** (Ustawienia → Źródła treści) | Wyczyść pole, a dany kanał nie będzie już pobierany.                                                                                  |
| **Proxy** (Ustawienia → Sieć i pobieranie)                          | Kieruje każde żądanie launchera przez proxy, które kontrolujesz.                                                                      |
| **Status na Discordzie** (Ustawienia → Zachowanie)                  | Domyślnie wyłączony. Włączony — Twój profil na Discordzie pokazuje, w co grasz.                                                       |
| Nieużywanie strony Mody                                             | Do Modrinth nie idzie nic, dopóki czegoś nie wyszukasz, nie zainstalujesz, nie sprawdzisz aktualizacji ani nie wyeksportujesz paczki. |
| Konto offline                                                       | Żaden serwer Microsoftu ani Xboxa nie jest w ogóle dotykany.                                                                          |

---

## Usuwanie wszystkiego

- **Jedno konto:** „Wyloguj” na stronie Konta usuwa je z `auth.json` i kasuje
  jego wpisy w magazynie poświadczeń. Wylogowanie z konta Microsoft czyści też
  ciasteczka okna logowania, więc następne logowanie zaczyna się od pustej
  strony, a nie od rozpoznania Ciebie.
- **Wszystkie dane launchera:** zamknij launcher i usuń wymieniony wyżej folder
  danych. Poza nim nie zostaje nic oprócz wpisów w magazynie poświadczeń
  systemu, które znikają, jeśli najpierw się wylogujesz.
- **Odinstalowanie:** usunięcie launchera i usunięcie danych to dwie osobne
  rzeczy. Na Windows deinstalator pyta, co zrobić; na Linuksie pakiet w ogóle nie
  rusza katalogu domowego. Opisuje to [UNINSTALL.md](UNINSTALL.md).
- **Po naszej stronie:** nie ma czego usuwać. Nie mamy niczego.

---

## Znane luki

Wymienione celowo. Uczciwa lista jest lepsza niż taka, która ładnie wygląda.

- **Sprawdzania aktualizacji przy starcie nie da się wyłączyć** z Ustawień. To
  jedno żądanie do GitHub Releases przy każdym uruchomieniu. Przy zablokowanej
  sieci po prostu cicho zawodzi.
- **Pliki logów nie są redagowane.** Redagowane są tylko raporty z awarii. Patrz
  „Co trafia do logu”.
- **Skórki ładują się z serwerów tekstur Microsoftu** po adresie URL przy
  otwarciu strony Konta, co mówi tamtemu serwerowi, że ją otworzyłeś.

---

## Stan prawny

Raven Forge to program działający na Twoim komputerze. White Ravens nie prowadzi
żadnej usługi, która odbierałaby z niego dane osobowe — w odniesieniu do
launchera nie ma po naszej stronie administratora danych i nie ma czego
przetwarzać, przechowywać, eksportować ani usuwać.

Strony, które dane rzeczywiście otrzymują, to te, których należy się spodziewać
po powyższych tabelach — Microsoft i Mojang w sprawie Twojego konta, Modrinth w
sprawie wyszukiwanej zawartości, Adoptium w sprawie Javy, GitHub w sprawie
sprawdzania aktualizacji i naszych publikowanych kanałów — każda na warunkach
własnej polityki prywatności i własnego regulaminu.

---

## Zmiany w tej polityce

Ten plik jest wersjonowany w repozytorium razem z kodem, który opisuje. Jego
historia jest listą zmian: `git log PRIVACY.pl.md`. Każda zmiana dotycząca tego,
jakie dane są przechowywane lub wysyłane, zostanie odnotowana w informacjach o
wydaniu.

---

## Kontakt

- **Zgłoszenia i pytania:** [github.com/whiteravens20/raven-forge/issues](https://github.com/whiteravens20/raven-forge/issues)
- **Podatności bezpieczeństwa:** postępuj według [SECURITY.md](../SECURITY.md) — nie
  otwieraj publicznego zgłoszenia.
- **Wolisz nie korzystać z GitHuba:** skontaktuj się z White Ravens przez
  [whiteravens.net](https://whiteravens.net).

---

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
