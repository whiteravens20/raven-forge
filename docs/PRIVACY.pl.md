# Polityka prywatności — Raven Forge

[English](PRIVACY.md) · **Polski**

**Ostatnia aktualizacja: 2026-10-06**

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
- **Cała reszta zostaje na Twoim komputerze**, w folderach, które Ustawienia
  wymieniają razem z rozmiarem, otwierają i które możesz w każdej chwili usunąć.
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

Launcher zapisuje w dwóch folderach i zwykle jest to jeden i ten sam.

**Folder launchera** to miejsce samego launchera i nigdy się nie przenosi:

| System  | Lokalizacja                                          |
| ------- | ---------------------------------------------------- |
| Windows | `%APPDATA%\raven-forge-launcher`                     |
| Linux   | `~/.config/raven-forge-launcher`                     |
| macOS   | `~/Library/Application Support/raven-forge-launcher` |

**Folder danych** trzyma wszystko, co Twoje: profile razem ze światami,
ustawienia, listę kont, logi i raporty z awarii. Dopóki go nie przeniesiesz,
jest nim folder launchera. **Ustawienia → Dane → Przenieś…** przenosi go, gdzie
chcesz — zwykle na inny dysk, bo pliki gry to gigabajty. Launcher przenosi
całość, sprawdza kopię i dopiero wtedy usuwa oryginał; jeśli coś po drodze się
nie uda, przywraca stan sprzed przenoszenia, a jeśli czegoś nie dało się usunąć
ze starego miejsca, wymienia dokładnie co.

Żadnego z nich nie musisz szukać ręcznie. **Ustawienia → Dane** oraz strona
prywatności w apce (Informacje → Prywatność) wymieniają każde miejsce, w którym
launcher zapisuje na tym komputerze — ze ścieżką, rozmiarem zmierzonym na Twoim
dysku i przyciskiem, który je otwiera.

W folderze danych:

