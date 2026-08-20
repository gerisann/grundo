# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja, nem a történetet — minden menet végén
felülíródik, nem bővül. A történet a git logban van.

**Következő menet neve: GRUNDO #6.** (A számozás a BESZÉLGETÉSEKÉ, nem a
munkameneteké: azt kell nézni, hány chat van. Lásd [AGENTS.md → 7. A
beszélgetések neve](AGENTS.md).)

## ÁLLAPOT

Repo: `C:\Users\Geri\Documents\GitHub\grundo`, ág: `main`. A pontos HEAD-et
`git log -1`-gyel nézd meg. Ez a menet négy commitban ment fel
(`46a6cc8`…`e6b0382`).

Tesztek, most mérve: gyökérből `npm test` → **333 teszt zöld** (24 fájl, 8
emulátoros kihagyva). Emulátoros (`npm.cmd run test:emulator`) → **8 fájl,
100 teszt zöld**. Typecheck (gyökér ÉS `server/`) és mindkét production
build hibamentes.

**Új ebben a menetben: helyi Firestore-emulátoros fejlesztői környezet.**
Innentől a felületek valódi bejelentkezéssel, kármentesen tesztelhetők, nem
csak méréssel — ez a menet nagy része élő böngészőben lett kipróbálva, nem
csak kódolvasással. Lásd „Fejlesztői előnézet" alul.

## ⚠️ ELSŐ OLVASATRA: MIT KELL TELEPÍTENI ÉS FUTTATNI

1. **frontend + backend** telepítés kell.
2. **szabalyok** telepítés is kell (a `firestore.rules` egy korábbi menetben
   változott: az értesítés törölhető, a tiltás írása szerveroldalra került,
   van egy `blockedBy` alkollekció).
3. **Egyszeri migráció**, a szabályok után — ha még nem futott le egy korábbi
   menet óta: a régi tiltásokhoz meg kell írni a `blockedBy` tükröt. Cloud
   Shellben:

   `cd ~/grundo/server && git pull && npm run backfill:blocked-by -- --apply --allow-production`

   (`--apply` nélkül csak jelentést ír. Amíg nem futott le, a RÉGI
   tiltásoknál a „ki tiltott engem" irány nem szűr a feedben — az újaknál
   igen, mert a szerver már mindkettőt írja.)
4. Indexek NEM kellenek.
5. **Az `OPENWEATHER_API_KEY` titok törölhető** a Secret Managerből, ha
   véglegesen nem kell — a widget az Open-Meteo-ra váltott, kulcs nélkül.

## EBBEN A MENETBEN ELKÉSZÜLT

Geri egy nagy kérés-listát adott át, két körben (időjárás-finomítás előbb,
utána egy második kör hat ponttal). **Mindegyik elkészült és élőben
ellenőrizve**, a helyi emulátoron, valódi bejelentkezéssel.

### 1. Időjárás-widget — egybefüggő, kibontható panel

`WeatherWidget.tsx` + `weatherWidget.css` átdolgozva.

- **Egy panel nő meg**, nem külön doboz nyílik a pill mellett: a bal szélen
  egy nyílhegy (`ChevronIcon`) jelzi, hogy kinyitható, és koppintásra a
  MEGLÉVŐ pill szélesedik ki balra.
- **A hőmérséklet és az égkép NEM ismétlődik meg** a kibontott sávban — az
  ott van a panel jobb szélén. Csak három ÚJ adat jön elő: csapadék esélye,
  páratartalom, szél.
- **Az ikonok 20%-kal nagyobbak** (26 px a 22 px-es alaphoz képest), és
  **színkódoltak**: csapadék vízkék (`--weather-precip`), páratartalom
  napsárga (`--weather-sun`), szél türkizzöld (új token: `--weather-wind`).
  Élőben mérve: `rgb(96,165,250)` / `rgb(251,191,36)` / `rgb(45,212,191)`.
- **Nyitva a „Szia, <név>" felirat eltűnik** (`home.css`, `:has()`
  szelektorral) — a sáv úgyis eltakarná, a hely inkább neki jusson.
- ⚠️ **Több körben mért és javított vízszintes-túlcsordulási hiba**: a
  képernyőolvasónak szánt, abszolút pozíciójú címkék a panel saját
  klippelését kell hogy kapják (nem a lap gyökeréét), és a rácsos szülőknek
  (`.home__hero`, `.home__greet-row`) `min-width: 0` kell, különben egy
  széles gyerek kitolja a dobozt a képernyőn túlra. Élőben mérve 360 és 390
  px-es nézetben is: `document.documentElement.scrollWidth === viewport`.

### 2. Tiltott felhasználók — új képernyő

Geri talált egy zsákutcát: a letiltott felhasználó eltűnik mindenhonnan
(feed, keresés, profil), tehát nem volt mód rá, hogy valaki UTÓLAG feloldja
a tiltást — nem volt felület, ahonnan a `blocks` alkollekció egyáltalán
elérhető lett volna.

