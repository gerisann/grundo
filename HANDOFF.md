# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja. A történet a git logban van.

**Következő menet neve: GRUNDO #11.** A #10 menet auditálta és javította a rivális
felületet, közös nevezőre hozta a küldetés-specifikációt és a kódot, valamint
elkészítette a profil új füles navigációját és a tracking kért térképi javításait.
A profilfülek utólagos vizuális és kattintási finomítása is elkészült.
Ezután lezárult a távolságalapú küldetés verziókompatibilitása, az abszolút
útvonal-tisztasági kapu, valamint a tracking térképvezérlőinek javítása. A
valós térképen ezután látott rövid hurkok miatt a minőségi kapu több léptékű
fordulás- és helyikerülő-felismerést kapott.

## ÁLLAPOT

- Repo: `C:\Users\Geri\Documents\GitHub\grundo`
- Ág: `main`, az `origin/main` előtt 1 helyi committal.
- Unit tesztek: **394 zöld**, 112 emulátoros teszt a normál futásban kihagyva.
- Emulátoros készlet: **112 zöld** valódi Firestore/Auth emulátor ellen.
- Típusellenőrzés: gyökér és `server/` hibamentes.
- Production build: frontend és backend hibamentes. A Mapbox chunk ismert,
  változatlan 521,57 kB gzip figyelmeztetést ad.
- `git diff --check`: tiszta.

## MI KÉSZÜLT EL

### Profil fülek

Rögzített sorrend: **Profil · Statisztika · Küldetések · Riválisok · Klánok ·
Badgek**. A tabsor háttér nélküli, normál betűvastagságú, halvány alsó
elválasztóval és lila–korall gradiens aktív vonallal. A „Profilom” fejléc,
beállítások gomb és tabsor közös sticky blokk, görgetésre is a képernyő tetején
marad. Keskeny kijelzőn touch swipe és egérrel fogd‑és‑húzd is működik.

- `Riválisok`: a frontend és a backend route elkészült, de az éles backend
  jelenleg régi (`grundo-api-00065-2cp`, 2026-08-22), ezért telepítésig az
  „Ismeretlen végpont: GET /api/rivals” hiba látszik.
- `Badgek`: a meglévő jelvénylista önálló füle; a régi `/profil/badges` cím
  kompatibilitási átirányításként megmaradt.
- `Statisztika`, `Klánok`: őszinte későbbi üres állapot, stabil route-tal.
- A Profil TOP 3 rivális-kártyájának „Összes” gombja a dedikált fülre visz.

### Rivális funkció — audit és javítás

- Új lopás után a kétoldalú riválistükör most a válasz és a badge-értékelés
  előtt jön létre, így a profil azonnal látja.
- TOP 3 profil-kártya és teljes, max. 200 elemű kereshető fül kész.
- Mindkét lista mutatja az összecsapások számát (`N×`), az összes gazdát
  cserélt területet km²-ben, valamint a szerzett/vesztett mezőket.
- A `RivalBadge` a feedben, hozzászólásoknál, kapcsolati listákban,
  aktivitás-adatlapon, keresésben, területtulajdonosnál, ranglistán és a
  nyilvános profilon be van kötve.
- A címke minden nézetben közvetlenül a felhasználónév mellett ül; kompakt,
  9 px-es, normál betűvastagságú és csak a szöveg szélességét foglalja.
- A visszatérő rivális támadásának értesítése külön címet kap; az első
  összecsapás semleges marad.
- A korábban csak dokumentációban említett visszatöltés most valóban létezik:
  `server/src/scripts/backfillRivals.ts`, alapból száraz futás, éles íráshoz
  kettős védelemmel.
- Éles, csak olvasó audit: 11 lopási esemény, 412 gazdát cserélt mező,
  2 tényleges pár. `geri ↔ peeti77`: **4×**, `+33/−30` mező; tehát a
  `geri` fiókban peeti77 valóban rivális. `geri ↔ gerivagyok`: 7×,
  `+54/−295` mező. Adatbázis-írás nem történt.
- A rivális badge küszöbe egy kapcsolat lesz; a neve/jutalom-GP még Geri
  döntésére vár, ezért ez az egy rész nincs késznek állítva.
- A rivalitás által közvetlenül érintett 18 aktivitás- és 5 riválistükör-
  emulátorteszt zöld; a backfill aggregátor további 2 unit tesztje zöld.

### Küldetések

- A generátor a Profil › Küldetések fülön él; a mentett küldetések ugyanitt és
  tracking indítás előtt is elérhetők.
- Tervezés idő vagy közvetlen km alapján.
- Időnél a saját múltbeli átlagtempó az alap, de felülírható (perc/km, bringán
  km/h).
- Opcionális cél: legjobb ajánlat / új terület / rablás / grund erősítése /
  felfedezés.
- Opcionális égtáj; megfelelő jelöltek esetén a választott féltekére szűr.
- A Home napi kártyája bezárható, chevronnal kattinthatónak látszik, és a
  konkrét napi ajánlatot tölti vissza — ez már a #9 commitjaiban elkészült,
  most böngészőben újra ellenőrizve.
- Távolságalapú kérés a km mellett kompatibilis időbecslést is küld, így a
  frontend/backend egymás utáni telepítése közben sem kap téves időhibát.
