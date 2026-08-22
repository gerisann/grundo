# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja, nem a történetet — minden menet végén
felülíródik, nem bővül. A történet a git logban van.

**Következő menet neve: GRUNDO #7.** (A számozás a BESZÉLGETÉSEKÉ, nem a
munkameneteké: azt kell nézni, hány chat van. Lásd [AGENTS.md → 7. A
beszélgetések neve](AGENTS.md).)

## ÁLLAPOT

Repo: `C:\Users\Geri\Documents\GitHub\grundo`, ág: `main`. A pontos HEAD-et
`git log -1`-gyel nézd meg — ez a menet TÖBB commitban ment fel `a8018ed`
fölé: `d244d94` (az öt pont), `326ed8c` (első utólagos javítás), `caee5db`
(napló), majd egy még nem commitolt utolsó javítás (ranglista — mindenki
rajta van, ábécésorrend, összetett index).

Tesztek, most mérve: gyökérből `npm test` → **333 teszt zöld** (24 fájl, 8
emulátoros kihagyva, változatlan a menet eleji számhoz képest — ez a kör nem
adott új tesztet). Typecheck (gyökér ÉS `server/`) hibamentes. Élőben
ellenőrizve a helyi emulátoron, valódi bejelentkezéssel: pódium, értesítés-
ikonok, időjárás-widget méret, ranglista (nulla terület + ábécésorrend).

**Amit ez a menet NEM tudott élőben kipróbálni**: az aktivitás-mentés utáni
átirányítást (1. pont lent), mert ahhoz egy valódi, lezárt aktivitás kell —
az emulátoron nincs seedelt GPS-nyomvonal (lásd korábbi menetek jegyzetét
ugyanerről). A kódot a szerkesztő-módban már bevált `onSaved` mintára írtam
(`ActivityScreen.tsx` ugyanígy csinálja), típusellenőrzéssel igazolva.

## ⚠️ ELSŐ OLVASATRA: MIT KELL TELEPÍTENI ÉS FUTTATNI

1. **frontend + backend** telepítés kell (mindkét oldalt érintette a kör).
2. Szabályok NEM változtak.
3. Migráció NEM kell.
4. **Indexek KELLENEK** — ez ELTÉR a menet elején jelzetthez képest: a
   ranglista utolsó javítása két mező szerint rendez, ahhoz összetett index
   kell (`firestore.indexes.json`). Ha kimarad, a ranglista élesben
   `FAILED_PRECONDITION` hibával elhasal.

Ezen felül a #6 előtti menetek óta **még mindig várakozik** egy korábbi
teendő — lásd alul, „TELEPÍTETLEN".

## EBBEN A MENETBEN ELKÉSZÜLT

Geri hat apró kérést adott át. Öt elkészült és élőben ellenőrizve az
emulátoron; a hatodik (napi/heti/havi ranglista-bontás) NEM készült el —
lásd „KÖVETKEZŐ MENET", ott a döntés miért maradt ki.

### 1. Aktivitás-mentés — ragadt képernyő javítva

`TrackingScreen.tsx`: a feltöltés utáni névadó/leíró űrlap (`SaveActivityForm`)
eddig nem kapott `onSaved` callback-et ezen a képernyőn (szerkesztéskor, az
`ActivityScreen`-en már régóta megvolt). Mentés után most bezárja magát és a
frissen mentett aktivitás részletképernyőjére navigál
(`navigate('/aktivitas/' + recorder.state.id)`), ugyanúgy, ahogy a
szerkesztő-mód is teszi.

### 2. Időjárás-widget — méret és térköz finomítás

`WeatherWidget.tsx` + `weatherWidget.css`: a kibontott sáv három
mérőszám-ikonja 26→**20 px**. A mérőszámok közti térköz +5 px (4→9 px,
`.weather__detail` gap). A panel jobb szélén álló hőmérséklettől/égképtől
külön +5 px margó, de **csak nyitva** (`.weather--open .weather__detail`
kapta a `margin-right`-ot, nem az alap állapot — csukva a sáv úgyis nulla
széles, felesleges lett volna ott is hozzáadni).

