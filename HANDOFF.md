# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja, nem a történetet — minden menet végén
felülíródik, nem bővül. A történet a git logban van.

**Következő menet neve: GRUNDO #6.** (A számozás a BESZÉLGETÉSEKÉ, nem a
munkameneteké: azt kell nézni, hány chat van. Az előző napló tévesen #8-at
írt, miközben az ötödik beszélgetés folyt — javítva, lásd [AGENTS.md → 7. A
beszélgetések neve](AGENTS.md).)

## ÁLLAPOT

Repo: `C:\Users\Geri\Documents\GitHub\grundo`, ág: `main`. A pontos HEAD-et
`git log -1`-gyel nézd meg.

Tesztek, most mérve: gyökérből `npm test` → **333 teszt zöld** (24 fájl, 8
emulátoros kihagyva). Emulátoros (`npm.cmd run test:emulator`) → **8 fájl, 99
teszt zöld**. Typecheck (gyökér ÉS `server/`) és mindkét production build
hibamentes.

A #5 menetben Geri hét pontot kért, kettő menetben (négy + a rögzítés/profil
lista). **Mind a hét elkészült.**

## ⚠️ ELSŐ OLVASATRA: MIT KELL TELEPÍTENI ÉS FUTTATNI

1. **frontend + backend** telepítés kell.
2. **szabalyok** telepítés is kell (a `firestore.rules` változott: az
   értesítés törölhető, a tiltás írása szerveroldalra került, és van egy új
   `blockedBy` alkollekció).
3. **Egyszeri migráció**, a szabályok után: a régi tiltásokhoz meg kell írni a
   `blockedBy` tükröt. Cloud Shellben:

   `cd ~/grundo/server && npm run backfill:blocked-by -- --apply --allow-production`

   (Előbb `git pull`. `--apply` nélkül csak jelentést ír. Amíg nem futott le, a
   RÉGI tiltásoknál a „ki tiltott engem" irány nem szűr — az újaknál igen.)
4. Indexek NEM kellenek.

## AMI A #5 MENETBEN ELKÉSZÜLT

### 1. Értesítés-panel: teljes képernyős, húzható sorokkal

`NotificationPanel.tsx` + `notificationPanel.css` teljesen újraírva,
`useNotifications.ts` bővítve.

- Teljes képernyő, „Értesítések" fejléc; jobbra ikonos **összes törlése**
  (kétlépcsős megerősítéssel) és **mind olvasott**, mellettük a bezáró X.
- **20 elem + „További értesítések betöltése"**. A lapozás az élő
  feliratkozás ABLAKÁT növeli (`limit(size)`), nem indít új lekérdezést — így
  az új értesítés továbbra is magától jelenik meg a lista tetején.
- **Balra húzva olvasott, jobbra húzva törlés.** A kártya MÖGÖTT bal szélen a
  kuka, jobb szélen a nyitott boríték — mindig az az ikon bukkan elő, amelyik
  művelet történni fog. Egérrel a sor fölé érve is látszanak (PC-n enélkül
  semmi nem árulná el, hogy húzható).
- A küszöb a kártya szélességének fele; gyors pöccintésnél (300 ms alatt) a
  negyede is elég. Az első nyolc pixel dönti el, hogy húzás vagy görgetés.
- A hook új képességei: `remove`, `removeAll` (a TELJES kollekciót törli, nem
  csak a betöltött ablakot), `loadMore`, `hasMore`.

⚠️ **A `firestore.rules` ezért engedi a törlést** (`allow delete: if
isSelf(uid)`), a létrehozást továbbra sem: az értesítés keletkezése a szerver
egyetlen kapujáé (`createNotification`).

### 2. Időjárás: Open-Meteo, egy hívás, kibontható widget

`server/src/routes/weather.ts` újraírva, `WeatherWidget.tsx` kibontható.

Geri döntése: legyen EGY forrás, ahonnan minden adat jön. Az OpenWeather
„current" végpontja a csapadék ESÉLYÉT nem adja (az csak az előrejelzésen van),
ezért az Open-Meteo-ra váltottunk: egy hívás, mind a négy adat, **API-kulcs
nélkül**, a szél rögtön km/h-ban.

- A widget koppintásra BALRA csúszik ki: hőmérséklet, csapadék esélye,
  páratartalom, szél. A sáv a köszöntést kitakarja, nem tolja arrébb.
- A WMO kódokat mi képezzük le a hét ikon-állapotra, és a **magyar leírás
  innentől a miénk** (`describe`) — a szolgáltató nem ad szöveget.
- A csapadék-esély a FOLYÓ órára illesztve jön (`pickPrecipitationChance`),
  nem vakon a tömb nulladik eleméből.
- **Élő méréssel ellenőrizve** (2026-08-20, gazdagréti koordinátán): 200-as
  válasz, `°C` / `%` / `km/h` egységek, az óránkénti tömb a mostani órával
  kezdődik. 13 új egységteszt.

⚠️ **Az `OPENWEATHER_API_KEY` kikerült a `cloudbuild.yaml`-ból.** A titok
maga megmaradt a Secret Managerben — ha véglegesen nem kell, Geri törölheti.

### 3. Tiltás: a MÁSIK irány is szűr a feedben

A tiltás mostantól két helyre íródik: `users/{tiltó}/blocks/{tiltott}` ÉS
`users/{tiltott}/blockedBy/{tiltó}` (egy kötegben, a feloldás ugyanígy). A feed
mindkettőt beolvassa a SAJÁT felhasználó alól — két olcsó lekérdezés, nem
soronkénti olvasás.

- A `blocks` írása szerveroldalra került (`firestore.rules`): a kliens eddig is
  csak az API-t hívta, de a közvetlen írás megkerülte volna a tükröt és a
  követés-bontást.
- Új emulátoros teszt bizonyítja, hogy a tükör létrejön és a feloldás elviszi.
- A meglévő tiltásokhoz **egyszeri migráció kell** (lásd fent).

### 4. Aktivitás-mentés: görgő mezők, fix Mentés gomb

`SaveActivityForm.tsx` törzsre (`save__body`) és gombsorra (`save__actions`)
bomlik. A rögzítés utáni panel (`track__panel--upload`) a képernyő maradék
magasságát kapja, és BELÜL görget: a mezők mozognak, a Mentés és az Új
rögzítés gomb a helyén marad.

⚠️ **Amit mértem, és amit nem sikerült**: a régi CSS-t 375×812-es és 360×560-as
nézetben reprodukálva a felület MAGÁTÓL görgethető volt (`scrollHeight >
clientHeight`), tehát a „nem lehet görgetni" okát nem sikerült ebben a
környezetben előhívni — valódi eszközön a `pointer-events: none`-os
overlay-réteg vagy a Mapbox gesztuskezelése a legvalószínűbb gyanúsított. Az új
szerkezet ezt a kérdést megkerüli: a görgetés ott van, ahol az ujj is, és a
gombhoz nem kell görgetni. Mérve: 6 kép mellett a törzs görget (487 px látszik
558-ból), a Mentés gomb helye NEM változik, és 560 px magas képernyőn is
mindkét gomb látszik.

### 5. Rögzítés képernyő — öt változás

- **„Vissza a pozíciómra" gomb**: már létezett a `MapView`-ban (célkeresztes
  ikon), de két baja volt. A Dock ALÁ került (`bottom: var(--sp-4)`), tehát nem
  lehetett elérni — most a dokk magassága, a kinyúló gomb és a biztonságos sáv
  is beleszámít. És csak akkor jelent meg, ha a KÖVETÉS be volt kapcsolva
  (vagyis csak mérés közben) — mostantól elég, hogy a felhasználó elmozdította
  a térképet, és tudjuk, hol van. ⚠️ Ettől a Grund képernyőn is megjelenik
  pásztázás után; ez szándékos.
