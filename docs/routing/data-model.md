# GRUNDO Route Intelligence — adatmodell

**Státusz:** tervezet; a mezőnevek implementáció előtt API-sémában rögzítendők · 2026-09-10

## Modellalapelvek

- Az úthálózat élei irányítottak, mert az emelkedés, a behajtás és több minőségi jellemző irányfüggő.
- A kereszteződés és a kanyar önálló csomópont-/fordulóadat; nem vezethető le megbízhatóan csak az élek átlagából.
- Minden minőségi dimenzió külön értéket, megbízhatóságot, frissességet és forrást kap.
- A hiányzó adat `null`/`unknown`, nem nulla és nem automatikusan rossz.
- A GraphHopper belső edge ID nem tartós külső azonosító. Új gráfverzióban megváltozhat.
- Az útvonalválasz mindig megnevezi az adat- és algoritmusverziót, amellyel készült.

## Verzió és eredet

```ts
type RouteDataVersion = {
  id: string;
  createdAt: string;
  graphBuildId: string;
  scoringModelVersion: string;
  sourceSnapshots: Array<{
    sourceId: string;
    snapshotId: string;
    observedAt?: string;
    importedAt: string;
    licenseId: string;
  }>;
  validationStatus: "candidate" | "active" | "rejected" | "retired";
};
```

Az `active` verzió manifestje Firestore-ban tartható, a nagy nyers és feldolgozott állományok Cloud Storage-ba kerülnek. A kiadott GraphHopper-gráf ehhez a manifesthez kötődik.

## Útszakasz és csomópont

```ts
type MetricValue = {
  value: number | null;
  confidence: number;
  observedAt?: string;
  validUntil?: string;
  provenanceIds: string[];
};

type RouteSegment = {
  segmentId: string;
  fromNodeId: string;
  toNodeId: string;
  geometryRef: string;
  lengthM: number;
  access: "allowed" | "restricted" | "forbidden" | "unknown";
  surface?: string;
  roadClass?: string;
  averageSlope?: number;
  maxSlope?: number;
  ascentM?: number;
  metrics: {
    quietness?: MetricValue;
    greenery?: MetricValue;
    lighting?: MetricValue;
    trafficComfort?: MetricValue;
    crossingComfort?: MetricValue;
    surfaceComfort?: MetricValue;
    communityQuality?: MetricValue;
    partnerQuality?: MetricValue;
  };
};

type RouteJunction = {
  junctionId: string;
  position: [number, number];
  crossingType?: string;
  signalized?: boolean;
  trafficClass?: string;
  lighting?: MetricValue;
  crossingComfort?: MetricValue;
};
```

A `confidence` 0–1 közötti technikai megbízhatóság, nem felhasználói pontszám. Egy dimenzió útvonal-szintű `coverage` értéke a megfelelő adattal lefedett úthossz aránya.

## Tervezési kérés

```ts
type RoutePlanRequest = {
  origin: [number, number];
  activityType: "walk" | "run" | "bike";
  target: { kind: "distance"; meters: number } | { kind: "duration"; seconds: number };
  routeCharacter?: "winding" | "long_straights";
  terrainPreference: "flat" | "balanced" | "hilly";
  priorities: Array<
    "safer" | "quieter" | "greener" | "fewer_crossings" | "better_lit" | "better_surface"
  >;
  missionGoal?: "best" | "new_area" | "steal" | "reinforce" | "explore";
  preferredDirection?: number;
};
```

A felület egyszerű választásokat mutat; a szerver fordítja ezeket verziózott súlyokra. Nyers súlyokat a kliens nem küld, ezért egy korábbi terv reprodukálható marad.

## Útvonalterv és manőver

```ts
type RouteManeuver = {
  id: string;
  routeOffsetM: number;
  type: "depart" | "continue" | "turn" | "fork" | "roundabout" | "arrive";
  modifier?: "left" | "slight_left" | "right" | "slight_right" | "straight" | "uturn";
  streetName?: string;
  exitNumber?: number;
  position: [number, number];
};

type RouteScoreDimension = {
  score: number | null;
  coverage: number;
  worstSegmentScore?: number;
  explanationKey: string;
};

type RouteAlternative = {
  routeId: string;
  geometry: string;
  distanceM: number;
  durationS: number;
  ascentM?: number;
  descentM?: number;
  elevationProfile?: Array<[number, number]>;
  steepDistanceShare?: number;
  maneuvers: RouteManeuver[];
  scores: Record<string, RouteScoreDimension>;
  estimatedGp?: number;
  routeDataVersion: string;
  routingEngineVersion: string;
};
```

Az összpontszám nem rejtheti el a szélsőségesen rossz szakaszt. A rangsor a teljes út átlagos büntetése mellett a legrosszabb szakaszt, az ismeretlen adatok büntetését, a csomópontokat és a fordulókat is figyelembe veszi.

## Rögzítési szándék és nézet

```ts
type RecordingIntent =
  | { kind: "free" }
  | {
      kind: "guided";
      routePlanId: string;
      routeVersion: string;
      geometry: string;
      maneuvers: RouteManeuver[];
      plannedDistanceM: number;
    };

type RecordingView = "grundo" | "navigation";

type RouteProgress = {
  matchedOffsetM: number;
  remainingDistanceM: number;
  nextManeuver?: RouteManeuver;
  distanceToNextManeuverM?: number;
  estimatedArrivalAt?: string;
  offRoute: boolean;
  matchConfidence: number;
};
```

- `free` szándéknál nincs `RecordingView`-váltó és navigációs állapot.
- `guided` szándéknál az alapnézet `navigation`, de a GRUNDO nézet is választható.
- Az egysoros GRUNDO-utasítás a `nextManeuver`, `distanceToNextManeuverM` és lokalizált utcanév tömör vetülete.
- A rögzített aktivitástáv és az útvonalon mért haladás két külön adat; eltéréskor sem írhatják felül egymást.

## Domborzati aktivitásmérés

```ts
type ActivityElevationAssessment = {
  demVersion: string;
  ascentM: number;
  descentM: number;
  elevationCoverage: number;
  hypotheticalGpBonus: number;
  awardedGpBonus: number;
  mode: "shadow" | "active";
};
```

Árnyékmódban az `awardedGpBonus` kötelezően nulla. Aktiváláskor a képlet verzióját is tárolni kell, hogy a korábbi eredmény auditálható legyen.

## Tárolási helyek

| Adat | Elsődleges hely | Indok |
|---|---|---|
| Nyers forráspillanatképek | Cloud Storage | nagy, változatlan, visszajátszható állományok |
| Normalizált szegmens-artefaktumok | Cloud Storage | gráfépítés bemenete, verziózható |
| Aktív verzió manifestje | Firestore | kis méretű operatív állapot |
| Útvonalgráf | GraphHopper image/volume | gyors lekérdezés |
| Felhasználói preferenciák és mentett tervek | Firestore | felhasználóhoz kötött kis adatok |
| Útvonal-könyvtár rekordjai | Firestore | kis, indexelhető, paraméter szerint kereshető — lásd [`route-library.md`](route-library.md) |
| Útvonal-könyvtár cellahalmazai | Cloud Storage | jelöltenként tízezres cellalista, dokumentumba nem fér |
| Közösségi nyers visszajelzés | Firestore | jogosultság és audit; aggregálva kerül a gráfba |
| Aktív vezetési csomag | helyi tartós tár | offline/újraindulási helyreállítás |
| Rövid életű lezárás | memóriabeli verziózott overlay | nem igényel teljes gráfépítést |
