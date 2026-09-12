# GRUNDO Route Intelligence — megvalósítási terv

**Státusz:** végrehajtható tervezet · 2026-09-10

## Végrehajtási elvek

- A meglévő GraphHopper- és Küldetések-folyamatot bővítjük, nem írjuk újra egyszerre.
- Az API-bővítések visszafelé kompatibilisek; a szabad rögzítés nem függhet az útvonalrendszertől.
- Új súly, küszöb vagy GP-szorzó csak mérésből kerülhet élesbe.
- A minőségi mutatók külön jelennek meg, saját lefedettséggel; nincs bizonyíthatatlan egyetlen „biztonsági pontszám”.
- Minden fázis önállóan kiadható és visszaállítható.

## Fázisok

### 0. Szerződések és mérési alap

**Cél:** az útvonalterv, manőver, adatverzió, domborzat és rögzítési szándék sémájának rögzítése.

- TypeScript/API-sémák és verziózás.
- Rögzített budapesti tesztkorpusz: gyalogos, futó és kerékpáros, sík és dombos, egyszerű és összetett csomópontokkal.
- Alapmetrikák: válaszidő, fallback, jelöltkiesés, útvonaltáv, emelkedés, manőverhely, alternatívák átfedése.
- Mapbox dashboard jelenlegi map load, Static Images és Directions alapvonalának rögzítése.

**Kilépési feltétel:** a sémák jóváhagyottak, ugyanaz a korpusz automatikusan újrafuttatható, és van összehasonlítható kiinduló mérés.

### 1A. Manőveres útvonalválasz

- A GraphHopper-kérésben `instructions: true`; a Mapbox fallbackben `steps=true`.
- A két motor válaszának közös, szemantikus `RouteManeuver` modellre normalizálása.
- Magyar szöveg előállítása a kliensen, nem a motor nyers mondatainak tárolása.
- A kiválasztott útvonal tartós csomagjának verzióbővítése geometriával és manőverekkel.
- API-, normalizáló- és helyreállítási tesztek.

**Kilépési feltétel:** a tesztkorpuszon a következő manőver típusa, helye és utcanév-kezelése ellenőrzött; régi kliens továbbra is megkapja a geometriát.

### 1B. Domborzat és útvonalprofil

- DEM-forrás PoC és licencdöntés.
- A helyi és Cloud Run GraphHopper-konfiguráció azonos elevation beállítása.
- Irányfüggő átlagos/maximális lejtés bekapcsolása, új gráf build.
- Útvonalválasz: emelkedés, ereszkedés, profil, meredek úthányad.
- Sík/Kiegyensúlyozott/Dombos preferencia a jelöltgenerálásban és rangsorban.
- Teljesített aktivitás szerveroldali DEM-újraszámítása és GP-árnyékmérés.

**Kilépési feltétel:** a sík és dombos tesztutak sorrendje a választásnak megfelelően változik, az emelkedés reprodukálható, GP-t pedig még nem módosít.

### 1C. Könnyű navigáció és rögzítési nézetek

- `RecordingIntent` bevezetése a szabad és vezetett indítás elkülönítésére.
- Helyi `RouteProgressEngine`: vetítés, haladás, következő kanyar, hátralévő táv, ETA, eltérésjelzés.
- Natív `DeviceHeading` plugin iOS-re és Androidra; GPS course/szenzor fúzió.
- Egyetlen `MapView`, két megjelenítési mód:
  - **GRUNDO:** cellák és statisztika, halvány útvonal, egysoros navigáció;
  - **Navigáció:** útvonal és irány dominál, nagy következőmanőver-kártya, hátralévő/megtett táv és ETA.
- A statisztikapanel összecsukása; szünet/befejezés mindkét nézetben mindig elérhető.
- Aktív vezetési csomag és nézet helyreállítása WebView-újraindulás után.
- Első kiadásban eltérésjelzés + kézi újratervezés.

**Kilépési feltétel:** szabad indításkor nincs navigációs UI; vezetett indítás Navigáció nézetbe érkezik; a GRUNDO nézet egysoros utasítása működik; a nézetváltás nem hoz létre új Mapbox map loadot és nem szakítja meg a rögzítést.

### 1D. Útvonalpreferencia-szűrő és konfliktusmodell *(külön feladat, 2026-09-11)*

**Cél:** a felhasználó egyszerű kapcsolókat lásson, miközben a szerver egyértelmű,
verziózott és az elérhető adatokkal igazolható tervezési szándékot kap. A címkék
munkaanyagok, nem végleges termékígéretek.

A felület három, eltérő jelentésű szintet kezel:

1. **Elsődleges stratégia — pontosan egy választható:**
   - `Kiegyensúlyozott`;
   - `Nyugodtabb` — zaj, útkategória és forgalmi konfliktusok súlyozott csökkentése;
   - `Védettebb` — kevesebb nagy forgalmú út és kellemetlen keresztezés,
     bringán védettebb infrastruktúra előnyben;
   - `Felfedező` — korábban nem járt szakaszok és alacsony átfedés előnyben.
