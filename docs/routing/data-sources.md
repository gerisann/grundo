# GRUNDO Route Intelligence — adatforrások és Mapbox-költségek

**Státusz:** forrásjegyzék és vizsgálati terv · 2026-09-10

**Fontos:** egy forrás felsorolása nem jelent automatikus felhasználási jogot vagy megfelelő minőséget.

## Forrásjegyzék

| Forráscsoport | Tervezett szerep | Első lépés | Fő kockázat |
|---|---|---|---|
| OpenStreetMap | úthálózat, hozzáférés, úttípus, burkolat, világítási és keresztezési tagek | meglévő GraphHopper-import bővítése | hiányos és területenként eltérő tagek |
| Digitális domborzatmodell | magasság, átlagos/maximális lejtés, emelkedés/ereszkedés | egy forrás licenc- és pontossági próbája Budapest körül | felbontás, hidak/alagutak, licenc |
| PZU/partneradat | partneri útminőség vagy kockázati jel | szerződéses mezőlista és mintafájl | szemantika, lefedettség, továbbfelhasználás |
| Budapest/Főváros zajadata | nappali/éjszakai zajbecslés | nyíltadat- és licencellenőrzés | ritka frissítés, raszter felbontása |
| BKK/Budapest Közút | forgalom, lezárás, esemény, keresztezési környezet | elérhető API-k és szerződési feltételek felmérése | eltérő frissesség és hozzáférés |
| Baleseti statisztika | közlekedési kockázati jel, aggregáltan | térbeli/időbeli aggregálhatóság vizsgálata | nem személyes közbiztonsági adat; torzítás |
| Mapillary | képi ellenőrzés, világítás/burkolat validálási minta | felhasználási és származtatási feltételek ellenőrzése | lefedettség, képkor, újraközlés |
| GRUNDO közösségi jelzés | útszakaszra adott friss tapasztalat | meglévő visszajelzés aggregációs terve | manipuláció, kis elemszám, adatvédelem |
| Strava Metro vagy hasonló | opcionális népszerűségi/használati jel | üzleti és licencvizsgálat | nem egyenlő biztonsággal; költség |

## Preferenciaszűrő: mit tudunk ténylegesen alátámasztani? *(2026-09-11)*

| Felhasználói igény | Első használható forrás | Első kiadás | Korlát |
|---|---|---|---|
| Sík / Dombos | Copernicus DEM GLO-30 + GraphHopper elevation | **igen, PoC után** | a 30 m-es DSM hidaknál, épületeknél és rövid rámpáknál külön validálandó |
| Kerékpáros infrastruktúra | OSM `cycleway`, `highway=cycleway`, `bicycle`, `segregated` | **igen** | címke-lefedettség és sáv/út minősége területenként eltér |
| Jó burkolat | OSM `surface`, `smoothness`, `tracktype`, mód-specifikus surface tagek | **igen, lefedettséggel** | a burkolat anyaga nem mindig azonos az aktuális állapotával |
| Jobban kivilágított | OSM `lit` és keresztezési tagek | **óvatosan** | a hiányzó `lit` nem jelenti, hogy nincs világítás; erős állítás nem tehető |
| Kevesebb forgalmas keresztezés | OSM csomópont, útkategória, jelzőlámpa és crossing tagek | **igen, proxyként** | valós forgalmi intenzitás nélkül ez közlekedési konfliktusbecslés |
| Zöldebb | OSM `leisure`, `landuse`, `natural` és fa/zöldterület-közelség | **igen, proxyként** | a zöldterület közelsége nem bizonyít árnyékot vagy jó levegőt |
| Csendesebb | OSM útkategória mint gyenge proxy; később Budapest stratégiai zajtérkép | **először árnyékmódban** | a hivatalos zajtérkép lassan frissül és gépi GIS-hozzáférése/licence még döntési kapu |
| Kedvelt / kerülendő | GRUNDO saját szakasz-visszajelzés és aktivitáselőzmény | **igen** | minimum elemszám, időbeli halványítás és manipulációvédelem kell |
| Felfedező | saját korábbi aktivitások H3-cellái + irányítottél-átfedés | **igen** | az új szakasz nem automatikusan jobb vagy biztonságosabb |
| „Biztonságos” | nincs egyetlen hiteles forrás | **nem ilyen néven** | csak külön közlekedési dimenziók és bizonytalanság mutatható |

### Forrásdöntések