- **A „pont" érték kikerült** a panelről, a GPS-jelzőpötty a GP mellé
  költözött. Így négy érték maradt: idő, tempó, mező, GP — egy sorban,
  kinyitva 2×2 (a CSS eddig is erre volt tervezve, az ötödik érték törte el).
- **A sebesség mértékegysége a számmal egy sorba került** (`12,4 km/h`,
  ugyanabban a méretben és színben, mint a `1,55 km`), a címke pedig
  „sebesség". Új formázó: `formatLiveSpeed` — a `formatSpeed`-del ellentétben a
  0,0 km/h nála VALÓDI érték, nem „nincs adat".
- **A körök panel fejlécsávot kapott**: az összecsukó gomb a saját sorában ül,
  nem a kártya sarkába lebegtetve, ahol ráült a legfelső kör távolságára
  (mérve: most 19 px a hézag). A jel `✕` helyett `_`, kör háttérrel.
- **A Befejezés gomb nyomva tartós**: két másodperc, közben balról jobbra
  pirosra telik a háttér, és a felirat PONTOSAN addig vált fehérre, ameddig a
  piros ért (két szövegréteg, a felső ugyanarra a százalékra vágva).
  Billentyűzetről is működik, elengedésre visszafolyik.

### 6. Profil: követő/követett lista

- Új végpontok: `GET /api/users/:username/followers` és `/following` — egy
  `getAll`-lal hozza a neveket és a képeket, és **ugyanaz a kapu védi, mint a
  profilt** (privát fióknál csak ő maga és a követői látják; a tiltott 403-at
  kap). Legfeljebb 100 elem, `hasMore` jelzéssel.