2. **Terep — pontosan egy választható:** `Sík · Kiegyensúlyozott · Dombos`.
3. **Kombinálható útjellemzők:** `Csendesebb`, `Zöldebb`, `Jobb burkolat`,
   `Jobban kivilágított`, `Kevesebb forgalmas keresztezés`, kerékpárnál
   `Védett kerékpáros infrastruktúra`, valamint saját adatokból
   `Kedvelt szakaszaim előnyben` és `Nem kedvelt szakaszaim kerülése`.

Konfliktuskezelés:

- az elsődleges stratégiák rádióválasztók, ezért egymást automatikusan leváltják;
- a `Sík` és `Dombos` ugyanennek megfelelően nem lehet egyszerre aktív;
- a `Felfedező` kikapcsolja a `Kedvelt szakaszaim előnyben` kapcsolót, mert az
  egyik új, a másik már ismert útszakaszokat kér;
- a kerékpáros infrastruktúra csak `bike` módban jelenik meg;
- a világítási preferencia nappal elrejthető vagy esti ajánlásként magyarázható;
- a többi jellemző nem kemény kizárás: együtt is választhatók, a lefedettségük
  és a kerülő mértéke látható marad;
- ismeretlen adat nem számít rossz útnak, és nem teljesítheti bizonyítatlanul a
  kiválasztott igényt sem.

A `Legrövidebb` és `Gyors` nem kerül be a jelenlegi körútvonalas felületre:
idő- vagy távcélnál a kívánt hossz már bemenet. Ezek csak egy későbbi A→B
tervezőben értelmezhetők külön stratégiaként. A `Legbiztonságosabb` felirat
helyett `Védettebb` használható, mert a rendelkezésre álló adatok közlekedési
kitettséget becsülnek, személyes biztonságot nem garantálnak.

**Megvalósítási sorrend:** először statikus UI- és kérésmodell PoC, utána OSM +
saját előzmény alapú árnyékrangsor, végül csak sikeres forrás-PoC után zaj- és
forgalmi dimenzió. A kapcsoló csak akkor válhat éles ígéretté, ha a válaszban a
dimenzió lefedettsége és magyarázata is megjelenik.

**Kilépési feltétel:** a konfliktusmátrix determinisztikus és tesztelt; minden
látható opcióhoz van aktív adatforrás vagy őszinte „kevés adat” állapot; ugyanaz
a kérés ugyanazzal a `scoringModelVersion` értékkel reprodukálható.

### 1E. Útvonal-könyvtár *(új fő irány, 2026-09-12)*

**Cél:** minden egyszer már kiszámolt útvonal megmaradjon paraméterezve, hogy új
keresésnél azonnal legyen választék, miközben a friss generálás a háttérben fut.
Részletes terv: [`route-library.md`](route-library.md).

- Írási oldal: minden kiszámolt jelölt mentése; cellablob azokra, amelyekre a
  drága geometria már lefutott.
- Előtöltő script budapesti rajtpont-rácsra, hogy a könyvtár ne üresen induljon.
- Olvasási oldal: indexelt lekérdezés (`profile` + origó H3-cella + hossz-sáv),
  hasonlósági rangsor, és a mai birtokviszonnyal élő terület/GP-számítás.
- Felület: „Hasonló találatok”, a rajt távolságának kiírása, a friss ajánlatok
  utólagos beérkezése.
- Elavulás: `graphVersion` tárolása, újravalidálás vezetett rögzítés indítása
  előtt.

**Kilépési feltétel:** hosszú körnél a felhasználó 300 ms-on belül teljes értékű
kártyákat lát (terület és GP is), a friss generálás ugyanabban a nézetben
fut be, és minden kiszámolt jelölt visszakereshetően bekerült a könyvtárba. A
heti generálási keret csak a friss generálásra fogy.

### 1F. A→B tervező és kétoldali loop *(2026-09-12)*

**Cél:** a Rögzítés panelen a mozgásforma után `Barangolás | Útvonal` választás;
az `Útvonal` ágon cél megadása címmel vagy térképi pinnel, majd `Csak oda` vagy
`Oda-vissza` terv. Terv és mérés: [`point-to-point.md`](point-to-point.md).

- Geocoding-interfész (előre + fordított), első implementáció Mapbox; a tartós
  tárolás jogi kérdése az implementáció ELŐTT tisztázandó.
- A→B pont-pont útvonal a `directions.ts`-ben (ma csak `round_trip` van).
- Kétoldali loop: alapvonal → via-pont → odaút → visszaút → önellenőrzés.
- A kerülő mérete játékkonstans: ±500 m / ±1 km / ±2 km.
- Előnézet: rajt, cél, útvonal, táv, idő, elkülönülő oda/vissza, bezárt terület.
- `gyors · biztonságos · csendes` választó; a két utóbbi felirata csak adattal.
- Heti generálási keret ugyanaz, mint a küldetés-ajánlóé.

