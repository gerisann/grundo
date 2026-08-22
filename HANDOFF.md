# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja, nem a történetet — minden menet végén
felülíródik, nem bővül. A történet a git logban van.

**Következő menet neve: GRUNDO #7.** (A számozás a BESZÉLGETÉSEKÉ, nem a
munkameneteké: azt kell nézni, hány chat van. Lásd [AGENTS.md → 7. A
beszélgetések neve](AGENTS.md).)

## ÁLLAPOT

Repo: `C:\Users\Geri\Documents\GitHub\grundo`, ág: `main`. HEAD: `e21a49c`.
Ez a menet HAT commitban ment fel `a8018ed` fölé:

1. `d244d94` — Geri hat kérése közül öt (mentés-átirányítás, időjárás-térköz,
   flat értesítés-ikonok, ranglista-szűrés v1, pódium)
2. `326ed8c` — az öt pontra Geri két hibát jelzett, javítva (ranglista üres
   volt, időjárás-térköz rossz helyen)
3. `caee5db` — napló
4. `3678c56` — Geri harmadik visszajelzése: a ranglista MÉGSEM mutatta a
   nulla területűeket → új, egyszerűbb megoldás (lásd lent)
5. `2a8b37e` — napi/heti/havi ranglista-bontás (Geri 6. pontja)
6. `e21a49c` — felhasználónév-keresés (a „NYITOTT, KISEBB" listáról, Geri
   kérésére: „jöhet a kereső")

Tesztek, most mérve: gyökérből `npm test` → **333 zöld**. `npm run
test:emulator` → **100 zöld**. Typecheck (gyökér ÉS `server/`) hibamentes.
Élőben ellenőrizve a helyi emulátoron: pódium, értesítés-ikonok, időjárás-
térköz, ranglista mind a négy nézetben, keresés (prefix-találat, nincs
találat, törlés, profilra navigálás).

**Amit ez a menet NEM tudott élőben kipróbálni**: az aktivitás-mentés utáni
átirányítást (1. pont), mert ahhoz egy valódi, lezárt aktivitás kell — az
emulátoron nincs seedelt GPS-nyomvonal. A kódot a szerkesztő-módban már
bevált `onSaved` mintára írtam, típusellenőrzéssel igazolva.

## ⚠️ ÉLESBEN MÁR MEGTÖRTÉNT EBBEN A MENETBEN

Geri a menet KÖZBEN telepített és futtatott migrációt — ez nem a következő
menet teendője, hanem MÁR MEGVAN:

- **frontend + backend telepítve** (`d244d94`…`2a8b37e` állapotában — az
  `e21a49c`, a keresés, MÉG NINCS kint, lásd lent).
- **A 8 ranglista-index deployolva és READY** (`firebase deploy --only
  firestore:indexes`) — élőben ellenőriztem `gcloud firestore indexes
  composite list`-tel, végigvárva, amíg mind a nyolc `CREATING`-ből
  `READY`-be lépett.
- **Mindkét migráció lefutott** (`backfill:blocked-by`,
  `backfill:area-windows`) — mindkettő „0 hiányzó”-t jelentett, mert az éles
  `grundo` projektben jelenleg **csak 4 felhasználó** van, és mindegyik friss.

## ⚠️ MOST TELEPÍTENDŐ: A KERESÉS (`e21a49c`)

1. **frontend + backend** — új route (`/kereses`) és új végpont
   (`GET /api/users/search`).
2. Szabályok NEM kellenek.
3. Migráció NEM kell.
4. Index NEM kell — a keresés egyetlen mezőn (`usernameLower`) tartományos
   lekérdezés, azt a Firestore magától indexeli.

## EBBEN A MENETBEN ELKÉSZÜLT

### 1. Aktivitás-mentés — ragadt képernyő javítva

`TrackingScreen.tsx`: a feltöltés utáni névadó/leíró űrlap (`SaveActivityForm`)
eddig nem kapott `onSaved` callback-et ezen a képernyőn (szerkesztéskor, az
`ActivityScreen`-en már régóta megvolt). Mentés után most bezárja magát és a
frissen mentett aktivitás részletképernyőjére navigál.

### 2. Időjárás-widget — méret és térköz finomítás

`WeatherWidget.tsx` + `weatherWidget.css`: a kibontott sáv mérőszám-ikonjai
26→**20 px**. A mérőszámok közti térköz +5 px (4→9 px). A hőmérséklet és a
modul jobb szegélye közti térköz +5 px — ez elsőre rossz helyre került
(a mérőszám-csoport és a hőmérséklet közé), Geri jelezte, javítva:
`margin-right: 5px` a `.weather__temp`-en, ez mindig érvényesül.

### 3. Értesítés-ikonok — emoji helyett flat SVG

`notificationTypes.ts`-ből kikerült az emoji-lista, átköltözött
`NotificationPanel.tsx`-be flat, egyszínű SVG-ként. Kilenc típus, kilenc
forma, a színük a **meglévő tokenkészletből** jön (nincs új CSS-változó):
`--danger`, `--success`, `--weather-sun`, `--tier-gold`, `--player-4`,
`--info`, `--accent`, `--weather-wind` — `notificationPanel.css` →
`.nrow__icon--*`.

### 4. Ranglista — mindenki rajta van, ábécésorrendben az egyenlők

⚠️ **Ez a pont HÁROMSZOR változott** ebben a menetben — csak a VÉGSŐ állapot
számít, az van élesben:

1. Első próbálkozás: `hasOwnedArea` jelző, ami megkülönbözteti a soha nem
   birtoklót attól, akitől mindent elvettek. **Élesben üres listát adott
   volna** — a jelző új mező, a régi felhasználóknál nincs kitöltve, a
   Firestore `orderBy` pedig kihagyja azt a dokumentumot, amin a rendező
   mező egyáltalán nem létezik.
2. Javítás: OR-feltétel (`hasOwnedArea || areaM2 > 0`) — működött, de Geri
   ekkor jelezte, hogy a nulla területűeknek MINDIG látszaniuk kell, nem
   csak annak, aki valaha birtokolt valamit.
3. **Végleges megoldás**: a `hasOwnedArea` jelző teljesen kikerült
   (`activityCommit.ts`, `activityChunked.ts`, `seedEmulator.ts`). A
   `routes/tiles.ts` → GET /leaderboard két mező szerint rendez —
   `territoryM2.{layer}` csökkenő, `usernameLower` növekvő —, szűrés
   nélkül: mindenki rajta van, a nulla területűek is, az ábécésorrend
   dönt egyenlőségnél. Minden felhasználónál eleve létezik mindkét mező
   (regisztrációkor alapértéket kap), tehát senkit nem hagy ki a Firestore.
   Ehhez **összetett index kell** (`territoryM2.foot`/`.bike` +
   `usernameLower`, 2 bejegyzés) — ez már ÉLESBEN VAN, lásd fent.

### 5. Top 3 pódium grafika

Új `Podium` komponens a `TerritoryScreen.tsx`-ben, a ranglista teteje fölött.
Ezüst-arany-bronz sorrendben balról jobbra, korona csak az 1. helyen, a
sávok magassága a legjobbhoz viszonyított, arányos terület (min. 28 px, max.
88 px). **Szándékosan visszafogott szín** — Geri kérte, hogy ne legyen olyan
élénk, mint a csatolt referenciakép: a sávok a meglévő
`--tier-gold/silver/bronze` tokenekből kapnak halvány (`color-mix … 16%`)
tónust. `territory.css` → `.terr__podium*`.

### 6. Napi / heti / havi ranglista-bontás — Geri 6. pontja

Geri döntése (kérdésre válaszolva): **bruttó szerzés**, a `gpWeek`/
`gpMonth` mintájára — NEM a nettó változás. Ha valakitől időközben elvették
a frissen szerzett cellákat, a heti számából az még nem vész ki.

- **Három új mező** a felhasználó dokumentumon: `areaDay`/`areaWeek`/
  `areaMonth`, mindegyik `{foot, bike}` (`lib/user.ts`, alapérték `{0,0}`
  minden ÚJ regisztrációnál — `docs/05-adatmodell.md` is frissítve).
- **Növelés a claim-nél**: `activityCommit.ts` és `activityChunked.ts`
  mindhárom mezőt egyszerre növeli a szerzett cellák területével.
- **Nullázás a `dailyRollover.ts`-ben**: az `areaDay` MINDIG nullázódik egy
  `advance` fordulónál, az `areaWeek` csak `weekClosed`-nél, az `areaMonth`
  csak `monthClosed`-nél. A forduló itt CSAK nulláz, nem ír jóvá — a szerzés
  kizárólag a claim-nél történik.
- **`routes/tiles.ts` → GET /leaderboard**: új `window` paraméter
  (`day`/`week`/`month`/`alltime`). Ugyanaz a két-mezős rendezés, csak a
  mezőútvonal változik nézetenként (`WINDOW_FIELD` map).
- **Frontend**: `TerritoryScreen.tsx` → `Leaderboard` négy fület kapott a
  fejléc alatt (Napi/Heti/Havi/Mindenkori). Váltáskor a lista nullázódik,
  amíg az új adat be nem jön.
- **Migráció**: `backfillAreaWindows.ts` (`npm run backfill:area-windows`)
  — ugyanazért kellett, mint a 4. pontnál: a régi felhasználóknál a mező
  hiánya miatt a Firestore `orderBy` kihagyta volna őket. **Már lefutott
  élesben**, lásd fent.

### 7. Felhasználónév-keresés

A Home fejléc korábban inaktív Keresés gombja most él (`/kereses`).

- **`GET /api/users/search?q=…`** — prefix-illeszkedés a `usernameLower`
  mezőn (`startAt`/`endAt` tartományos lekérdezés, felső határ a keresett
  szöveg + U+F8FF). A saját magam és a letiltottak (mindkét irány:
  `blocks`/`blockedBy`) kiszűrve memóriában, a `feedScopes` mintájára.
  ⚠️ **A route regisztrálási sorrendje számít**: `/search` a `/:username`
  ELŐTT van, különben az Express a profil-lekérdezőt hívná meg
  `username: 'search'` értékkel.
- **`SearchScreen.tsx`**: 300 ms debounce, autofókusz, üres/betöltés/nincs
  találat állapotok, találatra koppintva a profilra navigál.
- Nem kell hozzá index (egymezős tartomány, a Firestore magától indexeli)
  és migráció sem.

## NYITOTT, KISEBB

- **A követő-lista nem lapoz** — legfeljebb 100 megy ki, `hasMore` jelzéssel.
- **A harang olvasatlan-száma a betöltött ablakból számol** (20 elem).
- A `modifier_started` broadcast szűrés nélkül megy mindenkihez.
- **Az időjárás csak akkor jelenik meg magától, ha van tárolt pozíció.**
- **gpLedger-takarítás** — előkészítve, futtatásra vár
  (`server/src/scripts/cleanGpLedgerJunk.ts`).
- **A követési KÉRÉSEK elbírálására még nincs felület.**
- Területi hatókörű hold-modifier nem hat: a `zones` kollekció még nincs meg.
- **Aktív akciók a térképen** — korábbról áthúzódó tétel, még mindig nem
  készült el (`src/game/modifiers.ts` → `areaCells`, csak `scope: 'area'`-nál
  van geometria).
- **A push-küldés és a `NotificationPanel` élő ellenőrzése** telepítés után,
  valódi eszközön.
- Geri korábbi 7 pontos jelvény/profil-listájából: **rivális rendszer**
  (a keresés ebben a menetben elkészült).
- **A keresés a Közösség → Felfedezés bővebb „emberek/klubok keresése"
  funkciótól KÜLÖNÁLLÓ** (`docs/01-kepernyoterkep.md` szerint két külön
  képernyő) — ha legközelebb az utóbbi kerül sorra, ez a mostani a Home
  fejléc egyszerű névkeresője marad, nem kell összevonni.

## ÉLESBEN FUT

- **Napi forduló**, **admin felület**, **futásidejű konfiguráció**
  (`appConfig/gameplay` v1, „Gazdagrét Rush" akció — ellenőrizd, nem járt-e
  le), **jelvény-katalógus** — mind változatlan egy korábbi menet óta.
- Ez a menet öt pontja (1–6.) + a hozzá tartozó index és migráció — lásd
  fent, „ÉLESBEN MÁR MEGTÖRTÉNT".

## TELEPÍTETLEN

Csak a 7. pont (keresés, `e21a49c`) — frontend + backend, lásd fent. Minden
korábbi menet és e menet 1–6. pontja már élesben fut.

## Fejlesztői előnézet — hogyan látunk éles adatot a böngészőben

**Írás nélküli, csak-olvasó ellenőrzéshez** (éles adaton, nem-író
képernyőkhöz):

1. `.claude/launch.json` a `G:\Saját meghajtó\WORK\CLAUDE` gyökérben —
   `grundo-dev` (éles API) vagy `grundo-emulator` (helyi emulátor) konfig.
2. Éles, csak-olvasó szerver: `server/`-ből
   `GOOGLE_CLOUD_PROJECT=grundo PORT=8080 npx tsx watch server.ts`.
3. `grundo/.env.local`-ban `VITE_API_BASE_URL=http://localhost:8080`.

**ÍRÓ funkcióhoz a helyi emulátor**:

1. `export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot/bin:$PATH"`
   (Git Bash-ben ez mindig kell, a Java PATH-ja nélküle nem látszik).
2. `firebase emulators:start --only auth,firestore --project demo-grundo`
   (Bash-ben `firebase`, `.cmd` nélkül — a globális npm-bin már a PATH-on van).
3. `server/`-ből `npm run seed:emulator`, majd `npm run dev:emulator`.
4. Gyökérből `npm run dev:emulator` (vagy a `grundo-emulator` launch-konfig).
5. Böngészőben: `await __grundoDevSignIn()`.

⚠️ **Port-ütközés**: az `npm run test:emulator` saját `firebase
emulators:exec`-et indít — ha közben kézzel is fut egy emulátor-példány,
a portok ütköznek. Előbb állítsd le a kézit
(`Get-NetTCPConnection -LocalPort 8081,9099 | Stop-Process`), utána fusson a
teszt-parancs.

⚠️ **Ebben a menetben a Browser pane screenshotja nem volt elérhető** — a
vizuális ellenőrzés `read_page`, `get_page_text` és `javascript_tool`
(számított stílusok, DOM-tartalom) kombinációjával ment.

## Infrastruktúra: éles, csak olvasó Firestore-hozzáférés

Változatlan. `grundo-reader@grundo.iam.gserviceaccount.com`
(`roles/datastore.viewer`), Geri (`gergely.marthon@gmail.com`) személyesíti
meg. Nincs kulcsfájl. PowerShellben `gcloud.cmd`, nem `gcloud`.

Ebben a menetben ezt a hozzáférést a Firestore-index build státuszának
ellenőrzésére is használtam (`gcloud firestore indexes composite list`) —
így derült ki élőben, hogy a ranglista üressége nem a migráció hiánya volt,
hanem az, hogy az indexek még `CREATING` állapotban voltak.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Sonnet, normál mélységgel** elég — nincs nyitott architektúra-döntés. Ha a
következő kör spec-ellentmondásba vagy adatmodell-döntésbe fut (pl. a
`zones` kollekció bevezetése a területi hold-modifierhez, vagy a Közösség →
Felfedezés bővebb keresés/klub-funkciója), ott érdemes megállni és Opusra
váltani.
