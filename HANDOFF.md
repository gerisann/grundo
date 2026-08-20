# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja, nem a történetet — minden menet végén
felülíródik, nem bővül. A történet a git logban van.

**Következő menet neve: GRUNDO #8.** (A számozási konvenció: [AGENTS.md → 7. A
beszélgetések neve](AGENTS.md).)

## ÁLLAPOT

Repo: `C:\Users\Geri\Documents\GitHub\grundo`, ág: `main`.
A pontos HEAD-et `git log -1`-gyel ellenőrizd — ez a fájl nem tartalmaz
commit-hash-t, mert az a frissítés pillanatában azonnal elavulna.

A #7 menet **jóval nagyobb volt a szokásosnál** — Geri kifejezetten kérte,
hogy próbáljam meg egyben. Két rész:

1. **Négy előzetes javítás**, amit Geri a fő kérés elé sorolt. Ebből
   **kettő elkészült** (Home statisztikapanel átalakítása, aktivitás-
   részletező profil-link), **egy részben** (komment-válasz — a
   funkció maga kész, csak a térkép-vizualizáció maradt ki belőle
   tévedésből az eredeti listán), **egy KIMARADT** (aktív akciók a
   térképen — lásd „NYITOTT, KISEBB").
2. **Teljes értesítési rendszer** — alkalmazáson belüli lista ÉS push
   (FCM), mind a 10 típussal bekötve. A KNOWS Community projektből
   (`C:\Users\Geri\Documents\GitHub\knows-community`) átvett architektúra
   (Express + firebase-admin, Cloud Functions nélkül), GRUNDO saját
   sémájára illesztve.

Tesztek, most mérve: a gyökérből `npm test` → **327 teszt zöld** (24 fájl, 8
emulátoros fájl kihagyva). Emulátoros: `npm.cmd run test:emulator` → **8 fájl,
97 teszt zöld** (+5 új a `notifications.emulator.test.ts`-ből). Typecheck
(gyökér ÉS `server/`) és mindkét production build hibamentes.

⚠️ **Egy méréssel talált hiba ebben a körben is**: `src/game/claim.test.ts`
egy tesztje a `stolenFrom`-ban kereste a védekező károsultat — ez a mező
korábban egy „0 értékű bejegyzés" trükkel jelezte ezt (lásd lent, „A védelem-
csökkenés most már valódi adat"), amit ez a menet kiváltott egy valódi
`breakthroughFrom` mezőre. A teszt frissült, a viselkedés NEM romlott —
ellenkezőleg, ez volt a lényeg.

## AMIT EBBEN A MENETBEN MÉRTEM, ÉS AMIT NEM SIKERÜLT

**Szerveroldalon alaposan mérve**, valódi Firestore-emulátoron:
- `createNotification` a KAPU-tulajdonságát 5 új emulátoros teszt bizonyítja:
  alapból BE van kapcsolva minden típus, egy kikapcsolt típusnál SEMMI nem
  íródik, a kapcsoló típusonként hat (nem globálisan), token nélküli
  felhasználónál a push csendben kimarad, és a függvény SOSE dob (egy hibás
  `uid` mellett is lefut, csak nem ír).
- Egy `evaluateAndAwardBadges`-hez hasonló próbafuttatással: `commitActivity`
  most már visszaadja a `stolenFrom`/`breakthroughFrom` térképet, ebből a
  route ténylegesen ki tudja küldeni a `territory_stolen`/`territory_defended`
  értesítést — ezt a teljes emulátoros aktivitás-készlet (18 teszt) zölden
  futtatva ellenőriztem, a meglévő pontos GP-összegeket ellenőrző tesztek nem
  romlottak.

**Amit NEM sikerült böngészőben, élő adaton igazolnom**: a
`NotificationPanel` `onSnapshot`-feliratkozását. A szerkezetet (fejléc, üres
állapot, „Mind olvasott" gomb) böngészőben megnéztem és jó — DE a
feliratkozás magát, valódi Firestore-adattal, nem sikerült végigvinnem: a
teszt-környezetben a kliens Firestore-kapcsolat makacsul az ÉLES projektre
ugrott vissza az emulátor helyett (az Auth-emulátor viszont helyesen működött
— ebből tudom, hogy a kapcsolási minta önmagában jó, csak ennek a
munkamenetnek a rögtönzött tesztfelállása nem tudta stabilan tartani mindkét
emulátor-kapcsolatot egyszerre). **Ezt Geri nézze meg élesben, telepítés
után** — ha a harangon nem jelenik meg a piros pötty valódi értesítésnél, ez
az első hely, ahol keresni kell.

A **push-küldés VÉGIG-VITELE** (valódi eszközön megjelenő rendszerértesítés)
szintén nincs élesben kipróbálva — ahhoz telepített frontend és egy valódi
böngésző-engedélykérés kell, amit ez a környezet nem tud kiváltani.

## ÉLESBEN FUT

- **Napi forduló**: legutóbb mérve 2026-08-20-án — rendben megy.
- **Admin felület**: `/admin` — játékszabály-szerkesztő, akciók, aktivitás-
  audit, visszajátszó.
- **Futásidejű konfiguráció**: `appConfig/gameplay` a v1-en áll. Fut egy aktív
  akció: „Gazdagrét Rush", globális 2×-es GP-szorzó — ellenőrizd, hátha
  időközben lejárt.
- **Jelvény-katalógus**: feltöltve Firestore-ba (`seed:badges` lefutott
  2026-08-20-án, 45 dokumentum).

## TELEPÍTETLEN

Négy menet munkája vár telepítésre — a #4, #5, #6 és #7 együtt (a korábbiak
részletei a git történetben). Ami ÚJ ebben a körben:

- **A teljes értesítési rendszer.** Kell hozzá **frontend + backend**.
  Adatbázis-lépés (index) NEM kell — a `notifications`/`devices` séma a
  meglévő szabályokkal és egyenlőség-szűrővel működik.
- ⚠️ **A backend telepítése ELŐTT be kell állítani a Firebase Admin
  Messaging jogosultságot.** A `firebase-admin/messaging` a meglévő
  szolgáltatásfiók hitelesítésével megy (nincs külön titok, mint az
  OpenWeather-kulcsnál) — DE a Cloud Run szolgáltatásfióknak
  `roles/firebasecloudmessaging.admin` (vagy tágabb) szerepkör kell hozzá,
  különben a push-küldés csendben elhasal (a `createNotification` úgyis
  elnyeli a hibát, tehát az alkalmazáson belüli lista működni fog akkor is,
  ha ez kimarad — csak a push nem megy).
- A frontend `.env.local`-jába (Cloud Shell) fel kell venni:
  `VITE_FIREBASE_VAPID_KEY=BIMRvwkmQxpciXnk-3s5x_HqtKX5j8K7hDiQNhC3vV_shO_Kislr3iE4cDZ59Ih2wJLaA_0LK5YzbMAbiYEORL8`
  (ugyanez most már a `.env.example`-ben is szerepel).

## AMI A #7 MENETBEN ELKÉSZÜLT

### Home statisztikapanel — három sor

`src/screens/HomeScreen.tsx` + `home.css`. Mindhárom doboz (GRUND, AKTIVITÁS,
SOROZAT) most három sort mutat: felül a címke, középen a KIEMELT érték
(20%-kal nagyobb betűvel, `calc(14px * 1.2)`), alul a mértékegység vagy —
csak a GRUND-nál — egy másik adat (mezőszám). Új segédfüggvény:
`formatNumber()` (`src/lib/format.ts`) a mértékegység nélküli számhoz.

### Aktivitás-részletező — kattintható profil

`src/screens/ActivityScreen.tsx`. A szerző fejléce (kép + név) most
`/felhasznalo/:username`-re visz, ugyanazzal a mintával, mint a feed-
kártyáknál (#5 menet): külön gomb, nem beágyazva a nyitógombba.

### Komment-válasz

**Séma**: a komment dokumentum kapott egy opcionális `replyToId` /
`replyToUserId` / `replyToUsername` mezőt (denormalizálva, hogy a lista
lekérdezés ne kérjen külön olvasást válaszonként).
**Szerver**: `POST /api/activities/:id/comments` elfogad `replyToId`-t,
feloldja a célszemélyt, és KÉT külön értesítést küldhet (aktivitás-szerző +
válasz-címzett — lásd `notifyCommentPosted` a `server/src/lib/
notifications.ts`-ben).
**Kliens**: `CommentSheet.tsx` — „Válasz" gomb minden sor alatt, „Válasz — X"
chip a beviteli mező fölött, válasz-jelzés a válasz-sorban.

⚠️ **A térkép-vizualizáció (aktív akciók) NEM készült el** — ez Geri eredeti
négy pontjából az egyetlen, ami teljesen kimaradt. Lásd „NYITOTT, KISEBB".

### Értesítési rendszer

**A minta forrása**: KNOWS Community (`fcmService.ts`, `notificationService.ts`,
`server/src/routes/notifications.ts`) — egy Explore-ügynökkel átnézve. A
LÉNYEG, amit átvettünk: Cloud Functions NÉLKÜL, plain Express + firebase-admin,
`sendEachForMulticast` a küldéshez, invalid token takarítás a válaszból. A
SÉMA viszont GRUNDO SAJÁTJA maradt (a docs/05 már korábban kijelölte):
`notifications/{uid}/items/{id}` (nem KNOWS flat `notifications` kollekciója),
`devices/{uid}/tokens/{token}` (nem hash-elt doc-id), kapcsolók a
`users/{uid}/private/settings.notifications` mezőn (nem egy külön flat mező a
felhasználó dokumentumon).

**A legfontosabb architekturális döntés**: MINDEN értesítés EGY kapun megy át
(`createNotification`, `server/src/lib/notifications.ts`) — ez szándékos
válasz egy KNOWS Community-ban megfigyelt hibamintára, ahol az alkalmazáson
belüli írás és a push-küldés KÜLÖN helyen nézte (vagy nem nézte) a
felhasználó kapcsolóit, és a `send-push-bulk` végpont csak EGYETLEN
kategóriát ellenőrzött szerveroldalon a többi közül. Itt ez nem fordulhat
elő: egyetlen függvény dönt, mindkét csatornáról.

**10 típus, mind bekötve** (Geri 9 pontjából 10 lett — a „GP-vel kapcsolatos"
kettéválik aktivitás-utáni ÉS napi összegzésre, a spec `docs/02` táblázata is
külön sorban tartja őket):

| Típus | Kiváltó hely |
|---|---|
| `gp_activity` | aktivitás-mentés után (grund-növekmény + GP) |
| `gp_daily` | napi forduló (tartás-bónusz) |
| `activity_liked` | kedvelés |
| `activity_commented` | hozzászólás |
| `comment_replied` | válasz egy hozzászólásra |
| `badge_awarded` | jelvény-kiosztás (a #6 menet visszaadott listájából) |
| `followed_activity` | követő-fanout aktivitás-mentéskor (max 300 követő) |
| `territory_stolen` | sikeres lopás — a károsultnak |
| `territory_defended` | sikertelen áttörés — a védekezőnek (ÚJ adat, lásd lent) |
| `modifier_started` | globális akció élesedik (óránként ellenőrizve) |

**A védelem-csökkenés MOST MÁR VALÓDI ADAT.** A `src/game/claim.ts` régóta
tartalmazott egy megjegyzést („a károsult értesül") egy 0-értékű
`stolenFrom`-bejegyzés mellett — ez elő volt készítve, de sosem lett kész: a
lopás és a védekezés-áttörés UGYANABBA a mezőbe írt, megkülönböztethetetlenül.
Ez a menet szétválasztotta: új `breakthroughFrom: Record<string, number>`
mező a `ClaimResult`-on, végigvezetve `resolveClaim`, `mergeClaims`,
`absorbIsolatedRivalCells`, `activityCommit.ts` és `activityChunked.ts`-en.
Innentől a `territory_defended` értesítés (docs/02 → „Megvédted a
területed") valódi, felhasználónkénti adatból megy, nem kitalálásból.

⚠️ **A globális akció-értesítés (`modifier_started`) NINCS emulátoros
teszttel lefedve** — a `dailyRollover.emulator.test.ts` nem hoz létre
modifier-dokumentumot, tehát ez a kód-ág a teljes futás alatt sosem futott le
ténylegesen az emulátoron. Típusellenőrizve van, és a logika egyszerű
(lekérdezés + jelzés + broadcast), de EZ AZ EGYETLEN új értesítés-trigger,
amit nem mértem meg valódi adaton.

**Push-infrastruktúra**:
- `public/firebase-messaging-sw.js` — a Firebase-konfiguráció itt SZÁNDÉKOSAN
  be van égetve (a service worker a Vite modulrendszerén kívül fut, nincs
  build-idejű változó-behelyettesítés — de egyik érték sem titok, lásd a
  fájl fejlécét).
- `src/lib/push.ts` — engedélykérés, token-mentés KÖZVETLENÜL a klienstől
  Firestore-ba (`devices/{uid}/tokens/{token}`, a `firestore.rules` ezt már
  korábban is engedte), passzív token-frissítés app-indításkor
  (`initIfAlreadyGranted`, csak akkor csinál bármit, ha az engedély MÁR
  megvan — nem kér engedélyt magától).
- `server/src/lib/notifications.ts` → `sendPush` — `sendEachForMulticast`,
  500-as kötegben, érvénytelen token törlésével.

**Kliens felület**: `NotificationPanel.tsx` (alulról felcsúszó lap, a
`CommentSheet` mintájára), `useNotifications.ts` (élő `onSnapshot`-
feliratkozás), a Home fejléc harang-ikonja mostantól aktív, olvasatlan
pöttyel. Beállítások: `src/screens/settings/NotificationsScreen.tsx` —
típusonkénti kapcsoló + egy push-mesterkapcsoló, mind közvetlen Firestore-
írással (`users/{uid}/private/settings`).

## KÖVETKEZŐ: 8. MENET

- **Aktív akciók a térképen** (Geri eredeti 4 pontjából az egyetlen, ami
  kimaradt). A modifier `areaCells` mezője (`src/game/modifiers.ts`) H3-
  cellalista `MODIFIER_AREA_RES` felbontáson — ebből rajzolható határvonal a
  Grund-térképen (`MapView.tsx`/`HexMap.tsx`, GeoJSON-forrás/réteg
  hozzáadásával, a meglévő cella-réteg mintájára). ⚠️ **Csak `scope: 'area'`
  modifierekre van geometria** — egy globális akciónak (mint a most futó
  „Gazdagrét Rush") NINCS térképi kiterjedése, azt kitalálni hazugság lenne.
  Jelmagyarázat-sor is kell hozzá.
- **A push-küldés élő ellenőrzése.** Telepítés után egy valódi böngészőben
  be kell kapcsolni az Értesítések → push kapcsolót, és megnézni, jön-e
  tényleges rendszerértesítés.
- **A `NotificationPanel` élő feliratkozásának böngészős ellenőrzése** —
  lásd fent, ez a menet nem tudta végigvinni.
- Geri 7 pontos jelvény/profil-listája (korábbi menetek) továbbra is:
  keresés (5.) és rivális rendszer (7.) vannak hátra onnan.

## NYITOTT, KISEBB

- **A `modifier_started` broadcast MINDEN felhasználóhoz megy**, lekérdezés-
  szűrés nélkül. GRUNDO jelenlegi méreténél elhanyagolható; ha a
  felhasználószám megnő, ez a lépés (`dailyRollover.ts` →
  `notifyStartedModifiersIfDue`) újragondolandó.
- **A jelvény-jutalom GP nem frissíti azonnal a `level` mezőt** — változatlan
  a #6 menet óta, lásd az ottani megjegyzést `server/src/lib/badges.ts`-ben.
- **A `badges` Firestore-katalógus** fel van töltve (lásd „ÉLESBEN FUT").
- **Az időjárás csak akkor jelenik meg magától, ha van tárolt pozíció.**
  Változatlan a #5 menet óta.
- **Hőmérséklet-egység: csak °C.**
- **gpLedger-takarítás — elő van készítve, futtatásra vár.**
  `server/src/scripts/cleanGpLedgerJunk.ts`. Legutóbb mérve (2026-08-20): 12
  sor törlésre vár.
- **A követési KÉRÉSEK elbírálására még nincs felület.**
- **A tiltottak listája sincs sehol.**
- Területi hatókörű hold-modifier nem hat: a `zones` kollekció még nincs
  megírva.
- `gpWeek`/`gpMonth` ablakzárás él, de éles adaton még nem láttuk működni.

## Fejlesztői előnézet — hogyan látunk éles adatot a böngészőben

**Írás nélküli, csak-olvasó ellenőrzéshez** (éles adaton, nem-író
képernyőkhöz):

1. `.claude/launch.json` a `G:\Saját meghajtó\WORK\CLAUDE` gyökérben — Vite
   dev szerver, port 5173.
2. Szerver, csak-olvasó ADC-vel: `server/`-ből
   `GOOGLE_CLOUD_PROJECT=grundo PORT=8080 npx tsx watch server.ts`.
3. `grundo/.env.local`-ban `VITE_API_BASE_URL=http://localhost:8080`, majd a
   Vite dev szervert ÚJRA KELL INDÍTANI.

**ÍRÓ funkcióhoz (jelvények, értesítések) NE az éles, csak-olvasó ADC-t —
helyi Firestore-emulátort**:

1. `export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot/bin:$PATH"`,
   majd `firebase.cmd emulators:start --only auth,firestore --project demo-grundo`
   (Firestore 8081, Auth 9099).
2. Szerver, az emulátorhoz kötve:
   `FIRESTORE_EMULATOR_HOST=127.0.0.1:8081 GOOGLE_CLOUD_PROJECT=demo-grundo npx tsx watch server.ts`.
3. Egy VALÓDI kliens-oldali bejelentkezéshez a `.env.local`-ba a TELJES
   Firebase-konfiguráció kell (lásd `.env.example`), PLUSZ
   `VITE_USE_EMULATORS=1`. ⚠️ Ebben a menetben ez a lépés NEM sikerült
   stabilan — a kliens Firestore-kapcsolat makacsul visszaugrott az éles
   projektre. Ha legközelebb ez kell, érdemes lehet egy tiszta, friss Vite
   dev-szerver-indítással (ne csak `preview_stop`/`preview_start`) próbálni,
   vagy explicit `connectFirestoreEmulator`-hívással a modul BETÖLTÉSE
   előtt, nem utána.
4. Ha hitelesítést igénylő képernyőt kell látni ANÉLKÜL, hogy a fenti
   kliens-emulátor-kapcsolatot meg kellene oldani: a `server/tmp/`-be egy
   eldobható Express-szerver (rögzített uid-del, ugyanaz a minta, mint a #5–#6
   menetekben), a `.env.local` `VITE_API_BASE_URL`-jét erre állítva. Ez a
   Home képernyő ÉS a statisztikapanel-átalakítás vizuális ellenőrzésénél
   bevált ebben a menetben is.
5. A `.env.local`-t telepítés előtt vissza kell állítani
   (`VITE_API_BASE_URL=https://grundo-api-irb5rjve6a-ew.a.run.app`, a Firebase-
   config sorok és a `VITE_USE_EMULATORS` törlésével).

## Infrastruktúra: éles, csak olvasó Firestore-hozzáférés

Változatlan. `grundo-reader@grundo.iam.gserviceaccount.com`
(`roles/datastore.viewer`), Geri (`gergely.marthon@gmail.com`)
megszemélyesíti. Nincs kulcsfájl. PowerShellben `gcloud.cmd`, nem `gcloud`.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Opus, emelt mélységgel**, ha a **térkép-vizualizációval** folytatjuk — a
`scope: 'area'` vs `'global'` megkülönböztetés és a GeoJSON-réteg
hozzáadása a meglévő Mapbox-rétegekhez valódi tervezési döntés, nem rutin
minta-követés. **Sonnet** elég, ha csak a push élő ellenőrzését vagy a
`NotificationPanel` böngészős próbáját végezzük el — az ehhez a menethez
tartozó kód már megvan, csak látni kell működés közben.