- Új végpont: `GET /api/users/me/blocked` (`server/src/routes/users.ts`) —
  `/me/` előtaggal, hogy ne ütközzön az `/:username` mintával, és mert ez
  eleve nem publikus adat (más felhasználó tiltás-listáját nem lehet lekérni).
- Új képernyő: `src/screens/settings/BlockedUsersScreen.tsx`
  (`/beallitasok/tiltottak`) — profilkép, név, „Feloldás" gomb soronként. A
  névre/képre koppintva a nyilvános profil nyílik.
- Bekötve a Beállítások menübe, „Tiltott felhasználók" néven.
- **Élőben végigvíve**: Peti letiltva → megjelent a listában → „Feloldás" →
  eltűnt, `Nincs letiltott felhasználód` üzenet jött.

### 3. Konzisztencia — profil-link mindenhol

Geri jelezte, hogy a profilkép/név nem mindenhol kattintható, holott ez volt
a minta (feed-kártya, követő-lista). Két helyen pótolva:

- **Hozzászólások** (`CommentSheet.tsx`): a profilkép ÉS a név is önálló
  gomb lett, ami bezárja a lapot és a nyilvános profilra navigál — ugyanaz a
  minta, mint a `ConnectionsSheet`-nél.
- **Ranglista** (`TerritoryScreen.tsx` → `Leaderboard`): eddig csak a név
  látszott, kép nélkül, és a sor nem volt kattintható. Most a sor GOMB
  (4 oszlopos rács: helyezés · kép · név · terület), és megjelenik a
  profilkép is (`LeaderboardEntry.photoURL` már eddig is jött a szerverről,
  csak nem volt kirajzolva). **Élőben ellenőrizve**: a ranglista-sorra
  kattintva `/felhasznalo/ZsofiWalks`-ra navigált, a fejléc a nevet mutatta.

### 4. Értesítés-lista — két javítás

- ⚠️ **Csak a jobbra húzás (törlés) működött, a balra húzás (olvasottá
  jelölés) nem.** Valódi hiba volt, nem félreértés: a `pointerup` kezelő a
  `dx` állapotot olvasta, ami egy gyors mozdulatnál (vagy egy automatizált
  ellenőrzésnél) még a RÉGI, nullás értéket tartalmazta — a React a
  `pointerup`-ig nem feltétlenül rajzolt újra. Javítás: a döntés egy
  szinkron reffel történik (`dxNow`), a megjelenítés marad state-alapú.
  Emellett a `setPointerCapture` hívás kivételt dobott bizonyos
  pointer-forrásoknál, és megszakította a húzást — most `try/catch`-csel
  védve. **Mindkét irány élőben tesztelve** az emulátoron: jobbra húzás
  törölt egy sort, balra húzás egy olvasatlant olvasottra állított
  (6 → 5 olvasatlan).
- **A kártya mögötti „rejtett" réteg elvesztette a saját hátterét.**
  Korábban egy `--surface-2` színű doboz állt az ikon mögött, ami húzás
  közben egy MÁSODIK kártyának nézett ki (Geri screenshotot is küldött róla).
  Most `background: transparent` — az ikon az alkalmazás alap hátterén
  (`--bg-primary`, a `.npanel` gyökér színe) lebeg. Élőben mérve:
  `getComputedStyle(...).backgroundColor === "rgba(0, 0, 0, 0)"`.

## FEJLESZTŐI ELŐNÉZET — helyi emulátor (ÚJ ebben a menetben)

Mostantól a felületek **valódi bejelentkezéssel, kármentesen** tesztelhetők,
nem csak statikus CSS-méréssel. Három új darab:

- `.env.emulator` (repo gyökér) — kulcs nélküli, `demo-` előtagú Firebase
  konfiguráció. A `demo-` előtag miatt a Firebase eszközei SOHA nem érnek
  hozzá az éles projekthez.
- `npm run dev:emulator` (repo gyökér) — Vite dev szerver emulátoros módban
  (`.claude/launch.json`-ban is felvéve, `grundo-emulator` néven).
- `server/npm run dev:emulator` — a backend az emulátorhoz kötve (Firestore
  8081, Auth 9099), `server/npm run seed:emulator` pedig egy bejelentkezhető
  teszt-fiókot (`geri@grundo.local` / `grundo-emulator`) tölt fel négy másik
  felhasználóval, követésekkel mindkét irányban és 25 értesítéssel (a
  lapozás kipróbálásához).
- Böngészőből: `await __grundoDevSignIn()` — csak emulátoros build
  tartalmazza, éles buildből kiesik (a `VITE_USE_EMULATORS` feltétel ott
  hamis, a kód a csomagolóból is kimarad).

