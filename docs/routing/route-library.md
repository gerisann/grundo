# GRUNDO útvonal-könyvtár

**Státusz:** jóváhagyott irány, implementáció még nem kezdődött el · 2026-09-12

> Ez a dokumentum a küldetés-ajánló **következő fő iránya**. A mérés, amiből
> származik, a [`benchmark.md`](benchmark.md) → „Hol megy el az idő” szakaszban
> van; a tartós döntések a [`../ai/DECISIONS.md`](../ai/DECISIONS.md)-ben.

## Miért

A küldetés-ajánló hosszú körökön percekig gondolkodik. A mérés szerint **nem az
útvonaltervező a lassú**: a GraphHopper mindkét menete együtt 0,3–1,8 s minden
hosszon. A drága fél a bezárt cellahalmaz kiszámítása (`shapeCandidateCells` →
`detectLoopsDetailed`): 20–25 km-en 8 s, 60 km-en 35 s — fejlesztői gépen. A
`grundo-api` élesben 1 vCPU-n fut, tehát ez ott többszöröse.

Ezt a számolást lehet gyorsítani, de nem lehet ingyenessé tenni: a bezárt
terület a hossz négyzetével nő, egy 24 km-es kör 22 641 cellát zár be.

**A könyvtár ezért nem gyorsítás, hanem vagyonfelhalmozás.** Minden egyszer már
kiszámolt útvonal megmarad, paraméterezve. Új keresésnél a felhasználó azonnal
kap választékot a korábbiakból, és amíg azt nézegeti, a friss generálás a
háttérben lefut. Minél többet mentünk el, annál pontosabb az azonnali találat —
a rendszer használat közben javul, nem külön fejlesztéstől.

## Alapelvek

1. **Minden kiszámolt útvonal bekerül**, nem csak az, amit a felhasználó látott.
   Egy generálás 16–38 nyers jelöltet állít elő; mind értékes.
2. **A könyvtár útvonalat tárol, nem eredményt.** Terület, GP, áldozat és
   birtokviszony sosem onnan jön — azt minden kérésnél élőben számoljuk. Így a
   „küldetés nem becslés” szabály sértetlen marad.
3. **A hasonló találat teljes értékű kártya**, nem helyőrző. Mivel a cellahalmaz
   is a könyvtárban van, a terület és a GP azonnal kiszámolható rá.
4. **A könyvtár nem rekeszti ki a friss generálást.** A két eredmény
   párhuzamosan fut, a friss felülre kerül.
5. **A rekord megmondja, milyen adatból készült.** Gráfverzió és
   pontozásiverzió nélkül nem tudjuk, mikor avult el.

## Mit tárolunk

```ts
type StoredRoute = {
  routeId: string;

  /* ── Geometria ── */
  polyline: string;
  distanceM: number;
  durationS: number;
  maneuvers?: RouteManeuver[];

  /* ── Rajt: a lekérdezés indexe ── */
  origin: [number, number];
  /** H3-cellák több felbontáson — Firestore-ban nincs geo-lekérdezés. */
  originCells: { r7: string; r8: string; r9: string };

  /* ── Kérési paraméterek, amikre keresünk ── */
  profile: "foot" | "bike";
  activityTypes: Array<"walk" | "run" | "ride">;
  routeCharacter: "twisty" | "straight";
  requestedKm: number;
  bearingDeg: number;
  /** Kerekített hossz-sáv a durva szűréshez (pl. 0,5 km-es lépcső). */
  distanceBand: number;

  /* ── Alak: minőségi rangsor, már ma kiszámoljuk ── */
  shape: { uTurns: number; shortDetours: number; turnCount: number };

  /* ── Játék: ettől lesz teljes értékű a kártya ── */
  cells?: { blobRef: string; count: number; loopCount: number; enclosedM2: number };

  /* ── Eredet ── */
  graphVersion: string;
  scoringModelVersion: string;
  createdAt: string;

  /* ── Használat: ez teszi egyre pontosabbá a rangsort ── */
  stats: { offered: number; selected: number; completed: number; lastOfferedAt?: string };

  /* ── Később, ahogy a források beérkeznek (1B, 2–4. fázis) ── */
  terrain?: { demVersion: string; ascentM: number; descentM: number; steepShare: number };
  scores?: Record<string, RouteScoreDimension>;
};
```

### Amit NEM tárolunk

- **Nincs benne, ki generálta.** A rekord az úthálózat terméke, nem felhasználói
  nyomvonal. Így a könyvtár megosztása nem ad ki senkiről semmit.
- **Nincs benne terület-nyereség, GP, áldozat vagy birtokviszony.** Ezek naponta
  változnak; a kártyára élőben kerülnek rá.

### Mit mentsünk cellástul

A cellablob százezres nagyságrendű: egy 24 km-es kör 22 641 cella. Ezért:

| Mit | Hol | Mikor |
|---|---|---|
| Útvonalrekord (geometria + paraméterek) | Firestore `routeLibrary` | **minden** kiszámolt jelöltre |
| Cellahalmaz | Cloud Storage (`territoryBlobStore` mintájára) | csak azokra, amelyekre a drága geometria már lefutott (3–6 jelöltenként) |

A cella nélküli rekord is hasznos: felajánlható, és a cellája utólag, igény
szerint kiszámolható.

