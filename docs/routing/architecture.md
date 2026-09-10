# GRUNDO Route Intelligence — rendszerarchitektúra

**Státusz:** közös tervezési alap · 2026-09-10

**Hatókör:** útvonal-ajánlás, útminősítés, domborzat és könnyű navigáció

Ez a dokumentum a meglévő Küldetések → `Indítás most` folyamatot fejleszti tovább. Nem külön útvonaltervező alkalmazást ír le, és nem változtatja meg a területfoglalás H3/Firestore-alapú játékmotorját.

## Termékcél

A GRUNDO olyan séta-, futó- és kerékpáros útvonalakat ajánljon, amelyek a felhasználó választása szerint biztonságosabbak, csendesebbek, zöldebbek, kevésbé forgalmasak, kevesebb kellemetlen kereszteződést tartalmaznak, megfelelő a burkolatuk, illetve este jobban megvilágítottak. A rendszer nem adhat biztonsági garanciát: minden minősítés adatforráshoz, frissességhez és bizonytalansághoz kötött.

## Már elfogadott termékdöntések

- Kétféle rögzítés van:
  - **szabad rögzítés:** útvonalterv nélkül indul, csak GRUNDO nézettel;
  - **vezetett rögzítés:** kiválasztott útvonalból indul, alapból Navigáció nézettel.
- Vezetett rögzítéskor a **GRUNDO** és **Navigáció** nézet ugyanannak az aktivitásnak két megjelenése; a váltás nem indít új mérést.
- A GRUNDO nézetben vezetett rögzítéskor mindig megmarad az egysoros navigáció, például: `↱ 120 m · Bartók Béla út`.
- A Navigáció nézetben a térkép és a következő manőver dominál; a GRUNDO nézetben a statisztika és a cellák.
- A statisztikai panel összecsukható, de a szünet és a befejezés kritikus vezérlői mindig elérhetők.
- A tényleges GPS-nyomvonal határozza meg a GP-t és a cellafoglalást. A tervezett útvonal csak vezetés.
- Nézetváltáskor ugyanaz a `MapView` marad felcsatolva; csak a kamera, a rétegek és a rárajzolt panelek változnak.

## Meglévő kiindulópont

- A térképet Mapbox GL JS rajzolja.
- A körútvonalakat elsődlegesen a saját GraphHopper szolgáltatás generálja; a Mapbox Directions csak tartalék.
- A szerver több jelöltet kér, majd GRUNDO-specifikus minőségi és területi szempontok alapján rangsorol.
- A kiválasztott küldetés jelenleg főként vonalgeometriaként kerül a trackingbe.
- A térkép iránya jelenleg mozgásból számolt GPS-irányszög; álló helyzetben nincs megbízható készülékirány.
- A GraphHopper-kérések jelenleg nem kérnek navigációs utasításokat és magassági adatot.

## Célarchitektúra

```text
Külső források                 Verziózott feldolgozás
OSM · DEM · zaj · forgalom  ─▶ letöltés ─▶ normalizálás ─▶ validálás
világítás · partneradatok                                 │
közösségi jelzések                                       ▼
                                             kiadható RouteDataVersion
                                                        │
                             ┌──────────────────────────┴────────────┐
                             ▼                                       ▼
                 GraphHopper útgráf                      opcionális dinamikus overlay
            stabil/szakaszszintű tulajdonságok            rövid élettartamú események
                             │                                       │
                             └──────────── Route API ────────────────┘
                                                │
                                  jelöltek · pontszám · manőverek
                                  szintprofil · lefedettség · verzió
                                                │
                                                ▼
                              egy MapView + helyi RouteProgressEngine
                               GRUNDO nézet ⇄ Navigáció nézet
```

### Adatfrissítés

Az alkalmazás nem kérdezi le a Firestore-ból az út minden élét útvonaltervezés közben. A forrásokból verziózott pillanatkép készül, abból determinisztikus normalizálás és validálás után új GraphHopper-gráf épül. A kiadás csak teljes, ellenőrzött verzióra vált át; hibás frissítés nem írhatja felül az utolsó működő gráfot.