**Kilépési feltétel:** a generált oda-vissza útvonal a mért szabályokat teljesíti
(nincs értelmetlen visszafordulás, az oda- és visszaút élátfedése alacsony, a
teljes útvonal kört zár), a közlekedési szabályok sértetlenek, és ha nincs
értelmes megoldás, a felhasználó **őszinte nemleges választ** kap, nem rossz
útvonalat.

### 2. Első külső útminőségi adat

- PZU vagy a legjobb jogilag és technikailag elérhető egyetlen partnerforrás PoC-ja.
- Snapshot-adapter, normalizált szegmens-artefaktum, eredetmanifest és validálás.
- Verziózott GraphHopper-gráf build és kék/zöld aktiválás.
- Pontszám csak magyarázható bontással és lefedettséggel; először árnyékrangsor.

**Kilépési feltétel:** a régi és új rangsor korpuszon összehasonlítható, forráskimaradáskor az előző verzió marad aktív.

### 3. Stabil útjellemzők

- OSM burkolat, úttípus, hozzáférés, keresztezés, világítás és zöld környezet bővítése.
- Útszakasz- és csomópontbüntetések; hiányzó adat külön kezelése.
- Útvonalalternatívák sokfélesége irányítottél-átfedés alapján.
- Kártyánként minőségi bontás, lefedettség és leggyengébb szakasz jelzése.

### 4. Zaj, forgalom és esti mód

- Budapest zaj- és közlekedési források külön PoC-ja.
- Nappali/éjszakai érvényesség; esti profilban a világítás magasabb prioritása.
- Csak megfelelő lefedettségnél jelenhet meg erős állítás; különben „kevés adat” jelzés.
- Rövid életű lezárásokhoz opcionális overlay, teljesítményméréssel.

### 5. Közösségi visszacsatolás és GP-aktiválás

- Útszakasz-visszajelzések bizalmi, minimum-elemszámú és időben halványuló aggregálása.
- Manipuláció- és buborékhatás-mérés; nyers egyéni jel nem válik azonnal rangsorrá.
- Domborzati GP árnyékadat elemzése sporttípusonként.
- Verziózott GP-képlet, felső korlát és anti-cheat teszt csak külön jóváhagyással aktiválható.

## UX-elfogadási mátrix

| Eset | Elvárt eredmény |
|---|---|
| Közvetlen play gomb | szabad rögzítés, GRUNDO nézet, nincs üres/letiltott navigációs fül |
| Küldetés `Indítás most` | vezetett rögzítés, alapból Navigáció nézet |
| Átváltás GRUNDO nézetre | statisztikák és cellák dominálnak, az egysoros következő kanyar megmarad |
| Egysoros navigáció koppintása | teljes Navigáció nézet nyílik |
| Közelgő kanyar / útvonalelhagyás / érkezés | az egysoros jelzés ideiglenesen hangsúlyosabb lehet |
| Nézetváltás | nincs új térkép-inicializálás, GPS-szakadás vagy recorder-reset |
| Álló felhasználó | a készülék iránynyila natív headingből továbbra is értelmes |
| Útvonalelhagyás | a rögzítés folytatódik; GP/cellák a tényleges nyomvonalból; kézi újratervezés ajánlható |
| WebView újraindulás | a rögzítés és a vezetési csomag ugyanahhoz az aktivitáshoz visszaáll |
| Útvonal-szolgáltatás hibája | szabad rögzítés működik; vezetett módban a helyben tárolt útmutatás nem vész el |

## Készülékes ellenőrzés

- kis és nagy iPhone, valamint legalább két eltérő Android képarány;
- világos/sötét téma és nagyobb rendszerszöveg;
- gyaloglás, futás, bringa; álló helyzet, lassú indulás, éles forduló és párhuzamos utcák;
- háttérbe küldés, képernyőzár, WebView-újraindítás és engedélymegvonás;
- heading-pontosság mágneses zavar mellett, kalibrációs állapot megjelenítésével;
- map load számláló ellenőrzése ismételt nézetváltás közben.

## Első implementációs munkacsomag

1. Közös route API-séma és kompatibilitási teszt.
2. GraphHopper instructions + Mapbox fallback steps normalizálása.
3. Vezetési csomag tartós tárolása és migrációja.
4. `RouteProgressEngine` tiszta függvényként, rögzített GPS-sorozatos tesztekkel.
5. Tracking UI `RecordingIntent` és egy MapView-on belüli két nézete, benne a GRUNDO egysoros navigációval.
6. Natív heading bridge és készülékes mérési jegyzőkönyv.
7. Preferenciaszűrő statikus UX-prototípusa és konfliktusmodellje (1D); az
   útminőségi súlyozás csak a forrás-PoC-k után kapcsolható rá.

Ez a sorrend használható navigációs szeletet ad még az útminőségi adatpipeline elkészülte előtt, és nem köti össze idő előtt a játékszabályt a tervező bizonytalan adataival.