## Egyezés és rangsor

Firestore-ban nincs geo-lekérdezés, ezért a szűrés **indexelt egyenlőségekkel**
megy, a finom rangsor memóriában:

1. **Durva szűrés (index):** `profile` + `originCells.r8` a rajt szomszédos
   celláival + `distanceBand` a kért hossz körül.
2. **Hasonlósági pontszám (memóriában):** rajttávolság · hosszeltérés ·
   `routeCharacter` egyezés · alakminőség (`uTurns`, `shortDetours`) ·
   frissesség · korábbi választottság (`stats`) · és a már felajánlottaktól való
   eltérés, hogy ne három ugyanolyan kör legyen a listán.
3. **Élő értékelés:** a legjobb néhányra betöltjük a cellablobot, és a mai
   birtokviszonnyal kiszámoljuk a területet és a GP-t — ugyanazzal a motorral,
   mint a friss ajánlatokét.

A rajt sosem pontosan ott lesz, ahol a felhasználó áll. Ezt **ki kell írni**
(„rajt 300 m-re innen”), nem elrejteni. Javasolt felső határ: gyalog 500 m,
kerékpáron 1,5 km.

## A menet, ahogy a felhasználó látja

```
kérés
  ├─ azonnal (~200–300 ms) ── „Hasonló találatok” a könyvtárból, teljes kártyaként
  └─ párhuzamosan ────────── friss generálás (GraphHopper + geometria)
                               ├─ ahogy elkészül: a friss ajánlatok felülre kerülnek
                               └─ minden kiszámolt jelölt bekerül a könyvtárba
```

A felhasználó nem üres képernyőt néz, hanem választékot. A háttérszámítás ideje
ezzel nem tűnik el, csak kikerül a várakozásból.

## Feltöltés — ne a felhasználóra várjunk

Induláskor a könyvtár üres, tehát a „Hasonló találatok” hetekig üres maradna.
Ezért kell egy **előtöltő script**, ami egy budapesti rajtpont-rácson ×
hossz-sávokon × mozgásformákon végigfuttatja a generátort, és feltölti a
könyvtárat. Ez ugyanaz a belépési pont, amit a mérőpad
(`server/src/scripts/benchmarkRoutes.ts`) is hív — nem kell külön motor.

A rács sűrűsége és a lefedett terület költségkérdés: a GraphHopper-hívás
ingyenes, a cellaszámítás CPU-idő, a tárolás GCS.

## Kvóta és játékegyensúly

- **A hasonló találat nem fogyasztja a heti keretet**, mert nem történt
  generálás. A `FREE_ROUTE_GENERATIONS_PER_WEEK` csak a friss generálásra megy
  el. Így a könyvtár a fizetés nélküli felhasználónak is valódi értéket ad.
- **A Pro ettől sem kap játékbeli előnyt:** ugyanazt a könyvtárat látja, ugyanaz
  a terület és GP jár érte. A Pro továbbra is csak a generálások számában
  különbözik.

## Elavulás

A gráf frissülhet (új OSM-import), és egy régi rekord olyan úton mehet, ami
azóta lezárt. Ezért a rekord tárolja a `graphVersion`-t. Javasolt kezelés:

- a régebbi gráfból származó útvonal **továbbra is felajánlható**, mert a városi
  úthálózat nagy része nem változik;
- de **kiválasztáskor újra kell validálni** a jelenlegi gráffal, mielőtt vezetett
  rögzítés indul belőle;
- ami tartósan nem validálható, az kiesik.

Ennek pontos szabályát mérés után kell meghúzni, nem előre.

## Megvalósítási sorrend

| # | Csomag | Tartalom |
|---|---|---|
| 1 | **Írási oldal** | minden kiszámolt jelölt mentése paraméterezve; cellablob a geometriázottakra. Nincs UI-változás, nincs kockázat, a könyvtár innentől nő. |
| 2 | **Előtöltés** | budapesti rács-script, hogy legyen miből válogatni. |
| 3 | **Olvasási oldal** | indexelt lekérdezés, hasonlósági rangsor, élő értékelés, API-végpont. |
| 4 | **Felület** | „Hasonló találatok” lista, rajttávolság kiírása, a friss ajánlatok utólagos beérkezése. |

## Ami emiatt hátrébb sorolódik

A számítás gyorsítása megmarad, de már **csak a háttérmunkát** érinti, nem a
felhasználó várakozását:

- a `grundo-api` Cloud Run CPU-ja nincs megadva (`cloudbuild.yaml`), tehát
  1 vCPU — a `--cpu=2` egysoros változás, a geometria egy szál és CPU-kötött;
- a `shapedCandidateLimit` lépcsője 30 km-nél van, a mérés szerint viszont a
  szakadék 15–20 km között jön;
- a flood fill ~120 µs/cella — ez profilozásra érdemes, de nem sürgős.

## Nyitott döntések

- Az előtöltő rács sűrűsége és lefedett területe (költség).
- A rajteltérés felső határa mozgásformánként — a fenti 500 m / 1,5 km javaslat,
  nem mérés.
- Az elavult gráfverzió újravalidálásának módja és küszöbe.
- Mennyi ideig és milyen szabállyal tartunk meg egy soha nem választott
  útvonalat.
