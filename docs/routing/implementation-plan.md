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

Ez a sorrend használható navigációs szeletet ad még az útminőségi adatpipeline elkészülte előtt, és nem köti össze idő előtt a játékszabályt a tervező bizonytalan adataival.