- Az útvonal „lábait” abszolút minőségi kapu fogja meg. A korábbi egyetlen,
  20 méteres U-fordulásmérés nem látta a néhány méteres lekerekített hurkokat
  és a három derékszögű doboz-kitérőket. A detektor most 6, 12 és 20 méteren
  mér, továbbá kiszűri a legfeljebb 350 méteres, 50%-nál rosszabb helyi
  kerülőarányt. Hibás jelölt nem ajánlható; inkább kevesebb tiszta küldetés
  jelenik meg. A három új alakteszttel együtt 10 routeShape unit teszt rögzíti.

### Tracking térkép

- A fekete, üres hatszög ikon ki/be kapcsolja a teljes mezőréteget; a jobb
  alsó térképvezérlő-oszlopban, a 2D/3D gombbal azonos 40×40 px méretben van.
- A megjegyzett 3D állapot már a Mapbox konstruktorában 55°-os dőlést kap,
  ezért első betöltéskor sem tér el az ikon a tényleges kamerától.
- A küldetés szaggatott vezetővonala `#FA5F73`.
- Élő foglalás: új/megerősített mező lila, elrabolt mező `#FA5F73`.
- Az élő előnézet már a közeli birtok-pillanatképpel fut, és a friss mezőkön
  is az 1–5 várható védelmi szintet, illetve annak telítettségét mutatja.
- A félbehagyott utak két fogalma szétvált. Az alap, ugyanazon eszközös
  IndexedDB-helyreállítás 1 óráig él. A Firestore `private/tracking` csak
  ritkított, másik eszközös előnézet: `recording`/`paused` esetén legfeljebb
  1 óráig látható, `finished` esetén soha; bezárása a nyomot és a statisztikát
  is eltünteti. A későbbi Pro tartós folytatás külön felhős séma lesz.
- A helyi restore a `recording` checkpointot az utolsó `savedAt` időponttól
  szünetelteti, ezért az app bezárása és újranyitása közötti idő nem számít
  bele utólag a mozgásidőbe.
- Éles, csak olvasó audit az `agerivagyok@gmail.com` (`geri`) fiókon: egyetlen
  `private/tracking` dokumentum volt, `finished`/`walk`, 173,87 m, 2:37,
  32 eredeti pont, `updatedAt=2026-08-22T13:32:51.003Z`. Ez nem folytatható
  félbehagyott út volt, hanem a régi kliens által korlátlan ideig kirajzolt
  befejezett snapshot. Adatbázis-írás nem történt.

### Specifikáció

Frissült a `docs/README.md`, `01-kepernyoterkep.md`,
`02-funkcionalis-spec.md` és `06-architektura-es-admin.md`: a profilfülek,
küldetésbemenetek, mentett küldetések helye, útvonalminőség és tracking
színszemantika most egyezik a kóddal. A spec verziója V0.4, 18 rögzített
döntéssel.

## BÖNGÉSZŐS ELLENŐRZÉS

Helyi emulátoros környezetben, `geri@grundo.local` fiókkal:

- profil TOP 3 rivális: zöld;
- Riválisok fül, kereshető 4 sor: zöld;
- világos/sötét téma: zöld;
- hat profilfül és route-jaik: zöld;
- idő/távolság küldetés-űrlap: zöld;
- tracking hexagon kapcsoló ARIA-állapota: zöld;
- 390×844 nézet, touch/mouse vízszintes görgetés: zöld.
- Küldetések, Riválisok és Badgek valódi linkes átkattintása: zöld.
- Sticky fejléc 700 px görgetés után is `top: 0`: zöld.
- Tracking vezérlők: 40×40 px, 8 px rés, fekete hexagongomb, egyetlen SVG-path:
  zöld; kapcsolás és 3D-állapot újratöltése: zöld.

A #10 által indított Vite folyamat leállt. A már a menet elején is futó Firebase
emulátor és 8080-as backend nem ehhez a menethez tartozott, ezért érintetlenül
maradt.

## TELEPÍTÉS

A commit **frontend + backend** telepítést igényel. Ezután külön adatbázislépés
a rivális backfill alkalmazása; Firestore-szabály- vagy indexmódosítás nincs.
A push, backfill és telepítés Geri feladata.

A 2026-08-23-i első backend Cloud Build (`f18cd9ec-…`) még a fordításnál
megállt, mert a Dockerfile nem másolta be a backend értesítései által használt
közös `src/lib/format.ts` fájlt. A Docker build-kontextus javítva; az elhasalt
build nem hozott létre új Cloud Run-revíziót, ezért biztonságosan újraindítható.

## NYITOTT KISEBB ÜGYEK

- A Statisztika és Klánok fül csak előkészített üres állapot; külön következő
  funkciómenet kell hozzájuk.
- A küldetés irány/cél választását és a 2026-08-23-án szigorított rövidkerülő-
  kaput valós Mapbox-tokenes generálással érdemes még több városrészben
  megmérni; a szerződés és a szintetikus alaktesztek működnek, de a
  route-minőség földrajzfüggő.
- A Mapbox production chunk továbbra is 521,57 kB gzip; ismert korábbi ügy.
- A Profil főoldalán a jelvény-előnézet egyelőre megmaradt a Badgek fül mellett
  is. Később eldönthető, hogy rövid preview maradjon vagy teljesen költözzön ki.
- A rivális badge neve és jutalom-GP-je még döntésre vár; a backfill csak ezután
  kapja meg a visszamenőleges badge-kiosztást.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Sonnet, normál mélység** elég a Statisztika/Klánok következő UI-menetéhez.
Valós útvonalminőség további hangolásához viszont **Opus/Sol emelt mélység**
indokolt, mert mért, földrajzfüggő algoritmusmunka.
