# GRUNDO — átadási napló

Ez a fájl az AKTUÁLIS állapotot mutatja. A történet a git logban van.

**Következő menet neve: GRUNDO #11.** A #10 menet lezárta a rivális felület
ellenőrzését, közös nevezőre hozta a küldetés-specifikációt és a kódot, valamint
elkészítette a profil új füles navigációját és a tracking kért térképi javításait.
A profilfülek utólagos vizuális és kattintási finomítása is elkészült.
Ezután lezárult a távolságalapú küldetés verziókompatibilitása, az abszolút
útvonal-tisztasági kapu, valamint a tracking térképvezérlőinek javítása.

## ÁLLAPOT

- Repo: `C:\Users\Geri\Documents\GitHub\grundo`
- Ág: `main`, az `origin/main` előtt 3 helyi committal.
- Unit tesztek: **386 zöld**, 112 emulátoros teszt a normál futásban kihagyva.
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

- `Riválisok`: működő, teljes kereshető lista.
- `Badgek`: a meglévő jelvénylista önálló füle; a régi `/profil/badges` cím
  kompatibilitási átirányításként megmaradt.
- `Statisztika`, `Klánok`: őszinte későbbi üres állapot, stabil route-tal.
- A Profil TOP 3 rivális-kártyájának „Összes” gombja a dedikált fülre visz.

### Rivális funkció lezárása

Az emulátoros seed most négy kétoldalú rivalitást is létrehoz. Böngészőben
ellenőrizve:

- TOP 3 profil-kártya valós adatokkal;
- teljes, kereshető riválislista;
- világos és sötét téma;
- üres és megjelenő állapot;
- a korábbi öt emulátoros tükörírás-teszt továbbra is zöld.

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
- Az útvonal „lábait” abszolút minőségi kapu fogja meg: detektált fölösleges
  U-fordulással rendelkező jelölt nem ajánlható. Inkább kevesebb tiszta
  küldetés jelenik meg. A viselkedést új unit tesztek rögzítik.

### Tracking térkép

- A fekete, üres hatszög ikon ki/be kapcsolja a teljes mezőréteget; a jobb
  alsó térképvezérlő-oszlopban, a 2D/3D gombbal azonos 40×40 px méretben van.
- A megjegyzett 3D állapot már a Mapbox konstruktorában 55°-os dőlést kap,
  ezért első betöltéskor sem tér el az ikon a tényleges kamerától.
- A küldetés szaggatott vezetővonala `#FA5F73`.
- Élő foglalás: új/megerősített mező lila, elrabolt mező `#FA5F73`.
- Az élő előnézet már a közeli birtok-pillanatképpel fut, és a friss mezőkön
  is az 1–5 várható védelmi szintet, illetve annak telítettségét mutatja.

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

A commit **frontend + backend** telepítést igényel. Firestore-szabály- vagy
indexmódosítás nincs. A push és telepítés Geri feladata.

## NYITOTT KISEBB ÜGYEK

- A Statisztika és Klánok fül csak előkészített üres állapot; külön következő
  funkciómenet kell hozzájuk.
- A küldetés irány/cél választását valós Mapbox-tokenes generálással érdemes
  még több városrészben megmérni; a szerződés és a fallback működik, de a
  route-minőség földrajzfüggő.
- A Mapbox production chunk továbbra is 521,57 kB gzip; ismert korábbi ügy.
- A Profil főoldalán a jelvény-előnézet egyelőre megmaradt a Badgek fül mellett
  is. Később eldönthető, hogy rövid preview maradjon vagy teljesen költözzön ki.

## MODELLJAVASLAT A KÖVETKEZŐ MENETRE

**Sonnet, normál mélység** elég a Statisztika/Klánok következő UI-menetéhez.
Valós útvonalminőség további hangolásához viszont **Opus/Sol emelt mélység**
indokolt, mert mért, földrajzfüggő algoritmusmunka.
