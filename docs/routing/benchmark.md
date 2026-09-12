# Route Intelligence mérési korpusz

**Korpusz:** `budapest-v1` · **mérő:** `server/src/scripts/benchmarkRoutes.ts`

## Cél

A mérő ugyanazt a `planMissionLoop` belépési pontot hívja, mint a Küldetések
API. Nem ír Firestore-ba és nem igényel felhasználói adatot. A 12 rögzített
budapesti eset lefedi a gyaloglást, futást és kerékpárt, a sík és dombos
környezetet, valamint az egyszerű és összetett csomópontokat.

Az eredmény esetenként rögzíti:

- a teljes válaszidőt és a GraphHopper/Mapbox kérések számát;
- a fallback megkísérlését és sikerét;
- a három kívánt egyedi jelölthöz képesti jelölthiányt;
- a táveltérést, U-fordulókat, rövid kitérőket és egyenes szakaszokat;
- a manőverek számát, utcanév-lefedettségét, sorrendjét és vonallánctól mért
  legnagyobb pozícióhibáját;
- az alternatívák páronkénti, irányérzékeny élátfedését a rövidebb útvonal
  hosszának arányában.

A koordináták öt tizedesre kerekítése körülbelül méteres azonossági küszöböt
ad. Az ellenkező irányban bejárt szakasz nem számít átfedésnek. Az emelkedés
jelenleg szándékosan `elevationAvailable: false`, mert a GraphHopper-kérés még
`elevation: false`; a DEM-fázis ezt ugyanebben a sémában bővíti.

## Futtatás

Helyi GraphHopperrel, a `server/` mappából:

```powershell
$env:GRAPHHOPPER_URL = 'http://127.0.0.1:8989'
npm run benchmark:routes -- --warmup --graph-version=gh11-osm-2026-08-28-8e68f202bd225c65 --output=../tmp/route-benchmark.json
```

Verziózott alapvonal csak ismert gráfból készüljön. Az output neve tartalmazza
a korpusz és a gráf verzióját; összehasonlításkor a `schemaVersion`,
`corpusVersion`, `graphVersion` és `gitCommit` mezőt együtt kell kezelni.
Az opcionális `--warmup` egy nem mért első esetet futtat, hogy a Java JIT és
a gráf első hozzáférése ne torzítsa a válaszidő-alapvonalat.

## Értelmezés

- A `candidateShortfall` a három kívánt egyedi alternatíva és a ténylegesen
  visszaadott jelöltek különbsége; hálózati kérésvesztést és geometriai
  duplikációt egyaránt láthatóvá tesz.
- A fallback csak akkor „használt”, ha GraphHopper-kísérlet után Mapbox-kérés
  történt és abból legalább egy jelölt visszatért.
- A korpusz `terrain` és `junctions` címkéje lefedettségi kategória, nem mért
  minőségi állítás.
- A baseline összehasonlítási pont, nem automatikus kiadási kapu. Küszöb csak
  több futás és készülékes/terepi validálás után vezethető be.

## Első alapvonal — 2026-09-11

Forrás: [`budapest-v1-gh11-osm-2026-08-28.json`](baselines/budapest-v1-gh11-osm-2026-08-28.json).
A helyi GraphHopper 11 gráf OSM-adatdátuma 2026-08-28 20:20:46 UTC, a forrás
PBF SHA-256 értékének eleje `8e68f202bd225c65`.

| Metrika | Eredmény |
|---|---:|
| Sikeres eset | 12 / 12 |
| Egyedi jelölt | 24 / 36 kívánt |
| Fallback-kísérlet | 0 |
| Medián / p95 válaszidő | 70,9 / 158,2 ms |
| Átlagos abszolút táveltérés | 11,45% |
| Átlagos manőverszám | 58,17 |
| Utcanévvel ellátott köztes manőver | 29,11% |
| Átlagos / legnagyobb irányítottél-átfedés | 64,20% / 85,57% |

A geometriák két egymást követő teljes futásban mind a 12 esetnél azonosak
voltak. A legnagyobb táveltérés a Margitsziget eset egyik jelöltjén 77,2%; a
két margitszigeti jelölt átlaga 47,55%. Ez már látható kiinduló anomália, de a
korpusz önmagában még nem indokol súly- vagy küszöbmódosítást.

## Hol megy el az idő — 2026-09-12

A fenti alapvonal **egy irányt** mér. Ez a mérés a TELJES tervezési láncot
futtatta le úgy, ahogy a `/api/missions/generate` teszi: 8 irány × 3 mag, majd
az önkalibráló második menet, végül a hat legjobb jelöltre a
`shapeCandidateCells` geometria. Helyi GraphHopper, fejlesztői gép, meleg JIT.

| Eset | GraphHopper (mindkét menet) | Alakmérés | **Geometria (6 jelölt)** | Teljes |
|---|---:|---:|---:|---:|
| séta 4 km | 575 ms | 88 ms | 405 ms | 1,1 s |
| futás 7,5 km | 844 ms | 135 ms | 950 ms | 1,9 s |
| futás 10 km | 265 ms | 171 ms | 451 ms | 0,9 s |
| bringa 20 km | 790 ms | 439 ms | **8 056 ms** | 9,3 s |
| bringa 25 km | 1 149 ms | 607 ms | **7 721 ms** | 9,5 s |
| bringa 40 km | 614 ms | 790 ms | 2 101 ms | 3,5 s |
| bringa 60 km | 1 751 ms | 3 413 ms | **34 747 ms** | 39,9 s |

**Nem az útvonaltervező a lassú.** A GraphHopper minden hosszon 0,3–1,8 s. A
drága fél a bezárt cellahalmaz kiszámítása (`detectLoopsDetailed` flood fill):
egy 24 km-es jelölt 22 641 cellát zár be, és egymaga 2,7 s — nagyjából
120 µs/cella.

Az idő nem a hosszal arányos, hanem a **bezárt területtel és a kontaktfoltokkal**:
a 40 km-es eset gyorsabb, mint a 25 km-es, mert keskenyebb köröket adott.

Élesben ehhez jön, hogy a `grundo-api` Cloud Run szolgáltatásnak nincs `--cpu`
kapcsolója (`cloudbuild.yaml`), tehát 1 vCPU-n fut, a geometria pedig egy szál
és CPU-kötött. A GraphHopper `--min-instances=0`, tehát hidegen további 8–15 s.

A mérésből következő irány: [`route-library.md`](route-library.md).
