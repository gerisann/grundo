# GRUNDO A→B útvonaltervezés és kétoldali loop

**Státusz:** jóváhagyott terv, implementáció még nem kezdődött el · 2026-09-12

Funkcionális leírás: [`../02-funkcionalis-spec.md`](../02-funkcionalis-spec.md)
→ *Útvonaltervezés a rögzítés előtt*. Ez a dokumentum a **hogyan**.

## Alapelv

Ez **tervezési réteg a meglévő rögzítés előtt**, nem párhuzamos rendszer. A
kimenete ugyanaz a vezetett rögzítési csomag, amit ma a küldetés `Indítás most`
gombja állít elő — geometria + manőverek, `RecordingIntent: guided`.

## Mi van már meg

| Rész | Hol | Állapot |
|---|---|---|
| Vezetett rögzítés, Navigáció nézet, manőverek, ETA, eltérésjelzés | `TrackingScreen`, `MapView`, `src/game/routeProgress.ts` | kész |
| Útvonal átadása a rögzítésnek | `src/lib/ghostRoute.ts` | kész |
| Mentett útvonalak listája és indítása | `src/lib/savedRoutes.ts`, `SavedRoutesSheet.tsx` | **részben** — localStorage, max 20, `Mission`-alapú, névadás nincs |
| Mozgásforma- és háromállású választó | `OptionSwitch` | kész |
| Térképi marker és koppintás | `MapView` (`mapboxgl.Marker`, `on('click')`) | alap megvan |
| GraphHopper kérésenkénti egyedi súlyozással | `server/src/lib/directions.ts` | kész |
| Alakmérés: U-forduló, rövid kitérő, egyenesség | `src/game/routeShape.ts` | kész |
| Irányérzékeny élátfedés két útvonal között | `server/src/lib/routeBenchmark.ts` | kész (a #46 mérőpadból) |

## Mi hiányzik

1. **Geocoding** — a kódbázisban egyetlen sor sincs rá.
2. ~~A→B pont-pont útvonal~~ — **kész** (`planDirectRoute`, 2026-09-12).
3. ~~A kétoldali oda-vissza loop~~ — **kész** (`planTwoSidedLoop`, mérve lent).
4. **API-végpont és felület** — a motor megvan, a `POST /api/routes/plan` és a
   `Barangolás | Útvonal` választó még nincs.
5. **Szerveroldali mentett útvonalak** (ma eszközfüggő localStorage).

### Ami elkészült

| Modul | Mit ad |
|---|---|
| `src/config/gameplay.ts` → `ROUTE_DETOUR_OFFSET_M` | a kerülő mérete: ±500 m / ±1 km / ±2 km |
| `src/game/routeCorridor.ts` | köztes pont, előjeles oldaltávolság, oldalsáv- és kerülendő poligonok |
| `src/game/routeShape.ts` → `sharedPathRatio` | **irányfüggetlen** közös-szakasz mérés a két legre |
| `src/game/geo.ts` → `bearingDeg` | a `routeShape` privát másolata helyett közös |
| `server/src/lib/directions.ts` | `requestGraphHopperPath`, `planDirectMapbox` — pont-pont hívás |
| `server/src/lib/routePlan.ts` | `planDirectRoute`, `planTwoSidedLoop`, `measureLoopQuality` |

## Kézi próbapad — `routeLab`

⚠️ **Az útvonalak minőségét számokból nem lehet megítélni.** Mérve
(2026-09-12): a visszafordulás-szám három körön át javult, miközben a térképen
új hibák keletkeztek (hurkok, stégre kivezetés). A számok és a felhasználói
élmény elvált egymástól, és ez csak képekből derült ki.

Ezért van kézi próbapad: `server/src/scripts/routeLab.ts`.

```bash
# 1. GraphHopper, a graphhopper/ mappából
java -Xmx4g -jar graphhopper-web-11.0.jar server config-grundo.yml
# 2. a labor, a server/ mappából
npm run lab:routes
```

Utána `http://localhost:8787`. A térképen kijelölhető a rajt és a cél,
állítható a mozgásforma, az útvonaltípus, a kerülő mérete és a jelleg; a válasz
mellé kiírja a minőségi mutatókat is (visszafordulás, rövid kitérő, önmagába
visszatérés, közös szakasz, elért oldaltávolság, tervezési idő).

A laborban van címkereső autocomplete-tal (a találat a kijelölt ponthoz kerül),
letehetők köztes megállók, bekapcsolható a kerékpárút-preferencia, a
sík/dombos terepprofil, a magasság-színezés és a 3D nézet.

A geometria bekapcsolva a területet is **kirajzolja**: távolról ÖSSZEVONT
poligonként, közelről (15-ös zoomtól) cellahatárral és szintcímkével (1–5) —
ugyanaz a rétegzés, mint az appban egy lefutott aktivitásnál. A cellánkénti
poligon kizoomolva nemcsak fölösleges, hanem hibás is: a Mapbox a csempe
méretkorlátja fölött csendben eldob feature-öket (lásd `src/lib/hexAreas.ts`).

⚠️ **A TERÜLET NEM A MATERIALIZÁLT CELLÁK SZÁMA.** Nagy huroknál a motor
szándékosan nem bontja ki a belsőt res12 cellákra, hanem tömör parentekben
tartja. Ebből számolva a terület töredékét kapnánk — mérve, Kelenföld →
Normafa bringás kör: **1,498 km² helyett 8,901 km²** a helyes érték
(4 877 materializált cella helyett 28 985 res12-egyenértékű). A helyes szám a
`loopCellCount`-ból jön, és a tömör belső külön poligonként rajzolódik ki. A szint a körüljárásból jön
(`src/game/winding.ts`), szabad területet feltételezve.

A **birtokviszony külön kapcsoló**: ez az egyetlen pont, ahol a labor kilép a
saját folyamatából és a `grundo-db` grid blokkjait olvassa (írni nem ír).
Hitelesítés nélkül őszinte hibaüzenetet ad, nem üres eredményt — az utóbbi azt
sugallná, hogy az egész terület szabad.

⚠️ **A játékbeli geometria (bezárt terület, cellák, GP) külön kapcsolható, és
alapból KI van.** Ez a drága fél — 20–25 km-en 8 s, 60 km-en 35 s, lásd
[`benchmark.md`](benchmark.md). Amit a labor kiír, az **birtokviszony nélküli
felső határ**: a valódi GP függ attól, kié most a cella, azt csak Firestore-ból
lehet megmondani. A „Csak oda" útvonal itt is 0 cellát és 0 bezárást ad —
ugyanaz a motor mondja ki, amit a spec.

⚠️ **A terepprofil csak a HELYI gráffal működik** — a domborzat a
`config-grundo.yml`-ben van bekapcsolva, a Cloud Run konfigurációban nincs.
Mérve (Kelenföld → Normafa, bringa): `Sík` 15,49 km · `Kiegyensúlyozott`
10,14 km. A `Dombos` irány gyengébb (10,21 km), mert egy hegyre vezető
útvonal amúgy is emelkedik.

Nem része az éles kiszolgálónak: külön folyamat, nincs hitelesítés, nincs
kvóta, nem ír semmit.

## Mérés: megvalósítható-e a kétoldali loop *(2026-09-12, helyi GraphHopper 11)*

A kérdés az volt, hogy a kérésbe ágyazott `custom_model.areas` területi
súlyozással az egyenes két oldalára lehet-e terelni az odautat és a visszautat.

**Deák tér → Hősök tere (légvonal 2 568 m), gyalogos profil:**

| Próba | Táv | Átlagos oldaltávolság az A–B egyenestől |
|---|---:|---:|
| alap | 2 763 m | +30 m |
| bal oldal jutalmazva | 2 925 m | **+70 m** |
| jobb oldal jutalmazva | 3 108 m | **−128 m** |
| visszaút: odaút kikerülése pufferpoligonokkal | 3 233 m | −143 m |

**Deák tér → Flórián tér (légvonal 4 759 m), gyalogos profil:**

| Próba | Táv | Válaszidő |
|---|---:|---:|
| alap | 5 911 m | 155 ms |
| kis / közepes / nagy sáv jutalmazva | 6 325 / 6 225 / 6 225 m | 219–266 ms |
| visszaút, 4 poligon | 6 124 m | 229 ms |
| visszaút, 14 poligon | 6 377 m | 388 ms |
| visszaút, 27 poligon | 6 175 m | 557 ms |

### Amit ebből tudunk

- ✅ A GraphHopper 11 **elfogadja** a kérésbe ágyazott `areas`-t és az
  `in_<terület>` feltételt; a két irány tényleg ellentétes oldalra kerül. A
  funkció a meglévő motorral megépíthető, **új routing library nélkül**.
- ⚠️ **A kerülő méretét a jutalmazott sáv szélesítése NEM szabályozza.** A
  „közepes" és a „nagy" sáv ugyanazt az útvonalat adta: a router a megengedett
  sávon belül is a legolcsóbbat választja. A méretet **köztes ponttal** kell
  állítani.
- ⚠️ **A poligonszám ára mérhető:** 4 → 229 ms, 27 → 557 ms. A visszaút
  korlátját ritkán mintavételezve vagy egyetlen összevont korridor-poligonként
  kell építeni. *(Az egykorridoros változat még nincs megmérve.)*

## Mérés: a kész motor valódi budapesti párokon *(2026-09-12)*

7 pár × 3 kerülőméret, helyi GraphHopper 11, `server/src/lib/routePlan.ts`.

### Ami elsőre is jó lett

| Mutató | Eredmény |
|---|---|
| Sikeres kör | **21 / 21** |
| Két leg szétvált (ellentétes oldal) | **21 / 21** |
| Közös úton futás (irányfüggetlen) | **0,00–0,03** — gyakorlatilag nincs |
| Válaszidő | 0,5–1,7 s |

### Amit javítani kellett: a visszafordulások

Az első változat 21 esetre **110** visszafordulást adott. A kontrollmérés
megmutatta, hogy nem a súlyozás a hibás:

| Változat | Visszafordulás egy legben |
|---|---|
| **kontroll — közvetlen A→B, súlyozás nélkül** | **0–1** |
| csak oldalsáv | 0–3 |
| **csak köztes pont** | **2–4** |
| köztes pont + oldalsáv | 2–5 |
| + kérésbeli `turn_penalty` | 2–5 — **bitre ugyanaz, nem segít** |

A hibát tehát a köztes pont rákapcsolása okozza, nem a területi súlyozás. A
kérésbeli kanyarbüntetés mérhetően hatástalan, ezért nem azt hangoljuk.

**A megoldás ugyanaz az elv, mint a kör-motor több magjáé:** legenként több
köztes pontot kérünk le párhuzamosan, és a legkevésbé hibásat választjuk.

| Változat | Összes visszafordulás (21 eset) | Válaszidő |
|---|---:|---|
| egyetlen köztes pont | 110 | 0,2–1,0 s |
| 3 hely a tengely mentén | 90 | 0,3–1,0 s |
| **3 hely × 3 távolság (9 jelölt)** | **74** | 0,5–1,7 s |

Legenként ez 0–4 visszafordulás; a teljes körre mért szám ennél eggyel
magasabb, mert a célnál a megfordulás szerkezeti — oda-vissza útnál `B`-ben
meg KELL fordulni.

⚠️ **Elfogadási küszöb még nincs bevezetve.** A motor kiszámolja és visszaadja a
minőségi mutatókat, de nem utasít el belőlük: küszöböt csak több pár és valódi
terepi visszajelzés után szabad meghúzni.

## Az elágazási szabályok — súlyként, nem mohó bejáróként

*(Geri szabálylistája, 2026-09-12 — „súlyozva")*

A felhasználói szabályok (merre forduljak egy elágazásnál, mikor távolodjak a
tengelytől, mikor közeledjek) **NEM elágazásonként kiértékelt döntésként**
épülnek be, hanem költségként, amit a globális útvonalkeresés optimalizál.

⚠️ **Ez nem stílus kérdése.** A szabály úgy szól, hogy *„ha van később jobb
lehetőség a fordulásra, akkor el kell vetni és egyenesen kell tovább haladni"* —
ez ELŐRETEKINTÉS. Egy elágazásonként döntő, mohó bejáró elvileg sem tudja
betartani: nem ismeri a folytatást, zsákutcába futhat, és nem garantálja, hogy
`B`-be egyáltalán eljut. A Dijkstra viszont pontosan ezt számolja végig minden
lehetséges folytatásra. A mohó változat tehát ROSSZABB útvonalat adna.

Ami már eleve teljesül, külön munka nélkül:

| Szabály | Hol teljesül |
|---|---|
| szabályos-e arra fordulni; egyirányú utca, tiltott szakasz | a GraphHopper profil betartja (`turn_costs` bekapcsolva) |
| „sosem ugyanarra az útra visszafordítás" | `u_turn_costs` — gyalog 40, bringa 30 |
| gyors / biztonságos / csendes az elágazás után | `preferenceRules` (mechanizmus kész, adat hiányzik) |
| a cél felé haladás, későbbi jobb fordulási lehetőség | a globális útvonalkeresés optimálisan megoldja |

### A három zóna

A „mikor távolodj, mikor közeledj" szabály a kért kerülő körüli **sávként** épül
be, a helyes oldalon:

| Zóna | Hol | Súly | Jelentése |
|---|---|---|---|
| `reached` | a kért kerülő ±30%-a | 1,0 | elértük a távolságot, ez a jó hely |
| `approach` | a tengely és a kért kerülő 70%-a között | 0,6 | még nem vagyunk elég messze → távolodj |
| minden más | rossz oldal vagy túllőtt távolság | 0,3 | gyere vissza |

Egyik sem tiltás: ha az úthálózat mást nem enged (híd, folyó, vasút), a tervező
átléphet — a járhatóság előbbre való.

⚠️ A zónák a tengely **15–85%-a** között élnek. Az `A` és a `B` a tengelyen van;
ha a zóna a végpontokig érne, maga az indulás és az érkezés esne büntetett
területre, és a tervező a rajt körül kezdene kanyarogni.

### Mit adott a zónamodell

| Változat | Összes visszafordulás (21 eset) |
|---|---:|
| egyetlen köztes pont, egy széles oldalsáv | 110 |
| 3 köztes pont a tengely mentén | 90 |
| 3 hely × 3 távolság (9 jelölt) | 74 |
| **9 jelölt + három zóna** | **38** |
| + arányos kerülő-plafon, mindkét leg kerüli a gyors vonalat, gyalogos forgalmas-út büntetés | 56 |
| **+ `pass_through: true` a köztes pontnál** | **37** — az odaút 21-ből 18 esetben teljesen tiszta |
| + sétálótér tiltása bringának, `snap_prevention: pedestrian` | 36 |
| **+ `get_off_bike` büntetés (lépcső)** | **32** — a bringás esetek legnagyobb javulása |

⚠️ **A visszafordulás-szám önmagában félrevezet.** A `pass_through` a hibák egy
részét hurokká alakította, amit a `countUTurns` nem lát. A külön
`countSelfRevisits` mérték bevezetése után, azt a jelöltválasztás élére téve:
**26 → 14 visszatérés 42 legen**, és minden gyalogos eset tiszta lett. A
maradék a 27–29 km-es bringás köröké, ahol egyetlen jelölt sem hurokmentes.

Legenként jellemzően 0–1 visszafordulás. Ára: a válaszidő ~1–1,7 s (három
poligon és kilenc párhuzamos jelölt legenként).

### ⚠️ A zónasúlyozás NEM helyettesíti a köztes pontot

Megmértem köztes pont nélkül, csak a zónákkal: a kerülő mérete **nem
reagál**. Deák→Hősök tere kis, közepes és nagy kerülőre egyaránt 2,8 km-t és
40 m oldaltávolságot adott — vagyis pontosan a közvetlen útvonalat; Gellért→
Népliget mindháromra 234 m-t.

Az ok: a prioritás szorzó, nem kényszer. Egy 3,3-szoros büntetés a 2,8 km-es
közvetlen úton még mindig olcsóbb, mint egy 8 km-es kerülő a jutalmazott sávban.

**A két eszköz más munkát végez, és mindkettő kell:**

- a **köztes pont** adja a kerülő MÉRETÉT (kényszerített állomás);
- a **zónák** adják az ALAKJÁT: melyik oldalon, milyen távolságprofillal.

## A generálás menete

```
1. Alapvonal      A→B közvetlen útvonal — ez adja a referenciahosszt és az „oldal" tengelyét
2. Via-pont       a felezőpontból merőlegesen, a kerülő mérete szerint (±500 m / ±1 km / ±2 km)
3. Odaút          A→via→B, a bal oldal jutalmazásával
4. Visszaút       B→A, a jobb oldal jutalmazásával ÉS az odaút korridorjának büntetésével
5. Önellenőrzés   U-forduló, rövid kitérő, önmetszés, oda/vissza élátfedés, bezárt terület
6. Vagy őszinte nemleges válasz
```

A 2. lépés geometriája rokon a küldetésmotor `loopWaypoints` függvényével
(`src/game/missions.ts`) — érdemes onnan indulni, nem újat írni.

Az 5. lépés **nem új munka**: a szabálylista nagy része már mért mennyiség
(`countUTurns`, `countShortDetours`, `measureStraightness`, irányérzékeny
élátfedés). A bezárt terület a szokásos motorral jön (`buildActivityGeometry` →
`loopCells`) — de ⚠️ **ez a drága fél**, lásd
[`benchmark.md`](benchmark.md) → „Hol megy el az idő”.

A közlekedési szabályokat (egyirányú utca, tiltott szakasz) **nem nekünk kell
betartatni**: a GraphHopper profil eleve ezt teszi, és a `turn_costs` mindkét
profilon be van kapcsolva.

### Ha nem sikerül

Ugyanaz a diagnosztikai minta, mint a küldetés-ajánlóban (`no_routes` /
`no_fit` / `no_loops`): a szerver megmondja, **miért** nem lett útvonal, a
felület pedig ezt őszintén kiírja. Rossz, önmagába visszaforduló vagy
szabálytalan útvonalat nem adunk helyette.

## Profilok: gyors · biztonságos · csendes

A három állás **kérésenkénti custom model variáns** — a mechanizmus ugyanaz,
amit a „kanyargós / hosszú egyenesek" kapcsoló már használ.

- **gyors** — a mai alapsúlyozás.
- **biztonságos** és **csendes** — a mechanizmus most is megépíthető, de a
  felirat csak akkor lehet ilyen, ha van mögötte adat. Az OSM `road_class`,
  `cycleway`, `lit` és crossing tagek proxynak használhatók; a zaj csak a
  budapesti stratégiai zajtérkép licenc-PoC-ja után. Lásd
  [`data-sources.md`](data-sources.md) — és a `Védettebb` elnevezésről szóló
  döntést: **biztonságot nem ígérünk**.

## Geocoding — az egyetlen új külső képesség

Kell: **előre** (autocomplete) és **fordított** (pin → cím).

| Út | Előny | Kockázat |
|---|---|---|
| **Mapbox Geocoding / Search Box API** | ugyanaz a fiók, illeszkedik a térképhez | **külön termék, külön számlázás** — nem fér a mai map load keretbe; ⚠️ a feltételek korlátozzák a találat **tartós tárolását**, márpedig a mentett útvonalhoz a címet el akarjuk tenni |
| **Saját Photon/Nominatim** a meglévő `hungary-latest.osm.pbf`-ből | nincs kérésdíj, nincs tárolási korlát, van már OSM-kivonatunk | új konténer és üzemeltetés |

⚠️ **EGY MAPBOX-VÉGPONT NEM ELÉG** (mérve, 2026-09-12). A **Geocoding v6**
pontos névegyezést keres: a „deák tér" ezért csak a csepeli Deák teret találja
meg, a Deák **Ferenc** teret nem. A **Search Box forward** viszont helyneveket
és POI-kat is ad, és megtalálja — cserébe utcanevekre szűkszavúbb. A labor
ezért **mindkettőt lekérdezi**, koordináta szerint deduplikál, és a térkép
aktuális nézetéhez mért távolság szerint rendez. Így a „deák tér" első
találata 67 méterre van, nem 8 kilométerre.

**Javaslat:** a geocoding mögé **interfész**, az első implementáció Mapbox — de
a tartós tárolás jogi kérdését **tisztázni kell, mielőtt kódot írunk rá**. Ha a
korlát szorít, a mentett útvonal a koordinátát és a felhasználó saját nevét
tárolja, a címet nem.

Routing libraryre, geometriai libraryre (turf.js) vagy bármi másra **nincs
szükség**. ⚠️ A poligonszámítás itt **routing-súlyozás, nem területszámítás** —
a „poligon-algebra soha" szabály a területre vonatkozik, azt ez nem sérti.

## Játékszabályi következmények

- **A „Csak oda" útvonal nem zár kört, ezért nem ad területet**, csak a megtett
  táv utáni GP-t. A felületnek ezt indulás előtt ki kell mondania.
- **Az oda-vissza loop területet ad, és a kerülő mérete a terület mérete.**
  Ezért a ±500 m / ±1 km / ±2 km **játékkonstans**: a
  `src/config/gameplay.ts`-be tartozik, nem a logikába írt szám.
- **A heti generálási keret ugyanaz** (`FREE_ROUTE_GENERATIONS_PER_WEEK`), Pro
  előfizetéssel korlátlan. Enélkül a tervező megkerülné a küldetés-ajánló
  korlátját.

## Illeszkedés az útvonal-könyvtárhoz

Az itt generált útvonalak ugyanabba a könyvtárba kerülnek, mint a küldetés-
jelöltek — lásd [`route-library.md`](route-library.md). Egy A→B terv rekordja a
cél koordinátájával és a kerülő méretével bővül, így később ugyanoda tartó
felhasználónak azonnal felajánlható.

## Nyitott kérdések

- Az egykorridoros „kerüld az odautat" poligon nincs megmérve — ez dönti el,
  hogy hosszú útvonalon is használható-e a 4. lépés.
- A Mapbox geocoding tartós tárolási jogosultsága.
- A mentett útvonalak átköltöztetése localStorage-ból Firestore-ba (névadás,
  eszközök közti szinkron) — külön munkacsomag, a mai `savedRoutes.ts`
  interfésze eleve cserélhetőre készült.
- Mekkora bezárt területnél lép be a `LoopTooLargeError` — nagy kerülőnél ezt
  meg kell mérni.