- Új komponens: `ConnectionsSheet.tsx` — teljes képernyős lista, kép + név,
  koppintásra a nyilvános profil. Z-index 60, azaz a lapok szintje (a Dock 40,
  a feed lebegő eleme 30) — így a lista alól nem érhető el a navigáció.
- A profil két számlálója (követő, követett) ettől GOMB lett, nem doboz.

## AMIT MÉRTEM EBBEN A MENETBEN

**Egy valódi hibát a saját új kódomban is** — a mérés hozta elő, nem a
kódolvasás: a `npanel__list` és a `conn__list` eredetileg `display: grid` volt,
és amikor a tartalom magasabb a lapnál, a böngésző ÖSSZENYOMTA a sorokat
görgetés helyett (`scrollHeight === clientHeight`), a háromsoros értesítés
kártyáját pedig levágta a sor `overflow: hidden`-je. Flex oszlopra és `flex:
none` gyerekekre cserélve a sor pontosan a kártya magassága, és a lista
görget. **Ez ugyanaz a hibaosztály, mint amit Geri az aktivitás-mentésnél
bejelentett** — érdemes gyanakodni rá minden görgethető rácsnál.

Mérőeszköz: a `tmp/` alatt két eldobható HTML (`dev-track.html`, `dev-ui.html`)
a VALÓDI CSS-fájlokat tölti be, és a Vite dev szerveren (`/tmp/dev-ui.html`)
nyitva mérhető vele minden elem befoglaló doboza. A `tmp/` gitignore-olt, tehát
ezek nem kerülnek a repóba. Ütközés-, magasság- és görgethetőség-vizsgálathoz
sokkal olcsóbb, mint a teljes app felállítása.

## AMIT NEM SIKERÜLT ELLENŐRIZNI