- **OpenStreetMap az elsődleges hálózati adat.** Ugyanaz a forrás táplálja a
  GraphHopper-gráfot, ezért a `cycleway`, `surface`, `smoothness`, `lit` és
  crossing jellemzők verziózottan, útélen/csomóponton pontozhatók. Dokumentáció:
  [cycleway](https://wiki.openstreetmap.org/wiki/Key:cycleway),
  [surface](https://wiki.openstreetmap.org/wiki/Key:surface),
  [smoothness](https://wiki.openstreetmap.org/wiki/Key:smoothness),
  [lit](https://wiki.openstreetmap.org/wiki/Key:lit),
  [crossing](https://wiki.openstreetmap.org/wiki/Key:crossing).
- **A BKK kerékpárforgalmi főhálózati terve ellenőrzési és tervezési referencia,**
  nem automatikusan frissülő routing feed. A konkrét infrastruktúra első
  gépi forrása ezért OSM; a BKK anyag külön licenc- és formátum-PoC után lehet
  validáló réteg. Forrás: [Kerékpárforgalmi főhálózati terv (2022)](https://bkk.hu/downloads/19660/).
- **A Google Maps nem kerül a GRUNDO pontozó adatbázisába.** A tartalom tömeges
  kinyerése, tartós gyorsítótárazása és nem Google-térképpel való használata
  korlátozott; a GRUNDO Mapboxot és saját GraphHoppert használ. A Google legfeljebb
  kézi, nem betanító/deriváló összehasonlítási referencia lehet, külön jogi
  ellenőrzéssel. Forrás: [Google Maps Platform feltételek](https://cloud.google.com/maps-platform/terms/maps-service-terms/).
- **Domborzati PoC első jelöltje a Copernicus DEM GLO-30.** Világszintű 30 m-es
  adat, letölthető és adaptálható, kötelező forrásmegjelöléssel; 2026 júliusától
  a hozzáférési kategóriát/regisztrációt is ellenőrizni kell. Forrás:
  [Copernicus DEM](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM).
- **A budapesti stratégiai zajtérkép alkalmas lehet lassan változó háttérrétegnek,**
  de nem élő zajmérés. Az import előtt géppel letölthető raszter/WMS, licenc,
  referenciaév és nappali/éjszakai rétegek külön igazolandók a
  [Budapest Térinformatikai Portálon](https://geoportal.budapest.hu/).

Az esti „jobban kivilágított” ajánlás első verziója OSM-jelből és annak lefedettségéből indulhat, de nem állíthatja tényként, hogy egy utca biztonságos. A baleseti, forgalmi és közösségi adatok külön dimenziók maradnak; nem mossuk őket egy bizonyíthatatlan „biztonság” mezőbe.

## Feldolgozási és frissítési szerződés

Minden forrásadapter kimenete tartalmazza:

- a forrás és licenc stabil azonosítóját;
- a letöltés, a megfigyelés és — ha értelmezhető — a lejárat idejét;
- a lefedett területet és a nyers checksumot;
- a normalizáló kód verzióját;
- a mezők mértékegységét, jelentését és bizonytalanságát;
- az üres, hibás vagy késő adat kezelését.

A frissítési gyakoriság nem egységes konstans. Statikus DEM, lassan változó zajtérkép, rendszeresen frissülő OSM és perces eseményadat külön szolgáltatási osztályt kap. Az ütemezés csak a forrás valós frissülésének és a feldolgozási költségnek a mérése után rögzíthető.

## Kiadási kapu

Egy új `RouteDataVersion` csak akkor aktiválható, ha:

1. minden kötelező snapshot letölthető és checksum alapján azonosítható;
2. a séma- és tartományellenőrzés lefutott;
3. az úthálózat járhatósági és összefüggőségi regressziója nem romlott elfogadhatatlanul;
4. a rögzített útvonal-korpuszon a táv, emelkedés, manőverek és minőségi bontás összehasonlítása elkészült;
5. a licenc- és eredetmanifest teljes;
6. a gráf egészségellenőrzése sikeres, és az előző verzió visszaállítható.

## Mapbox: határok és költség

Az alábbiak a 2026-09-10-én ellenőrzött publikus listaárak és limitek. Éles költségbecslés előtt a GRUNDO Mapbox-fiók tényleges havi használatát és szerződését is meg kell nézni.

| Termék | Ingyenes havi sáv | Első fizetős sáv | Releváns limit/megjegyzés |
|---|---:|---:|---|
| Mapbox GL JS | 50 000 map load | 5 USD / 1 000 map load | minden új `Map` inicializálás map load; ezért nézetváltáskor nem remountolunk |
| Static Images API | 50 000 kérés | 1 USD / 1 000 kérés | a küldetéskártyák előnézete használja |
| Directions API | 100 000 kérés | 2 USD / 1 000 kérés | legfeljebb 300 kérés/perc és 25 waypoint; a `steps=true` ugyanabban a válaszban ad manővereket |
| Navigation SDK v3 metered trips | 100 MAU + 1 000 trip | 0,30 USD/MAU + 0,08 USD/trip | a térképhasználat külön is számlázódhat |

Hivatalos források:

- [Mapbox pricing](https://www.mapbox.com/pricing)
- [Directions API dokumentáció és limitek](https://docs.mapbox.com/api/navigation/directions/)
- [Navigation SDK for Android pricing guide](https://docs.mapbox.com/android/navigation/guides/pricing/)

### Következtetés a GRUNDO-ra

- Az access token hitelesítő adat, nem fogyó „token”. A számlázás map load, API-kérés, MAU és trip alapján történik.
- A Mapbox Navigation SDK bevezetése nem szükséges a kívánt könnyű navigációhoz, és külön használatalapú költséget hozna.
- A GraphHopper elsődleges útvonalmotor marad. A manővereket a saját GraphHopper ugyanabban az útvonalválaszban adja; a Mapbox fallback a Directions `steps=true` mezőjét használja, külön kérés nélkül.
- A készülékirány, a helyi útvonalhaladás, a következő kanyar és az ETA számítása nem generál Mapbox API-kérést.
- A két rögzítési nézet egyetlen élő térképpéldányt használ, ezért a váltás nem okoz új Mapbox map loadot.
- A bővítés várható közvetlen Mapbox-költsége így közel nulla, de ezt csak a Mapbox dashboard map load-, Static Images- és Directions-mérése igazolhatja.

## Kötelező forrás-PoC eredménye

Minden új adatforrásról rövid döntési lap készül: minta, lefedettség, frissesség, licenc, mezőtérkép, tárolási méret, importidő, útvonalra vetítési hiba, ismert torzítás, becsült havi költség és `beépít / később / elvet` döntés. Enélkül az adat nem kerülhet éles pontozásba.