| Ścieżka                       | Zawartość                                                                                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings.json`               | Twoje ustawienia — motyw, język, adres proxy, adresy kanałów, liczba równoległych pobrań, zaufane klucze podpisu.                                                                             |
| `profiles.json`               | Twoje profile: nazwy, wersje Minecrafta, loadery, przydzielony RAM, adresy manifestów, czas gry i daty ostatniego uruchomienia.                                                               |
| `profiles/<id>/`              | Po jednym folderze na profil: `.minecraft/` — prawdziwy katalog gry ze światami, zrzutami ekranu, `options.txt`, modami, paczkami zasobów i shaderami — oraz kopie światów i obrazek profilu. |
| `auth.json`                   | Lista kont: nazwa gracza, UUID, typ konta i adres skórki. Zapisywany z uprawnieniami `0600`. **Sekrety normalnie w tym pliku nie leżą** — patrz niżej.      |
| `logs/main.log`               | Log launchera, rotowany przy 5 MB. Patrz „Co trafia do logu”.                                                                                                                                 |
| `crash-reports/`              | Po jednym pliku na awarię, ze zredagowaną treścią, przechowywane 20 najnowszych. Patrz „Raporty z awarii”.                                                                                    |
| `java/`, `loaders/`, `cache/` | Pobrane środowiska Javy, loadery, pliki samego Minecrafta i zbuforowane metadane. Nic osobistego; usunięte, pobiorą się ponownie.                                                             |

W folderze launchera, gdziekolwiek są dane:

| Ścieżka         | Zawartość                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `browser/`      | Okno launchera to wbudowana przeglądarka, a to jej własne pliki: pamięć podręczna obrazków (ikony modów, grafiki z aktualności), zamknięte ogłoszenia, ostatnio wybrany profil i ciasteczka strony logowania Microsoftu. |
| `data-root.txt` | Jest tylko wtedy, gdy przeniosłeś folder danych: jedna linia ze ścieżką, dokąd trafił, i nic poza tym. Czytają go launcher i deinstalator Windows, żeby znaleźć dane.                                                    |

I poza oboma:

| Gdzie                                                                                            | Zawartość                                                             |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Systemowy magazyn poświadczeń                                                                    | Logowanie Microsoft. Patrz „Gdzie leżą poświadczenia”.                |
| `%LOCALAPPDATA%\raven-forge-launcher-updater` (Windows), `~/.cache/raven-forge-launcher-updater` | Instalator nowej wersji launchera, pobrany i czekający na instalację. |
| Tam, gdzie launcher jest zainstalowany                                                           | Sam program. Niczego tam nie zapisuje.                                |

Wersje do 0.7.1 nazywały folder launchera `Raven Forge Launcher`. Nowsza wersja
przy pierwszym starcie zmienia mu nazwę i odkłada pliki wbudowanej przeglądarki
do `browser/`; nic z jego zawartości nie ginie. Jeśli starego folderu nie da się
w tej chwili przemianować — ma go otwartego coś innego — launcher dalej używa go
pod starą nazwą.

### Gdzie leżą poświadczenia

**Twoje hasło nie jest przechowywane nigdzie.** Wpisujesz je na stronie
Microsoftu, w osobnym oknie; launcher nie jest w stanie go odczytać. Trzyma
jedynie przepustkę, którą Microsoft odsyła, i wkłada ją do systemowego sejfu na
hasła — tego samego, z którego korzysta Twoja przeglądarka. Poniżej to samo,
tylko technicznie.

Na jedno konto Microsoft przypadają dwa sekrety: **token odświeżający
Microsoftu** (którym można uzyskać nowe sesje) i **token sesji Minecrafta**
(którym udowadniasz serwerom gry, że to Ty).

Oba trafiają do magazynu poświadczeń systemu operacyjnego jako wpisy usługi
`com.ravenforge.launcher` — po dwa na konto Microsoft. Sam launcher nie zapisuje
ich na dysk.

| System  | Gdzie i jak to obejrzeć                                                                                                                                                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows | Menedżer poświadczeń: Panel sterowania → Konta użytkowników → Menedżer poświadczeń → Poświadczenia systemu Windows. Windows szyfruje wpisy Twoim kontem; programy uruchomione jako Ty mogą o nie poprosić, inni użytkownicy nie. |
| Linux   | Pęk kluczy pulpitu, przez Secret Service: GNOME Keyring (aplikacja „Hasła i klucze”) albo KWallet (KWalletManager). Zaszyfrowany Twoim hasłem logowania, otwarty, dopóki jesteś zalogowany, czytelny dla programów Twojej sesji. |
| macOS   | Pęk kluczy (aplikacja „Dostęp do pęku kluczy”).                                                                                                                                                                                  |

„Wyloguj” na stronie Konta usuwa oba wpisy tego konta. Usunięcie ich ręcznie w
miejscach powyżej daje to samo; launcher poprosi wtedy o ponowne zalogowanie.
Strona prywatności w apce podaje, ile wpisów jest na tym komputerze.

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

Trzyma też **wyjście samej gry** — i to jest ta część, na którą trzeba uważać:
mod może wypisać tam cokolwiek. Launcher usuwa token sesji z każdej linii, zanim
trafi ona do logu albo do konsoli na żywo — token tego uruchomienia i wszystko,
co ma jego kształt — a jego własna linia „Launching:” w ogóle do tokenu nie
sięga. Nazwa gracza, UUID i ścieżki plików zostają, bo log jest Twój do
czytania.

**Zatem: przeczytaj `logs/main.log`, zanim go komuś wyślesz.** Opisane niżej
raporty z awarii istnieją po to, żebyś nie musiał — zapisywane są już bez tych
szczegółów.

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

| Host                                                     | Kiedy                                                                                                 | Co jest wysyłane                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.modrinth.com`, `cdn.modrinth.com`                   | Przeglądanie lub instalowanie modów, shaderów, paczek zasobów i modpacków                             | **Twoje frazy wyszukiwania i filtry.** Regulamin API Modrinth wymaga identyfikującego się User-Agenta, więc żądania niosą `whiteravens20/raven-forge/<wersja> (<adres repo>)` — nazwę i wersję launchera, nie Ciebie.                                                                                                                                                                        |
| `api.modrinth.com`                                       | Sprawdzanie aktualizacji zainstalowanych modów, eksport profilu jako paczki albo dodanie moda z pliku | **Skrót SHA-512 każdego pliku moda w tym profilu — a przy dodawaniu pliku: tego jednego pliku.** Tak właśnie pyta się Modrinth, czym jest dany plik i co go zastąpiło — i tylko dzięki temu da się rozpoznać jar dodany samodzielnie. Skrót nazywa plik, nie Ciebie, ale ich zestaw opisuje, jakie mody ma ten profil, więc idzie wyłącznie po naciśnięciu jednego z tych trzech przycisków. |
| `api.modrinth.com`                                       | Otwarcie listy modów, shaderów albo paczek zasobów profilu                                            | **Identyfikatory Modrinth tych, które ten profil ma.** Tak pobierane są ich opisy i ikony; odpowiedź jest pamiętana przez tydzień, więc lista nie jest odpytywana za każdym razem. Identyfikatory mówią, jaką zawartość ma profil, a nie kim jesteś.                                                                                                                                         |
| Serwer, na którym leży ikona moda lub obrazek wiadomości | Przy ich wyświetlaniu                                                                                 | Żądanie idzie do tego serwera. Obrazki ładują się prosto stamtąd, gdzie projekt je opublikował.                                                                                                                                                                                                                                                                                              |

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
pokazywana po awarii proponuje jego otwarcie, a **Ustawienia → Dane** wymieniają
ten folder z przyciskiem, który otwiera go w dowolnym momencie.