### 3. Értesítés-ikonok — emoji helyett flat SVG

`notificationTypes.ts`-ből kikerült az `iconFor`/`typeIcon` (emoji-lista),
átköltözött `NotificationPanel.tsx`-be flat, egyszínű SVG-ként (a
`WeatherWidget`/`NotificationPanel` meglévő ikon-mintájára: `stroke:
currentColor`, `fill: none`). Kilenc típus, kilenc forma (pajzs-figyelmeztetés,
pajzs-pipa, villám, jelvény, szív, buborék, futó alak, személy+plusz,
megafon), a színük a **meglévő tokenkészletből** jön (nincs új CSS-változó):
`--danger`, `--success`, `--weather-sun`, `--tier-gold`, `--player-4`,
`--info`, `--accent`, `--weather-wind` — `notificationPanel.css` →
`.nrow__icon--*`. Élőben ellenőrizve mind a kilenc típuson.

### 4. Ranglista — a korábban területet szerzők nem esnek ki

⚠️ **Ez a pont KÉTSZER változott ebben a menetben** — az itt leírt első
próbálkozás (egy `hasOwnedArea` jelző) élesben üres listát adott volna, a
végleges megoldás (mindenki rajta van, ábécésorrenddel) pedig lent, a
„Második utólagos javítás" szakaszban van. Ha telepítesz, AZ a mérvadó.

### 5. Top 3 pódium grafika

Új `Podium` komponens a `TerritoryScreen.tsx`-ben, a ranglista teteje fölött
(a teljes, számozott lista alatta változatlanul megmarad, a top 3-at is
tartalmazza — nem hiányzik belőle semmi). Ezüst-arany-bronz sorrendben balról
jobbra (a hagyományos dobogó, nem a helyezés sorrendje), korona csak az
1. helyen, a sávok magassága a legjobbhoz viszonyított, arányos terület
(min. 28 px, max. 88 px). **Szándékosan visszafogott szín** — Geri kifejezetten
kérte, hogy ne legyen olyan élénk, mint a csatolt referenciakép: a sávok a
meglévő `--tier-gold/silver/bronze` tokenekből kapnak halvány
(`color-mix … 16%`) tónust, nem új, telített hátteret. `territory.css` →
`.terr__podium*`. Élőben ellenőrizve: 5 szereplős emulátoros ranglistán a
sávmagasság, a korona és a szín-hozzárendelés mind helyesen jelent meg
(JS-sel mérve, screenshot nem volt elérhető ebben a munkamenetben — a Browser
pane nem volt megjeleníthető).

### Második utólagos javítás — ranglista, mindenki rajta van

Geri jelezte, hogy a nulla területű felhasználók MÉGSEM jelennek meg, és
azt kérte, hogy ők és minden egyenlő területű felhasználó ábécésorrendben
listázódjon. Ez felülírta az előző kör `hasOwnedArea`-alapú megoldását:

- **A `hasOwnedArea` jelző teljesen kikerült** (`activityCommit.ts`,
  `activityChunked.ts`, `seedEmulator.ts`) — a helyette bevezetett
  megoldás nem igényel jelzőt, se migrációt, ezért egyszerűbb és nincs
  a régi felhasználóknál hiányzó adat problémája.
- **`routes/tiles.ts` → GET /leaderboard**: a lekérdezés most KÉT mező
  szerint rendez — `territoryM2.{layer}` csökkenő, `usernameLower` növekvő
  —, szűrés nélkül, tehát mindenki rajta van, a nulla területűek is. Az
  ábécésorrend a másodlagos rendezés, ami egyenlő terület esetén dönt
  (a leggyakoribb ilyen eset épp a nulla).