Az első változatban a stabil vagy lassan változó tulajdonságok kerülnek a gráfba. Rövid élettartamú lezárások és események csak későbbi, külön memóriában tartott, változatlan verziójú overlayként kerülhetnek be. A Firestore a felhasználói preferenciák, mentett útvonalak, közösségi visszajelzések és verziómanifeszt tárolója; nem tömeges útszakasz-adatbázis.

### Útvonaltervezési folyamat

1. A kliens elküldi a mozgásformát, idő- vagy távcélt, útvonal-karaktert, domborzati igényt és minőségi prioritásokat.
2. A GraphHopper több, járható jelöltet generál irányonként és seed szerint.
3. A Route API a szakasz-, csomópont- és fordulóadatok alapján pontoz, majd a túl hasonló alternatívákat irányítottél-átfedés alapján kiszűri.
4. A válasz a geometrián túl szemantikus manővereket, szintprofilt, minőségi bontást, adatlefedettséget és `routeDataVersion` értéket tartalmaz.
5. A kliens az aktív vezetési csomagot tartósan elmenti, hogy WebView- vagy alkalmazás-újraindulás után is folytatható legyen.

### Könnyű navigáció

Nem építünk teljes Google Maps-szerű rendszert és nem vezetjük be a Mapbox Navigation SDK-t.

- A `RouteProgressEngine` a GPS-pontot a kiválasztott útvonalra vetíti, monoton haladást tart fenn ésszerű visszalépési toleranciával, kiválasztja a következő manővert, és számolja a megtett/hátralévő útvonalhosszt.
- A `DeviceHeading` natív réteg iOS-en `CLHeading`, Androidon rotation vector/magnetométer alapján ad irányt. Mozgás közben a GPS course felhasználható, álló helyzetben a szenzor az elsődleges.
- A térképen látható nyíl képernyőhöz viszonyított iránya: `deviceHeading - mapBearing`.
- A `GuidancePresenter` ugyanabból az állapotból állítja elő a nagy navigációs manőverkártyát és a GRUNDO nézet egysoros utasítását.
- Az első verzió eltéréskor jelez és kézi újratervezést kínál. Automatikus újratervezés csak készülékes mérés után kerülhet be.

### Domborzat

- A GraphHopper-gráf ellenőrzött digitális domborzatmodellből kap magasságot és irányfüggő lejtést.
- A felhasználói választás első változata: **Sík · Kiegyensúlyozott · Dombos**.
- A Dombos mód célzónát keres; nem jutalmaz korlátlanul egyre meredekebb vagy veszélyesebb szakaszokat.
- Az útvonalválasz tartalmazza az emelkedést, ereszkedést, profilt és meredek szakaszok arányát.
- A teljesített aktivitás emelkedése szerveroldali DEM-mel újraszámolt tényleges nyomvonalból származik. A telefon zajos magasságadata és a tervezett útvonal nem lehet GP-forrás.
- A domborzati GP először árnyékmódban számolódik: az érték és a hipotetikus bónusz mérhető, de a kiosztott bónusz nulla, amíg a valós eloszlás és a visszaélési kockázat nincs megmérve.

## Hibakezelés és rendelkezésre állás

- Forráskimaradáskor az utolsó érvényes adatverzió marad aktív, látható frissességi jelzéssel.
- Ismeretlen minőségi adat nem jelent rossz utat; külön `unknown` és lefedettségi állapotot kap.
- A kliens a vezetett rögzítés teljes geometriáját és manőverlistáját helyben őrzi.
- Navigációs hiba nem állíthatja le a rögzítést.
- A szabad rögzítés útvonal-szolgáltatás nélkül is változatlanul működik.

## Megfigyelhetőség

Minden útvonaltervhez naplózandó a kérés típusa, a motor- és adatverzió, a jelöltek száma, a kiesési okok, a pontozási bontás, a lefedettség, a válaszidő és a fallback használata. Személyes GPS-adatot csak a meglévő adatvédelmi és privátzóna-szabályok szerint szabad tárolni.

## Nyitott döntési kapuk

- pontos DEM-forrás és licenc;
- a partner- és önkormányzati adatforrások elérhetősége, területi lefedettsége és frissítése;
- minőségi súlyok és kizárási küszöbök, valós útvonal-korpuszon mérve;
- domborzati GP képlete és felső korlátja az árnyékmérés után;
- automatikus újratervezés feltételei és gyakorisága készülékes próba után.