⚠️ **Egyik új felületet sem láttam futó alkalmazásban.** A böngésző-előnézet
ebben a munkamenetben nem tudott képernyőképet készíteni („the Browser pane is
not displayed"), a bejelentkezést igénylő képernyőkhöz pedig kliens-oldali
Firebase-hitelesítés kellett volna. Amit tehát Gerinek élesben KÜLÖN meg kell
néznie:

1. **Az értesítés-kártya húzása valódi ujjal** — a küszöb (fél kártya) nem
   túl hosszú-e, és a görgetés/húzás szétválasztása jól esik-e kézre.
2. **A Befejezés gomb nyomva tartása** — a két másodperc nem sok-e.
3. **A követő-lista** valódi adaton (a végpontot emulátoros teszt fedi, a
   felületet nem).
4. **A kibontott időjárás-sáv** egy hosszú felhasználónévnél.
5. A #7 menetből örökölt két nyitott ellenőrzés: a **push-küldés** valódi
   eszközön, és a `NotificationPanel` élő `onSnapshot`-feliratkozása.

Komponens-tesztet szándékosan NEM írtam: nincs `jsdom`/testing-library a
projektben, és új függőséget nem veszek fel magamtól.

## ÉLESBEN FUT

- **Napi forduló**: legutóbb mérve 2026-08-20-án — rendben megy.
- **Admin felület**: `/admin` — játékszabály-szerkesztő, akciók, aktivitás-
  audit, visszajátszó.
- **Futásidejű konfiguráció**: `appConfig/gameplay` a v1-en áll. Fut egy aktív
  akció: „Gazdagrét Rush", globális 2×-es GP-szorzó — ellenőrizd, hátha
  időközben lejárt.
- **Jelvény-katalógus**: feltöltve (`seed:badges`, 45 dokumentum).

## TELEPÍTETLEN

A #4, #5, #6, #7 (a régi számozás szerint) ÉS ez a menet — együtt. Frontend +
backend + szabályok, plusz a `blockedBy` migráció (lásd fent).

⚠️ **A backend telepítése előtt** továbbra is érvényes az előző menet
figyelmeztetése: a Cloud Run szolgáltatásfióknak
`roles/firebasecloudmessaging.admin` kell a push-küldéshez, különben az
alkalmazáson belüli értesítés megy, a push csendben nem.

A frontend `.env.local`-jába (Cloud Shell) továbbra is kell:
`VITE_FIREBASE_VAPID_KEY=BIMRvwkmQxpciXnk-3s5x_HqtKX5j8K7hDiQNhC3vV_shO_Kislr3iE4cDZ59Ih2wJLaA_0LK5YzbMAbiYEORL8`

## KÖVETKEZŐ: 6. MENET

Geri sorrendje szerint most a #7 menet nagy listájából hátralévők jönnek
(„utána mehet a 4–8"):

- **Aktív akciók a térképen.** A modifier `areaCells` mezője
  (`src/game/modifiers.ts`) H3-cellalista `MODIFIER_AREA_RES` felbontáson —
  ebből rajzolható határvonal a Grund-térképen, a meglévő cella-réteg
  mintájára. ⚠️ Csak `scope: 'area'` modifierekre van geometria; egy globális
  akciónak (mint a most futó „Gazdagrét Rush") NINCS térképi kiterjedése.
  Jelmagyarázat is kell hozzá.
- **A push-küldés és a `NotificationPanel` élő ellenőrzése** telepítés után.
- Geri 7 pontos jelvény/profil-listájából: **keresés** és **rivális rendszer**.

## NYITOTT, KISEBB

- **Az értesítés-sor törlése csak húzással megy** — billentyűzetről nincs rá
  út (a fejléc „összes törlése" igen). Ha kell, a háttér-ikonok kattinthatóvá
  tehetők.
- **A követő-lista nem lapoz**: a legfrissebb 100 megy ki, a `hasMore` pedig
  kiírja, ha többen vannak. Kurzoros lapozás utólag rátehető, séma-változtatás
  nélkül.
- **A harang olvasatlan-számlálója a betöltött ablakból számol** (20 elem):
  huszonötnél több olvasatlannál 20-at mutat. A pötty maga jó.
- A `modifier_started` broadcast MINDEN felhasználóhoz megy, szűrés nélkül.
- A jelvény-jutalom GP nem frissíti azonnal a `level` mezőt.
- **Az időjárás csak akkor jelenik meg magától, ha van tárolt pozíció.**
- **gpLedger-takarítás — elő van készítve, futtatásra vár.**
  `server/src/scripts/cleanGpLedgerJunk.ts`, legutóbb 12 sor várt törlésre.
- **A követési KÉRÉSEK elbírálására még nincs felület.**
- **A tiltottak listája sincs sehol** — most, hogy a `blockedBy` tükör
  megvan, egy „kiket tiltottam" képernyő olcsón megírható.
- Területi hatókörű hold-modifier nem hat: a `zones` kollekció még nincs meg.
- `gpWeek`/`gpMonth` ablakzárás él, de éles adaton még nem láttuk működni.

## Fejlesztői előnézet — hogyan látunk éles adatot a böngészőben

**Írás nélküli, csak-olvasó ellenőrzéshez** (nem-író képernyőkhöz):

1. `.claude/launch.json` a `G:\Saját meghajtó\WORK\CLAUDE` gyökérben — Vite
   dev szerver, port 5173. Innen a `tmp/*.html` mérő-lapok is elérhetők.
2. Szerver, csak-olvasó ADC-vel: `server/`-ből
   `GOOGLE_CLOUD_PROJECT=grundo PORT=8080 npx tsx watch server.ts`.
3. `grundo/.env.local`-ban `VITE_API_BASE_URL=http://localhost:8080`, majd a
   Vite dev szervert ÚJRA KELL INDÍTANI.

**ÍRÓ funkcióhoz helyi Firestore-emulátort**, ne az éles ADC-t:

1. `export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot/bin:$PATH"`,
   majd `firebase.cmd emulators:start --only auth,firestore --project demo-grundo`.
2. Szerver: `FIRESTORE_EMULATOR_HOST=127.0.0.1:8081 GOOGLE_CLOUD_PROJECT=demo-grundo npx tsx watch server.ts`.
3. Kliens-oldali bejelentkezéshez a `.env.local`-ba a TELJES Firebase-konfig
   kell, PLUSZ `VITE_USE_EMULATORS=1`. ⚠️ Ez a lépés a #7 menetben NEM
   sikerült stabilan (a kliens visszaugrott az éles projektre); érdemes
   explicit `connectFirestoreEmulator`-hívással próbálni, a modul BETÖLTÉSE
   előtt.
4. A `.env.local`-t telepítés előtt vissza kell állítani.

## Infrastruktúra: éles, csak olvasó Firestore-hozzáférés

Változatlan. `grundo-reader@grundo.iam.gserviceaccount.com`
(`roles/datastore.viewer`), Geri (`gergely.marthon@gmail.com`) személyesíti
meg. Nincs kulcsfájl. PowerShellben `gcloud.cmd`, nem `gcloud`.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Opus, emelt mélységgel**, ha a **térkép-vizualizációval** folytatjuk: a
`scope: 'area'` vs `'global'` megkülönböztetés és az új GeoJSON-réteg a
meglévő Mapbox-rétegek közé valódi tervezési döntés. **Sonnet** elég, ha a
telepítés utáni élő ellenőrzésekkel (push, feliratkozás, követő-lista) vagy
a „kiket tiltottam" képernyővel kezdünk — ott a minta már megvan.