- **Ehhez összetett index kell** — felvéve a `firestore.indexes.json`-ba,
  réteganként külön bejegyzés (`territoryM2.foot`/`territoryM2.bike` két
  külön mezőútvonal). **Ez a menet első alkalommal érint indexet** — a
  telepítésnél NE csak a „szabalyok" parancsot futtasd, hanem az
  „indexek"-et is, különben a ranglista élesben `FAILED_PRECONDITION`
  hibával elhasal.
- Minden felhasználónál eleve létezik `territoryM2.{foot,bike}` ÉS
  `usernameLower` (a `user.ts`-ben regisztrációkor mindkettő alapértéket
  kap) — tehát nincs olyan felhasználó, akit a Firestore a hiányzó mező
  miatt kihagyna a rendezésből.
- Élőben ellenőrizve az emulátoron: két felhasználó nullára állítva, kettő
  egyenlő (0,012 km²) — mindkét csoport megjelent, ábécésorrendben
  (Kata_fut < MarkOnBike; Peti < ZsofiWalks).

### Első utólagos javítás (`326ed8c`) — Geri visszajelzése alapján

Az öt pont után Geri két hibát jelzett, még ebben a menetben javítva:

- **A ranglista üresen jött.** A `hasOwnedArea` új mező a régi felhasználóknál
  nincs kitöltve — se migráció, se semmi nem tölti visszamenőleg —, a
  szigorú `.filter((entry) => entry.hasOwnedArea)` ezért MINDENKIT kizárt,
  nem csak a soha nem birtoklókat. Javítás: `.filter((entry) =>
  entry.hasOwnedArea || entry.areaM2 > 0)` — az `areaM2 > 0` ág migráció
  nélkül fedezi a jelenleg pozitív területűeket (ahogy régen), a
  `hasOwnedArea` pedig mostantól minden ÚJ szerzésnél kitöltődik. Élőben
  ellenőrizve: az emulátoron egy felhasználóról admin SDK-val letöröltem a
  mezőt (a régi, migráció előtti állapot szimulálva), és a ranglistán
  ennek ellenére megjelent.
- **Az időjárás jobb széli térköze rossz helyre került.** Az eredeti kérés a
  hőmérséklet ÉS A MODUL KERETE közti gap-re vonatkozott, én tévesen a
  mérőszám-csoport és a hőmérséklet közé tettem az extra 5 px-et. Javítva:
  `margin-right: 5px` a `.weather__temp`-en, ez mindig érvényesül (nyitva és
  csukva is), és a pill saját `padding-right`-jával (12 px) összeadva 17 px
  a keret és a fokjel között. Mérve: `pillRect.right - tempRect.right` = 18
  (kerekítéssel).


## KÖVETKEZŐ MENET

**Napi / heti / havi ranglista-bontás — Geri 6. pontja, NEM készült el.**

Ez adatmodell-döntés, ezért ebben a menetben szándékosan megálltam nála a
könnyebb pontok után, ahelyett hogy rögtönöztem volna. A helyzet:

- A `territoryM2` csak a JELENLEGI állapotot tárolja, nincs időablakos
  előzménye. A GP-nél már van minta erre (`gpWeek`/`gpMonth`, nullázás a
  `dailyRollover.ts`-ben) — de a GP-nél nincs lopás, a területnél van, ami
  mást jelent: „e heti GP" = e héten szerzett pont, de „e heti terület" nem
  egyértelmű — a NETTÓ változást mérje (szerzett mínusz elvesztett), vagy a
  szerzett bruttó mennyiséget?