**Amit ez a menet NEM tudott ezzel kipróbálni**: nincs seedelt aktivitás
(a `src/game` motor bonyolult geometriai adatot várna), ezért a
hozzászólás-lap éles kattintását nem sikerült böngészőben megnézni — a
kódot a feed-kártyával és a `ConnectionsSheet`-tel azonos, bevált mintára
írtam, és típusellenőrzéssel/build-del igazoltam.

## ÉLESBEN FUT

- **Napi forduló**, **admin felület**, **futásidejű konfiguráció**
  (`appConfig/gameplay` v1, „Gazdagrét Rush" akció — ellenőrizd, nem járt-e
  le), **jelvény-katalógus** — mind változatlan egy korábbi menet óta.

## TELEPÍTETLEN

Több menet munkája együtt vár: a korábbi (#4–#7 régi számozás) ÉS ez a menet.
Frontend + backend + szabályok, plusz a `blockedBy` migráció (lásd fent),
ha még nem futott le.

## KÖVETKEZŐ: 6. MENET

- **Aktív akciók a térképen** — ez korábbról áthúzódó tétel, még mindig nem
  készült el. A modifier `areaCells` mezője (`src/game/modifiers.ts`)
  H3-cellalista `MODIFIER_AREA_RES` felbontáson — ebből rajzolható
  határvonal a Grund-térképen. ⚠️ Csak `scope: 'area'` modifierekre van
  geometria; a most futó globális akciónak NINCS térképi kiterjedése.
- **A push-küldés és a `NotificationPanel` élő ellenőrzése** telepítés után,
  valódi eszközön.
- Geri korábbi 7 pontos jelvény/profil-listájából: **keresés** és
  **rivális rendszer**.

## NYITOTT, KISEBB

- **A követő-lista nem lapoz** — legfeljebb 100 megy ki, `hasMore` jelzéssel.
- **A harang olvasatlan-száma a betöltött ablakból számol** (20 elem).
- A `modifier_started` broadcast szűrés nélkül megy mindenkihez.
- **Az időjárás csak akkor jelenik meg magától, ha van tárolt pozíció.**
- **gpLedger-takarítás** — előkészítve, futtatásra vár
  (`server/src/scripts/cleanGpLedgerJunk.ts`).
- **A követési KÉRÉSEK elbírálására még nincs felület.**
- Területi hatókörű hold-modifier nem hat: a `zones` kollekció még nincs meg.

## Fejlesztői előnézet — hogyan látunk éles adatot a böngészőben

**Írás nélküli, csak-olvasó ellenőrzéshez** (éles adaton, nem-író
képernyőkhöz):

1. `.claude/launch.json` a `G:\Saját meghajtó\WORK\CLAUDE` gyökérben —
   `grundo-dev` (éles API) vagy `grundo-emulator` (helyi emulátor) konfig.
2. Éles, csak-olvasó szerver: `server/`-ből
   `GOOGLE_CLOUD_PROJECT=grundo PORT=8080 npx tsx watch server.ts`.
3. `grundo/.env.local`-ban `VITE_API_BASE_URL=http://localhost:8080`.

**ÍRÓ funkcióhoz a helyi emulátor** — lásd fent, „Fejlesztői előnézet —
helyi emulátor". Rövid összefoglaló:

1. `export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot/bin:$PATH"`
   (Git Bash-ben ez mindig kell, a Java PATH-ja nélküle nem látszik).
2. `firebase.cmd emulators:start --only auth,firestore --project demo-grundo`.
3. `server/`-ből `npm run seed:emulator`, majd `npm run dev:emulator`.
4. Gyökérből `npm run dev:emulator` (vagy a `grundo-emulator` launch-konfig).
5. Böngészőben: `await __grundoDevSignIn()`.

⚠️ **Port-ütközés**: az `npm run test:emulator` saját `firebase
emulators:exec`-et indít — ha közben kézzel is fut egy emulátor-példány
(fenti 2. lépés), a portok ütköznek. Előbb állítsd le a kézit
(`Get-NetTCPConnection -LocalPort 8081,9099 | Stop-Process`), utána fusson a
teszt-parancs.

## Infrastruktúra: éles, csak olvasó Firestore-hozzáférés

Változatlan. `grundo-reader@grundo.iam.gserviceaccount.com`
(`roles/datastore.viewer`), Geri (`gergely.marthon@gmail.com`) személyesíti
meg. Nincs kulcsfájl. PowerShellben `gcloud.cmd`, nem `gcloud`.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Opus, emelt mélységgel**, ha a **térkép-vizualizációval** folytatjuk: a
`scope: 'area'` vs `'global'` megkülönböztetés és az új GeoJSON-réteg a
meglévő Mapbox-rétegek közé valódi tervezési döntés. **Sonnet** elég, ha a
telepítés utáni élő ellenőrzésekkel (push, feliratkozás) vagy a keresés
felülettel kezdünk — ott a minta már megvan, és most már emulátoron is
tesztelhető, nem csak méréssel.