Redakcja nie może wiedzieć, co mod postanowił wypisać w wyjściu gry, więc
przejrzyj raport, zanim dołączysz go do publicznego zgłoszenia.

---

## O czym decydujesz Ty

| Co                     | Gdzie i co to daje                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Logowanie              | **Ustawienia → Zachowanie → „Zawsze uruchamiaj offline”**: launcher nigdy nie łączy się z serwerami logowania Microsoftu, Xboxa i Mojang. Pliki gry i mody nadal są pobierane. Konto offline nie loguje się nigdzie.     |
| Wiadomości             | **Ustawienia → Źródła treści**: wyczyść oba adresy, a żaden kanał nie będzie pobierany; wpisz własne, a pytane będą tylko one.                                                                                           |
| Proxy                  | **Ustawienia → Sieć i pobieranie → Adres proxy**: każde połączenie launchera idzie przez nie. Gra, gdy już działa, łączy się sama i proxy launchera jej nie obejmuje.                                                    |
| Discord                | **Ustawienia → Zachowanie → „Pokazuj grę na statusie Discorda”**, domyślnie wyłączone.                                                                                                                                   |
| Paczki                 | Profil, który trzyma się paczki, pyta o nią adres z pola **Adres manifestu** — przy starcie launchera i przed każdym uruchomieniem gry. Usuń ten adres w edytorze profilu, a profil przestanie pytać i się aktualizować. |
| Zawartość z Modrinth   | Do Modrinth nie idzie nic, dopóki czegoś nie wyszukasz, nie otworzysz listy modów, shaderów albo paczek zasobów profilu, nie sprawdzisz aktualizacji, nie wyeksportujesz paczki ani nie dodasz moda z pliku.             |
| Aktualizacje launchera | Sprawdzane przy każdym starcie jednym zapytaniem do GitHuba. Tego na razie nie da się wyłączyć — patrz „Znane luki”.                                                                                                     |
| Logi i raporty         | Nie opuszczają komputera, dopóki sam ich komuś nie wyślesz. „Zgłoś błąd” otwiera stronę zgłoszeń w przeglądarce; plik dołączasz ręcznie.                                                                                 |
| Gdzie to wszystko leży | **Ustawienia → Dane → Przenieś…** przenosi folder danych tam, gdzie wskażesz.                                                                                                                                            |

---

## Usuwanie wszystkiego

- **Jedno konto:** „Wyloguj” na stronie Konta usuwa je z `auth.json` i kasuje
  jego wpisy w magazynie poświadczeń. Wylogowanie z konta Microsoft czyści też
  ciasteczka okna logowania, więc następne logowanie zaczyna się od pustej
  strony, a nie od rozpoznania Ciebie.
- **Wszystkie dane launchera:** zamknij launcher i usuń wymienione wyżej folder
  danych i folder launchera. Poza nimi nie zostaje nic oprócz wpisów w magazynie
  poświadczeń, które znikają, jeśli najpierw się wylogujesz, i pobranej
  aktualizacji, jeśli jakaś czeka.
- **Odinstalowanie:** usunięcie launchera i usunięcie danych to dwie osobne
  rzeczy. Na Windows deinstalator pyta, co zrobić, i podaje folder, w którym dane
  naprawdę są; na Linuksie pakiet w ogóle nie rusza katalogu domowego. Opisuje to
  [UNINSTALL.md](UNINSTALL.md).
- **Po naszej stronie:** nie ma czego usuwać. Nie mamy niczego.

---

## Znane luki

Wymienione celowo. Uczciwa lista jest lepsza niż taka, która ładnie wygląda.

- **Sprawdzania aktualizacji przy starcie nie da się wyłączyć** z Ustawień. To
  jedno żądanie do GitHub Releases przy każdym uruchomieniu. Przy zablokowanej
  sieci po prostu cicho zawodzi.
- **Pliki logów są redagowane tylko częściowo.** Token sesji jest usuwany; nazwa
  gracza, UUID i ścieżki plików nie. Raporty z awarii mają usunięte wszystkie te
  rzeczy. Patrz „Co trafia do logu”.
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