- Ha a NETTÓ változás a cél (valószínűbb — ez felel meg egy „ki nyert
  legtöbbet EBBEN AZ IDŐSZAKBAN" kérdésnek), akkor napi pillanatkép
  (snapshot) kell minden felhasználóhoz, és a heti/havi szám a mai és az
  N nappal ezelőtti pillanatkép különbsége — ez új kollekciót és egy új
  napi jobot (vagy a meglévő `dailyRollover` bővítését) igényel.
- Ha a BRUTTÓ szerzés a cél (egyszerűbb, a `gpWeek`/`gpMonth` mintájára:
  `areaWeek`/`areaMonth` számláló, ami az `activityCommit.ts`/
  `activityChunked.ts` claim-jénél nő, és a `dailyRollover.ts` heti/havi
  ablakzárásánál nullázódik), akkor NAPI bontás így nem megy, mert jelenleg
  nincs `gpDay`/`areaDay` mező sem — azt is be kellene vezetni.
- Mindkét irány valódi tervezési döntés, ami hat a Firestore írásmennyiségre
  és a `dailyRollover` szerkezetére is — ezért Opus-szintű kérdés, nem
  rögtönözhető.

**Javaslat a menet elejére**: Geri döntse el, NETTÓ vagy BRUTTÓ változás
legyen-e az időablakos ranglista alapja, utána a modell és az index
megtervezhető.

## NYITOTT, KISEBB

Változatlan a #6 előtti menetek óta — ezt a kört nem érintették:

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
- Geri korábbi 7 pontos jelvény/profil-listájából: **keresés** és
  **rivális rendszer**.

## ÉLESBEN FUT

- **Napi forduló**, **admin felület**, **futásidejű konfiguráció**
  (`appConfig/gameplay` v1, „Gazdagrét Rush" akció — ellenőrizd, nem járt-e
  le), **jelvény-katalógus** — mind változatlan egy korábbi menet óta.

## TELEPÍTETLEN

Több menet munkája együtt vár: a korábbi menetek (időjárás/tiltás/profil-link/
értesítés-húzás) ÉS ez a menet. Frontend + backend, plusz a `blockedBy`
migráció egy korábbi menetből, ha még nem futott le:

```
cd ~/grundo/server && git pull && npm run backfill:blocked-by -- --apply --allow-production
```

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
2. `firebase.cmd emulators:start --only auth,firestore --project demo-grundo`
   (Bash-ben `firebase`, `.cmd` nélkül — a globális npm-bin már a PATH-on van).
3. `server/`-ből `npm run seed:emulator`, majd `npm run dev:emulator`.
4. Gyökérből `npm run dev:emulator` (vagy a `grundo-emulator` launch-konfig).
5. Böngészőben: `await __grundoDevSignIn()`.

⚠️ **Port-ütközés**: az `npm run test:emulator` saját `firebase
emulators:exec`-et indít — ha közben kézzel is fut egy emulátor-példány
(fenti 2. lépés), a portok ütköznek. Előbb állítsd le a kézit
(`Get-NetTCPConnection -LocalPort 8081,9099 | Stop-Process`), utána fusson a
teszt-parancs.

⚠️ **Ebben a menetben a Browser pane screenshotja nem volt elérhető** („the
Browser pane is not displayed" hiba) — a vizuális ellenőrzés `read_page`,
`get_page_text` és `javascript_tool` (számított stílusok, DOM-tartalom)
kombinációjával ment, screenshot nélkül. Ha legközelebb is így lesz, ugyanez
az út működik.

## Infrastruktúra: éles, csak olvasó Firestore-hozzáférés

Változatlan. `grundo-reader@grundo.iam.gserviceaccount.com`
(`roles/datastore.viewer`), Geri (`gergely.marthon@gmail.com`) személyesíti
meg. Nincs kulcsfájl. PowerShellben `gcloud.cmd`, nem `gcloud`.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Opus, emelt mélységgel** — a napi/heti/havi ranglista-bontás nettó-vs-bruttó
döntése és az ebből következő adatmodell (új mező vagy új kollekció, a
`dailyRollover.ts` bővítése) valódi architektúra-kérdés, nem rutinmunka.
