# Jelenlegi állapot

> Frissítve: **2026-09-12** · Menetszám: **#47 · lezárva**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **main** · funkció-HEAD: **3c92d4d**
> Utoljára dolgozott: **Claude (Opus, High)**
> Átadva: **Claude**

## Jelenlegi cél

Az **A→B útvonaltervező motorja (`1F`) kész és vizuális visszajelzés alapján
hangolt**, és van hozzá kézi próbapad. A következő lépés az **API-végpont és a
felület**: `POST /api/routes/plan`, majd a `Barangolás | Útvonal` választó a
Rögzítés panelen.

Spec: [`../02-funkcionalis-spec.md`](../02-funkcionalis-spec.md) → *Útvonaltervezés
a rögzítés előtt* · terv és mérések:
[`../routing/point-to-point.md`](../routing/point-to-point.md).

Nyitva marad az **útvonal-könyvtár** is
([`../routing/route-library.md`](../routing/route-library.md)): a küldetés-ajánló
lassúságára válasz, és a mérés szerint nem a GraphHopper a szűk keresztmetszet,
hanem a bezárt cellahalmaz kiszámítása.

## Elkészült

- **Tervezőmotor**: `planDirectRoute` (A→B, megállókkal) és `planTwoSidedLoop`
  (A→B→A kétoldali kör) a `server/src/lib/routePlan.ts`-ben; a tiszta geometria
  a `src/game/routeCorridor.ts`-ben.
- **Két új alakmérték** a közös motorban: `sharedPathRatio` (irányfüggetlen
  közös szakasz) és `countSelfRevisits` (önmagába visszatérés).
- **A kerülő mérete játékkonstans**: `ROUTE_DETOUR_OFFSET_M` ±500 m / ±1 km /
  ±2 km, a közvetlen táv 45%-ára vágva.
- **Kézi próbapad**: `server/src/scripts/routeLab.ts`, `npm run lab:routes`,
  `http://localhost:8787`. Címkereső (két Mapbox-végpont összefésülve),
  megállók, terep- és kerékpárút-preferencia, domborzat-színek, 2D/3D,
  geometria- és birtokviszony-kapcsoló, stopper, mentett pontkészletek.
- **Domborzat a HELYI gráfban** (`config-grundo.yml`: SRTM, `average_slope`),
  hogy a sík/dombos preferencia kipróbálható legyen.
- **Mérőpad** a `#46` menetből commitolva (`routeBenchmark.ts`,
  `benchmarkRoutes.ts`, budapesti fixture, verziózott baseline).

## Módosított fájlok

| Fájlcsoport | Állapot | Tartalom |
|---|---|---|
| `server/src/lib/routePlan.ts` + teszt | ÚJ | a kétoldali kör tervezője |
| `server/src/scripts/routeLab.ts` | ÚJ | kézi próbapad |
| `src/game/routeCorridor.ts` + teszt | ÚJ | köztes pont, zónák, kerülendő foltok |
| `src/game/routeShape.ts` + teszt | M +250/−10 | `sharedPathRatio`, `countSelfRevisits` |
| `server/src/lib/directions.ts` | M +110/−40 | pont-pont hívás, `snapped_waypoints`, `pass_through` |
| `src/config/gameplay.ts`, `src/game/geo.ts` | M +39 | kerülő-konstans, közös `bearingDeg` |
| `docs/02*`, `docs/routing/*`, `docs/ai/*` | ÚJ/M +420 | spec, terv, mérések, tartós döntések |
| `graphhopper/config-grundo.yml`, `README.md` | M +20 | helyi domborzat |
| `server/src/lib/routeBenchmark*`, `fixtures/` | ÚJ | a `#46` mérőpadja |

## Élesben fut / telepítetlen

- **Ebből a menetből semmi nincs telepítve.** A tervezőmotor csak a laborból
  hívható; API-végpont nincs, tehát a kliensek nem érik el.
- ⚠️ A domborzat **csak a helyi gráfban** van bekapcsolva. A
  `config-cloudrun.yml` szándékosan érintetlen: az éles DEM-forrás (licenc,
  frissítés, konténerméret) külön döntés.
- A `d2bdcd0` natív heading commitból továbbra sincs visszaigazolt
  iOS/Android készülékes build.

## Ellenőrzések

- `npm run test`: **959 zöld**, 181 skip.
- `npx tsc --noEmit` gyökér és `server/` külön: zöld.
- A tervező minősége **7 budapesti páron × 3 kerülőméreten** mérve, több körben.
- **NEM ellenőrzött:** emulátoros készlet; produkciós build; a `routeLab.ts`
  nincs teszttel fedve (kézi eszköz).
- **NEM mért:** a tervező viselkedése Budapesten kívül; a Cloud Run 1 vCPU
  hatása a tervezési időre.

## Nyitott ügyek — javasolt sorrend

1. `POST /api/routes/plan` végpont: hitelesítés, heti keret, őszinte nemleges
   válasz.
2. `Barangolás | Útvonal` választó a Rögzítés panelen, cél térképi pinnel.
3. Geocoding éles bekötése — ⚠️ a Mapbox **tartós tárolási** jogosultságát
   kódírás előtt tisztázni kell.
4. Útvonal-könyvtár írási oldala, majd előtöltés, olvasás, felület.
5. `--cpu=2` a `grundo-api` Cloud Run szolgáltatásra (ma nincs megadva).
6. A `shapedCandidateLimit` lépcsőjének újrahangolása (ma 30 km, a mérés
   szerint a szakadék 15–20 km között jön).
7. Éles DEM-forrás döntése, majd `config-cloudrun.yml` és gráf-újraépítés.
8. Új iOS és Android build a `d2bdcd0` commitból; heading készülékes mátrix.
9. `1D` preferenciaszűrő UI; DEM-es terepprofil éles rangsorban.
10. Éles GraphHopper URL és fallback arány ellenőrzése backend deploy előtt.

## Modelljavaslat

API-végpont és felület: **Claude (Sonnet, Medium)** — a motor kész, ez
illesztés. Az útvonal-könyvtár adatmodellje és a DEM-pipeline: **Claude (Opus,
High)**.
