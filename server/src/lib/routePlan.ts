/**
 * A→B tervező és a kétoldali oda-vissza kör.
 *
 * MI EZ, ÉS MIÉRT KÜLÖN FÁJL? A `directions.ts` a küldetés-ajánló kör-motorja
 * (`round_trip`): egyetlen pontból indul, és oda tér vissza. Ez a modul egy
 * MÁSIK feladat: a felhasználó megad egy célt, és vagy odamegy (`A→B`), vagy
 * oda-vissza megy úgy, hogy a két irány a közvetlen vonal két oldalán haladjon,
 * és együtt körbezárjon egy területet (`A→B→A`).
 *
 * Spec: `docs/02-funkcionalis-spec.md` → Útvonaltervezés a rögzítés előtt.
 * Terv és mérések: `docs/routing/point-to-point.md`.
 *
 * ⚠️ A KÉTOLDALI KÖR CSAK GRAPHHOPPERREL MEGY. Területi súlyozás
 * (`custom_model.areas`) kell hozzá, amit a Mapbox Directions nem tud — ott
 * nincs értelmes tartalék. Az egyszerű `A→B` úton viszont van: ha a
 * GraphHopper nem elérhető, a Mapbox beugrik.
 *
 * ⚠️ ITT NINCS ELFOGADÁSI KÜSZÖB. A minőségi mutatókat (visszafordulás, közös
 * szakasz, oldalszétválás) kiszámoljuk és VISSZAADJUK, de nem utasítunk el
 * belőlük — küszöböt csak mérésből szabad bevezetni, és az a mérés még nem
 * futott le valódi budapesti párokon.
 */

import { GAMEPLAY, type GameplayConfig } from '../../../src/config/gameplay';
import { distanceM, type LatLng } from '../../../src/game/geo';
import { decodePolyline } from '../../../src/game/polyline';
import {
  axisBandRing,
  detourViaPoints,
  routeAvoidRings,
  signedSideOffsetM,
  type RouteSide,
} from '../../../src/game/routeCorridor';
import {
  countSelfRevisits,
  countShortDetours,
  countUTurns,
  sharedPathRatio,
} from '../../../src/game/routeShape';
import {
  graphhopperBasePriority,
  graphhopperConfigured,
  graphhopperProfile,
  planDirectMapbox,
  requestGraphHopperPath,
  type DirectionsRoute,
} from './directions';

/**
 * A felhasználó három állású választója.
 *
 * ⚠️ A `protected` és a `quiet` MECHANIZMUSA kész, az ADATA nem. Amíg nincs
 * mögötte igazolt forrás, a felület nem ígérhet biztonságot — lásd
 * `docs/routing/data-sources.md` és a `Védettebb` elnevezésről szóló döntést.
 * A súlyok itt szándékosan az OSM-ből MA is elérhető jellemzőkre épülnek.
 */
export type RoutePreference = 'fast' | 'protected' | 'quiet';

/**
 * Kombinálható jellemző: kerékpáros infrastruktúra előnyben.
 *
 * ⚠️ EZ AZ EGYETLEN PREFERENCIA, AMI MÖGÖTT MA IS VAN ADAT. Az OSM `cycleway`
 * és `bike_network` a gráfban van (`config-grundo.yml` → `graph.encoded_values`),
 * tehát nem ígér többet, mint amit alá tudunk támasztani — ellentétben a
 * „csendes" és „védettebb" állással. Lásd `docs/routing/data-sources.md`.
 *
 * Csak kerékpáros profilon értelmes; gyalog a felület se kínálja fel.
 */
const CYCLEWAY_BONUS = '1.8';

/**
 * Terepprofil — a `docs/routing/implementation-plan.md` `1D` szakaszának
 * elnevezéseivel: pontosan egy választható.
 *
 * ⚠️ CSAK AKKOR MŰKÖDIK, HA A GRÁF TARTALMAZZA A LEJTÉST. Az `average_slope`
 * kódolt érték a GraphHopper-konfigurációból jön, és csak bekapcsolt
 * domborzattal (`graph.elevation.provider`) létezik. Ilyen szabályt
 * magasság nélküli gráfra küldve a motor hibát ad, nem útvonalat — a hívó
 * felelőssége, hogy csak akkor kérje, ha a gráf tudja.
 *
 * A `config-cloudrun.yml` MA NEM tartalmaz domborzatot; a helyi
 * `config-grundo.yml` igen (2026-09-12), hogy kipróbálható legyen.
 */
export type TerrainPreference = 'flat' | 'balanced' | 'hilly';

/** A kerülő mérete — az értékek a `gameplay.ts`-ben, mert játékkonstansok. */
export type DetourSize = 'small' | 'medium' | 'large';

/** Az odaút a közvetlen A–B vonal bal oldalán megy, a visszaút a jobbon. */
const OUTBOUND_SIDE: RouteSide = 'left';
const INBOUND_SIDE: RouteSide = 'right';

/**
 * HÁROM ZÓNA, NEM EGY SÁV — az elágazási szabályok súlyozott alakja.
 *
 * A felhasználói szabály így szól: *ha még nem értük el a kért kerülőt,
 * távolodó irányt kell venni; ha már elértük, közeledőt.* Ez NEM elágazásonkénti
 * döntés — egy elágazásonként döntő logika nem tud előretekinteni, és pont a
 * „ha később jobb fordulási lehetőség jön, menj egyenesen" szabályt nem tudná
 * betartani. Súlyként viszont pontosan ezt jelenti, és a globális útvonalkeresés
 * minden folytatást végigszámol:
 *
 *   - `reached` — a kért kerülő körüli sáv a helyes oldalon: teljes prioritás;
 *   - `approach` — a tengely és a kért kerülő között: csökkentett, tehát
 *     „még távolodj";
 *   - minden más (rossz oldal vagy túllőtt távolság): erősebben csökkentett,
 *     tehát „gyere vissza".
 *
 * Egyik sem TILTÁS: ha az úthálózat mást nem enged (híd, folyó, vasút), a
 * tervező átléphet — a közlekedési szabály és a járhatóság előbbre való.
 */
const REACHED_PRIORITY = '1.0';
const APPROACH_PENALTY = '0.6';
const OUTSIDE_PENALTY = '0.3';

/** A kért kerülő körüli sáv alsó és felső határa (a kerülő szorzójaként). */
const BAND_INNER_FACTOR = 0.7;
const BAND_OUTER_FACTOR = 1.3;

/**
 * A zónák a tengely hányadik részétől hányadikáig tartanak.
 *
 * ⚠️ AZ `A` ÉS A `B` A TENGELYEN VAN. Ha a zóna a végpontokig érne, az indulás
 * és az érkezés maga esne büntetett területre, és a tervező a rajt körül kezdene
 * kanyarogni, hogy mielőbb kijusson.
 */
const BAND_START_FRACTION = 0.15;
const BAND_END_FRACTION = 0.85;

/**
 * KÉTFÉLE KERÜLENDŐ, KÉT KÜLÖNBÖZŐ ERŐVEL.
 *
 * - `RETRACE_PENALTY` — a már megtervezett ODAÚT foltjai a visszaút
 *   kérésében. Ez majdnem tiltás: ugyanazon az úton visszahozni a
 *   felhasználót pontosan az, amit a szabály kizár.
 * - `FAST_LINE_PENALTY` — a leggyorsabb útvonal foltjai MINDKÉT legnek.
 *   Ez csak terelés: azt akarjuk, hogy a legek ne tapadjanak rá a közvetlen
 *   vonalra, de a rájuk kényszerítés nem indokolt. Mérve (2026-09-12): a
 *   majdnem-tiltás itt rontott — nőtt a visszafordulás és a két leg közös
 *   szakasza is, mert a router ugyanarra a kevés maradék alternatívára
 *   szorult.
 */
const RETRACE_PENALTY = '0.05';
const FAST_LINE_PENALTY = '0.35';

/** Mekkora folt kerüljön az odaút mintavett pontjai köré. */
const AVOID_BUFFER_M = 40;

/**
 * Legfeljebb ennyi kerülendő folt mehet egy kérésbe FORRÁSONKÉNT.
 *
 * ⚠️ MÉRÉSBŐL (2026-09-12, helyi GraphHopper 11): 4 poligon 229 ms, 27 poligon
 * 557 ms egy 6 km-es úton. A plafon nélkül egy hosszú nyomvonal több száz
 * foltot adna, és egyetlen leg megtervezése másodpercekbe kerülne. A visszaút
 * két forrásból kap foltot (a leggyorsabb út ÉS az odaút), ezért a kettő
 * együtt is a mérhető tartományban marad.
 */
const DIRECT_AVOID_MAX_RINGS = 12;
const OUTBOUND_AVOID_MAX_RINGS = 14;

/**
 * A kerülendő foltok a nyomvonal két végéből ennyit hagynak ki.
 *
 * ⚠️ Geri megfigyelése (2026-09-12): *„a nagy kerülő elég sokáig követi a
 * leggyorsabb útvonalat, ahelyett hogy elkerülné azt, mint a visszaút."* Az ok
 * az volt, hogy csak a VISSZAÚT kapott kerülendő területet — az odaútnak nem
 * volt mit kerülnie, ezért a köztes pontig egyszerűen a leggyorsabb úton ment.
 * Most a leggyorsabb útvonal MINDKÉT legnek kerülendő.
 *
 * A végek kihagyása kötelező: mindkét leg ugyanabból a pontból indul és
 * ugyanoda érkezik, tehát a rajt és a cél környékén a közös szakasz
 * elkerülhetetlen — és a szabály szerint elfogadható is.
 */
const AVOID_TRIM_FRACTION = 0.15;

/** A leggyorsabb vonal körüli folytonos korridor legnagyobb sugara. */
const FAST_LINE_MAX_BUFFER_M = 120;

/**
 * Ennél messzebbre kapcsolt köztes pont HIBÁS jelölt.
 *
 * ⚠️ GERI KÉPÉBŐL (2026-09-12): a Deák → Flórián tengely a Duna mentén fut,
 * tehát a „bal oldal" nagyrészt maga a folyó. A vízbe eső mértani pontot a
 * GraphHopper a legközelebbi járható útra teszi — egy STÉGRE —, és az
 * útvonalnak ki kell mennie rá, majd vissza. Ugyanez történik vasúti
 * területnél, zárt gyárudvarnál, repülőtérnél.
 *
 * A motor megmondja, hova kapcsolt (`snapped_waypoints`); ha messze, a jelölt
 * nem használható. Nem tiltás, hanem erős hibapont: ha MINDEN jelölt ilyen
 * (tényleg nincs út a kért oldalon), a legkevésbé rossz még mindig jobb, mint
 * a „nincs útvonal".
 */
const VIA_SNAP_TOLERANCE_M = 120;

/**
 * A köztes pontok elhelyezése a tengely mentén — a szakasz hányadánál.
 *
 * ⚠️ MIÉRT TÖBBFÉLE ALAKZAT? Geri vizuális visszajelzése (2026-09-12): az
 * egyetlen felezőpontos köztes pont HÁROMSZÖGET ad — az útvonal kimegy oldalra,
 * majd visszajön, közben egy szakaszon a céltól távolodik. A szabály viszont
 * az, hogy „az útvonal végig nagyjából a cél felé halad, csak tesz egy
 * kitérőt". Két köztes pont ezt lapos kidudorodássá teszi.
 *
 * Mindkét alakzat kimegy jelöltként, és a legkevésbé hibás nyer: melyik
 * működik, az az adott utcahálózaton dől el, nem elvben.
 *
 * ⚠️ A visszafordulások fő oka a köztes pont RÁKAPCSOLÁSA (mérve: a közvetlen
 * A→B út 0–1 visszafordulást tartalmaz, egyetlen köztes ponttal 2–4). A
 * kérésbeli `turn_penalty` NEM segített — bitre ugyanazt az útvonalat adta.
 * Ezért nem súlyt hangolunk, hanem több jelöltből választunk.
 */
const VIA_FRACTION_SETS: readonly (readonly number[])[] = [
  [0.5],
  [0.35, 0.65],
  [0.3, 0.7],
];

/**
 * Mennyit ér a kért kerülő elmaradása a hibapontszámban.
 *
 * ⚠️ EZ TESZI LEHETŐVÉ, HOGY A TERVEZŐ ELENGEDJE A KÖZTES PONTOT. Geri
 * stég-képe mutatta meg, hogy erre szükség van: a Duna menti tengelynél a
 * kért oldalon 400–500 méterre VÍZ van, tehát MINDEN köztes pont rossz helyre
 * esik, és mindegyik jelölt kimegy egy stégre, majd vissza. Ilyenkor a
 * köztes pont nélküli, tiszta útvonal a jobb válasz — kisebb kerülővel, de
 * kerülő nélküli hülyeség nélkül.
 *
 * Az érték szándékosan KEVESEBB egy visszafordulásnál (1 000): a teljesen
 * elmaradt kerülő rosszabb, mint egy kis kitérő, de jobb, mint egy
 * visszafordulás. Ahol a köztes pont rendes útra esik, ott a lemaradás
 * nulla közeli, tehát a kerülős jelölt nyer.
 */
const OFFSET_SHORTFALL_WEIGHT = 800;

const VIA_OFFSET_FACTORS = [0.85, 1, 1.15] as const;

/**
 * A kerülő felső korlátja a KÖZVETLEN TÁV arányában.
 *
 * ⚠️ EZ A LEGFONTOSABB KORLÁT, ÉS VIZUÁLIS MÉRÉSBŐL JÖN (Geri, 2026-09-12).
 * A kerülő mérete abszolút méter (`ROUTE_DETOUR_OFFSET_M`), de egy rövid úton
 * ugyanaz a méter mást jelent: 2,6 km-es A–B távnál a 2000 m oldalirányú
 * kitérés a teljes táv 77%-a. A generált útvonal ilyenkor nem „kitérőt tesz",
 * hanem TELJESEN MÁS IRÁNYBA megy, és ugyanazon az úton hozza vissza a
 * felhasználót — pontosan az, amit a szabály tilt.
 *
 * Rövid úton tehát a nagy kerülő közelebb kerül a közepeshez. Ez nem hiba,
 * hanem az őszinte válasz: 2,6 km-en nem fér el 2 km-es kitérő úgy, hogy az
 * útvonal közben végig a cél felé haladjon.
 */
const MAX_OFFSET_AXIS_RATIO = 0.45;

/**
 * Amire a rákapcsolás NEM eshet.
 *
 * A köztes pont mértani hely: a GraphHopper a legközelebbi útra teszi. Ha az
 * történetesen egy híd vagy alagút közepe, az útvonalnak rá kell hajtania és
 * vissza — Geri képein pontosan ez a Margit híd körüli hurok.
 */
const SNAP_PREVENTION = ['bridge', 'tunnel', 'ferry', 'motorway', 'pedestrian'];

/*
  ⚠️ AMIT MEGMÉRTEM ÉS NEM HASZNÁLT (2026-09-12, Geri stég-képe): sem a
  `road_class = other` rákapcsolás-tiltása, sem az áthaladásának büntetése nem
  változtatott semmit — bitre ugyanazok a jelöltek. A hiba nem az útosztályban
  van, hanem abban, hogy a KÖZTES PONT esik rossz helyre, és azt kötelező
  érinteni. Ne próbáld újra útosztály-szabállyal.
*/

/** A zónák belső határa — a tengely közvetlen környéke mindkét legnek maradjon. */
const SIDE_CORRIDOR_INNER_M = 30;

export interface RouteLeg {
  route: DirectionsRoute;
  points: LatLng[];
}

export interface LoopQuality {
  /** Visszafordulások a teljes körön — a nulla a cél. */
  uTurns: number;
  /** Rövid, értelmetlen kitérők a teljes körön. */
  shortDetours: number;
  /**
   * Mennyire fut a két leg ugyanazon az úton (0–1), IRÁNYFÜGGETLENÜL mérve.
   * A rajtnál és a cél közelében egy kis közös szakasz elfogadható.
   */
  sharedPathRatio: number;
  /** Az odaút átlagos előjeles oldaltávolsága a közvetlen A–B vonaltól. */
  outboundSideM: number;
  /** Ugyanez a visszaútra — az ellenkező előjel a cél. */
  inboundSideM: number;
  /** A két leg tényleg szétvált-e: ellentétes előjel ÉS érdemi távolság. */
  separated: boolean;
}

export interface TwoSidedLoop {
  outbound: RouteLeg;
  inbound: RouteLeg;
  /** A közvetlen A–B útvonal hossza — ehhez képest mennyit kerülünk. */
  directDistanceM: number;
  totalDistanceM: number;
  totalDurationS: number;
  quality: LoopQuality;
}

export type PlanFailure =
  | 'engine_unavailable'
  | 'no_direct_route'
  | 'no_outbound_route'
  | 'no_return_route';

export type TwoSidedLoopResult =
  | { ok: true; loop: TwoSidedLoop }
  | { ok: false; reason: PlanFailure };

/* ════════════════════════════════════════════════════════════════════════
   Súlyozás
   ════════════════════════════════════════════════════════════════════════ */

/**
 * A preferencia-választó súlyai.
 *
 * A `fast` a mai alapsúlyozás. A másik kettő ugyanabból az OSM-adatból dolgozik,
 * ami a gráfban MA is benne van (`road_class`, `cycleway`, `surface`) — nem
 * ígér többet, mint amennyit alá tudunk támasztani.
 */
function preferenceRules(
  preference: RoutePreference,
  ghProfile: 'foot' | 'bike',
  preferCycleways = false,
): unknown[] {
  const rules: unknown[] = [];

  /*
    ⚠️ GYALOG ÉS FUTVA A FORGALMAS ÚT MINDIG ROSSZ — nem csak akkor, ha a
    felhasználó a „csendes" állást választotta (Geri, 2026-09-12, a generált
    útvonalak megnézése után). A `fast` itt sem jelenti azt, hogy egy négysávos
    úton vezetjük végig sétálni. A gráf alapsúlyozása ezt már csökkenti; ez
    ráteszi a második szorzót.
  */
  if (ghProfile === 'foot') {
    rules.push(
      { if: 'road_class == PRIMARY || road_class == SECONDARY', multiply_by: '0.4' },
      { if: 'road_class == TERTIARY', multiply_by: '0.7' },
    );
  } else {
    /*
      ⚠️ SÉTÁLÓTÉRRE BRINGÁVAL NEM MEGYÜNK (Geri, 2026-09-12). Gyalog és futva a
      téren átvágni természetes, kerékpárral nem az — és sok helyen tilos is.
      Nem nulla, hanem majdnem nulla: ha egy sétálótér az EGYETLEN átjáró (híd
      felhajtó, aluljáró), a tervező még átmehet rajta, különben egyáltalán nem
      adna útvonalat. A járhatóság előbbre való a szabály merevségénél.
    */
    rules.push(
      { if: 'road_class == PEDESTRIAN', multiply_by: '0.02' },
      /*
        ⚠️ ÉS AMIT LE KELL SZÁLLNI, AZ SEM ÚTVONAL. Mérve (2026-09-12): a
        bringás jelöltek LÉPCSŐN mentek át (`road_class` részletek: `residential,
        footway, steps`). A GraphHopper ezt járhatónak veszi, mert tolva
        teljesíthető — egy kerékpáros ajánlatba viszont nem való. A
        `get_off_bike` a gráf saját jelzése erre, pontosabb, mint a lépcsőt
        osztály szerint keresni.
      */
      { if: 'get_off_bike', multiply_by: '0.1' },
    );
    if (preferCycleways) {
      // A gráf alapsúlyozása már 1,6-tal jutalmazza; ez ráteszi a másodikat.
      rules.push({
        if: 'road_class == CYCLEWAY || bike_network != MISSING',
        multiply_by: CYCLEWAY_BONUS,
      });
    }
  }

  if (preference === 'protected') {
    rules.push(
      { if: 'road_class == PRIMARY || road_class == SECONDARY', multiply_by: '0.2' },
      { if: 'road_class == CYCLEWAY || road_class == FOOTWAY || road_class == PATH', multiply_by: '1.4' },
    );
  } else if (preference === 'quiet') {
    rules.push(
      { if: 'road_class == PRIMARY || road_class == SECONDARY || road_class == TERTIARY', multiply_by: '0.25' },
      { if: 'road_environment == FERRY', multiply_by: '0' },
    );
  }

  return rules;
}

/**
 * A terepprofil súlyai.
 *
 * A `balanced` nem ad szabályt — így magasság nélküli gráfon is biztonságos.
 * A lejtés százalékban értendő: 3% enyhe, 6% már érezhető emelkedő.
 */
function terrainRules(terrain: TerrainPreference): unknown[] {
  if (terrain === 'flat') {
    return [
      { if: 'average_slope >= 3 && average_slope < 6', multiply_by: '0.5' },
      { else_if: 'average_slope >= 6', multiply_by: '0.15' },
    ];
  }
  if (terrain === 'hilly') {
    /*
      ⚠️ A LEJTŐT NEM JUTALMAZZUK, HANEM A SÍKOT BÜNTETJÜK. Mérve
      (2026-09-12): az `1.8`-as szorzó a meredek élekre SEMMIT nem változtatott
      — a GraphHopper a prioritást 1-nél elvágja, és a legtöbb él eleve 1-en
      áll, tehát a felfelé szorzásnak nincs hova hatnia. Lefelé viszont van.
    */
    return [
      { if: 'average_slope < 1.5', multiply_by: '0.45' },
      { else_if: 'average_slope < 3', multiply_by: '0.75' },
    ];
  }
  return [];
}

/** GeoJSON `Feature` egy poligongyűrűből. */
function areaFeature(id: string, ring: [number, number][]): Record<string, unknown> {
  return {
    type: 'Feature',
    id,
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

interface CustomModelParts {
  priority: unknown[];
  features: Record<string, unknown>[];
}

/**
 * A kérésbe ágyazott egyedi modell összeállítása.
 *
 * ⚠️ A SORREND SZÁMÍT. A GraphHopperben az `else` mindig a KÖZVETLENÜL előtte
 * álló `if`-hez tartozik, ezért az oldalsáv `if`/`else` párja a lista VÉGÉN
 * áll — különben az alapsúlyozás utolsó szabályára kötne rá, és a súlyozás
 * csendben mást jelentene, mint amit írtunk.
 */
function buildCustomModel(parts: CustomModelParts): Record<string, unknown> {
  return {
    priority: parts.priority,
    ...(parts.features.length > 0
      ? { areas: { type: 'FeatureCollection', features: parts.features } }
      : {}),
  };
}

/* ════════════════════════════════════════════════════════════════════════
   A→B — „Csak oda"
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Egyszerű pont-pont útvonal.
 *
 * ⚠️ EZ NEM ZÁR KÖRT, TEHÁT NEM AD TERÜLETET — csak a megtett táv utáni GP-t.
 * A felületnek ezt indulás előtt ki kell mondania (spec).
 */
export async function planDirectRoute(
  from: LatLng,
  to: LatLng,
  profile: 'walking' | 'cycling',
  preference: RoutePreference = 'fast',
  options: {
    stops?: readonly LatLng[];
    preferCycleways?: boolean;
    terrain?: TerrainPreference;
  } = {},
): Promise<DirectionsRoute[]> {
  const stops = options.stops ?? [];
  if (graphhopperConfigured()) {
    const ghProfile = graphhopperProfile(profile);
    const route = await requestGraphHopperPath(
      [from, ...stops, to],
      ghProfile,
      {
        priority: [
          ...graphhopperBasePriority(ghProfile),
          ...preferenceRules(preference, ghProfile, options.preferCycleways),
          ...terrainRules(options.terrain ?? 'balanced'),
        ],
      },
      // ⚠️ A felhasználó által letett megálló is kötelező állomás: enélkül a
      // tervező megfordulhatna rajta, ahogy a saját köztes pontjainknál is.
      stops.length > 0 ? { snapPrevention: SNAP_PREVENTION, passThrough: true } : {},
    );
    if (route) return [route];
  }
  /* ⚠️ A Mapbox-tartalék EGYSZERŰ A→B: megállókat ez az ág még nem kezel. */
  if (stops.length > 0) return [];
  return planDirectMapbox(from, to, profile);
}

/* ════════════════════════════════════════════════════════════════════════
   A→B→A — a kétoldali kör
   ════════════════════════════════════════════════════════════════════════ */

export interface TwoSidedLoopOptions {
  detour: DetourSize;
  preference?: RoutePreference;
  /** Kerékpáros infrastruktúra előnyben — csak `cycling` profilon hat. */
  preferCycleways?: boolean;
  /** Terepprofil — magasság nélküli gráfon hagyd `balanced`-en. */
  terrain?: TerrainPreference;
  /**
   * A felhasználó által letett köztes megállók — CSAK AZ ODAÚTRA.
   *
   * ⚠️ A VISSZAÚT EGYBEN, `B`-ből `A`-ba megy, a megállók érintése nélkül
   * (Geri döntése, 2026-09-12). Ettől marad a visszaút tervezése ugyanolyan
   * egyszerű, mint megállók nélkül: egyetlen A–B tengelyhez képest kell csak
   * oldalt választania.
   *
   * Ha van megálló, az odaút alakját AZOK adják, nem a mi köztes pontjaink —
   * a kerülő mérete ilyenkor a felhasználó kezében van.
   */
  stops?: readonly LatLng[];
  cfg?: GameplayConfig;
}

/**
 * Oda-vissza kör: az odaút és a visszaút a közvetlen A–B vonal két oldalán.
 *
 * A MENET (a mérés diktálta sorrend, lásd `docs/routing/point-to-point.md`):
 *
 *   1. alapvonal — a közvetlen A→B útvonal adja a referenciahosszt;
 *   2. köztes pont merőlegesen, a kerülő mérete szerint — EZ állítja a
 *      kerülő nagyságát, nem a súlyozott sáv szélessége (mérve);
 *   3. odaút A→köztes→B, a bal oldali sáv jutalmazásával;
 *   4. visszaút B→köztes'→A, a jobb oldali sávval ÉS az odaút kerülésével;
 *   5. minőségi mérés — de elutasítás nélkül, mert küszöb még nincs mérve.
 */
export async function planTwoSidedLoop(
  from: LatLng,
  to: LatLng,
  profile: 'walking' | 'cycling',
  options: TwoSidedLoopOptions,
): Promise<TwoSidedLoopResult> {
  if (!graphhopperConfigured()) return { ok: false, reason: 'engine_unavailable' };

  const cfg = options.cfg ?? GAMEPLAY;
  const preference = options.preference ?? 'fast';
  const ghProfile = graphhopperProfile(profile);
  /*
    ⚠️ A KERÜLŐ PLAFONJA A KÖZVETLEN TÁV ARÁNYÁBAN — lásd
    `MAX_OFFSET_AXIS_RATIO`. Rövid úton a kért abszolút kitérő olyan nagy
    lenne, hogy az útvonal nem kitérőt tenne, hanem más irányba menne.
  */
  const axisM = distanceM(from, to);
  const offsetM = Math.min(
    cfg.ROUTE_DETOUR_OFFSET_M[options.detour],
    axisM * MAX_OFFSET_AXIS_RATIO,
  );
  const basePriority = [
    ...graphhopperBasePriority(ghProfile),
    ...preferenceRules(preference, ghProfile, options.preferCycleways),
    ...terrainRules(options.terrain ?? 'balanced'),
  ];

  /* ── 1. Alapvonal ────────────────────────────────────────────────── */
  const direct = await requestGraphHopperPath([from, to], ghProfile, { priority: basePriority });
  if (!direct) return { ok: false, reason: 'no_direct_route' };

  /*
    A LEGGYORSABB ÚTVONAL MINDKÉT LEGNEK KERÜLENDŐ. Enélkül az odaútnak nincs
    mit kerülnie, és a köztes pontig a közvetlen úton megy — a visszaút pedig
    látványosan máshol fut, mint az odaút.
  */
  const directAvoid = routeAvoidRings(decodePolyline(direct.polyline), {
    bufferM: AVOID_BUFFER_M,
    maxRings: DIRECT_AVOID_MAX_RINGS,
    trimFraction: AVOID_TRIM_FRACTION,
    // FOLYTONOS korridor: szaggatott foltoknál a tervező minden foltnál kitér
    // és visszatér, és épp ez adja a felesleges ficakokat.
    continuous: true,
    maxBufferM: FAST_LINE_MAX_BUFFER_M,
  }).map((ring, index) => ({
    feature: areaFeature(`fast${index}`, ring),
    penalty: FAST_LINE_PENALTY,
  }));

  /*
    AZ OLDALT A MEGÁLLÓK DÖNTIK EL, HA VANNAK. Különben a felhasználó keletre
    tett megállóit egy nyugatra terelt odaúttal küzdenénk le.
  */
  const stops = options.stops ?? [];
  const outboundSide: RouteSide =
    stops.length > 0 ? sideOfStops(from, to, stops) : OUTBOUND_SIDE;
  const inboundSide: RouteSide = outboundSide === 'left' ? 'right' : 'left';

  /* ── 2–3. Odaút ──────────────────────────────────────────────────── */
  const outbound =
    stops.length > 0
      ? await planLegThroughStops({
          start: from,
          end: to,
          stops,
          axisFrom: from,
          axisTo: to,
          side: outboundSide,
          offsetM,
          ghProfile,
          basePriority,
          avoidFeatures: directAvoid,
        })
      : await planLegWithBestVia({
          start: from,
          end: to,
          axisFrom: from,
          axisTo: to,
          side: outboundSide,
          offsetM,
          ghProfile,
          basePriority,
          avoidFeatures: directAvoid,
        });
  if (!outbound) return { ok: false, reason: 'no_outbound_route' };

  /* ── 4. Visszaút: másik oldal + az odaút kerülése ─────────────────── */
  const avoidFeatures = [
    ...directAvoid,
    ...routeAvoidRings(outbound.points, {
      bufferM: AVOID_BUFFER_M,
      maxRings: OUTBOUND_AVOID_MAX_RINGS,
      trimFraction: AVOID_TRIM_FRACTION,
    }).map((ring, index) => ({
      feature: areaFeature(`used${index}`, ring),
      penalty: RETRACE_PENALTY,
    })),
  ];

  const inbound = await planLegWithBestVia({
    // A visszaút B-ből indul, de a tengely UGYANAZ az A→B vonal — különben az
    // „oldal" fogalma megfordulna, és a két leg ugyanarra a félre kerülne.
    start: to,
    end: from,
    axisFrom: from,
    axisTo: to,
    side: inboundSide,
    offsetM,
    ghProfile,
    basePriority,
    avoidFeatures,
  });
  if (!inbound) return { ok: false, reason: 'no_return_route' };

  const outboundPoints = outbound.points;
  const inboundPoints = inbound.points;
  const outboundRoute = outbound.route;
  const inboundRoute = inbound.route;

  /* ── 5. Minőségi mérés ───────────────────────────────────────────── */
  return {
    ok: true,
    loop: {
      outbound: { route: outboundRoute, points: outboundPoints },
      inbound: { route: inboundRoute, points: inboundPoints },
      directDistanceM: direct.distanceM,
      totalDistanceM: outboundRoute.distanceM + inboundRoute.distanceM,
      totalDurationS: outboundRoute.durationS + inboundRoute.durationS,
      quality: measureLoopQuality(from, to, outboundPoints, inboundPoints, outboundSide),
    },
  };
}

/** A leg területi súlyozása — a zónák és a kerülendő foltok egy modellben. */
function legCustomModel(request: LegRequest): Record<string, unknown> {
  const band = { fromFraction: BAND_START_FRACTION, toFraction: BAND_END_FRACTION };
  const reached = areaFeature(
    'reached',
    axisBandRing(request.axisFrom, request.axisTo, request.side, {
      innerM: request.offsetM * BAND_INNER_FACTOR,
      outerM: request.offsetM * BAND_OUTER_FACTOR,
      ...band,
    }),
  );
  const approach = areaFeature(
    'approach',
    axisBandRing(request.axisFrom, request.axisTo, request.side, {
      innerM: SIDE_CORRIDOR_INNER_M,
      outerM: request.offsetM * BAND_INNER_FACTOR,
      ...band,
    }),
  );

  return buildCustomModel({
    priority: [
      ...request.basePriority,
      ...request.avoidFeatures.map((area) => ({
        if: `in_${String(area.feature.id)}`,
        multiply_by: area.penalty,
      })),
      { if: 'in_reached', multiply_by: REACHED_PRIORITY },
      { else_if: 'in_approach', multiply_by: APPROACH_PENALTY },
      { else: '', multiply_by: OUTSIDE_PENALTY },
    ],
    features: [...request.avoidFeatures.map((area) => area.feature), reached, approach],
  });
}

interface LegRequest {
  /** A leg tényleges indulási és érkezési pontja. */
  start: LatLng;
  end: LatLng;
  /** Az oldal-fogalom tengelye — MINDIG az eredeti A→B, mindkét legnél. */
  axisFrom: LatLng;
  axisTo: LatLng;
  side: RouteSide;
  offsetM: number;
  ghProfile: 'foot' | 'bike';
  basePriority: unknown[];
  avoidFeatures: AvoidArea[];
}

/** Egy kerülendő terület és a rá vonatkozó büntetés. */
interface AvoidArea {
  feature: Record<string, unknown>;
  penalty: string;
}

/**
 * Egy leg megtervezése TÖBB köztes ponttal, és a legkevésbé hibás kiválasztása.
 *
 * A párhuzamos kérés nem drágít érdemben: a GraphHopper-hívás 150–250 ms, és
 * egyszerre mennek ki. Cserébe a köztes pont rossz rákapcsolása — a mérés
 * szerint a visszafordulások fő oka — nem viszi el az egész legel.
 */
async function planLegWithBestVia(request: LegRequest): Promise<RouteLeg | null> {
  const customModel = legCustomModel(request);

  const variants: { fractions: readonly number[]; factor: number }[] = [
    ...VIA_FRACTION_SETS.flatMap((fractions) =>
      VIA_OFFSET_FACTORS.map((factor) => ({ fractions: fractions as readonly number[], factor })),
    ),
    // TARTALÉK: köztes pont nélkül. Csak akkor nyer, ha minden kerülős jelölt
    // hibás — például mert a kért oldalon víz van.
    { fractions: [] as readonly number[], factor: 1 },
  ];

  const candidates = await Promise.all(
    variants.map(async ({ fractions, factor }) => {
      const vias = detourViaPoints(
        request.axisFrom,
        request.axisTo,
        request.side,
        request.offsetM * factor,
        fractions,
        request.start,
      );
      const route = await requestGraphHopperPath(
        [request.start, ...vias, request.end],
        request.ghProfile,
        customModel,
        { snapPrevention: SNAP_PREVENTION, passThrough: true },
      );
      if (!route) return null;
      const points = decodePolyline(route.polyline);
      return {
        route,
        points,
        defects:
          legDefectScore(points) +
          viaSnapPenalty(vias, route.snappedWaypoints) +
          offsetShortfallPenalty(request, points),
      };
    }),
  );

  const usable = candidates.filter((candidate) => candidate !== null);
  if (usable.length === 0) return null;

  // A legkevésbé hibás nyer; azonos hibaszámnál a rövidebb.
  usable.sort((a, b) => a.defects - b.defects || a.route.distanceM - b.route.distanceM);
  const best = usable[0]!;
  return { route: best.route, points: best.points };
}

/**
 * Büntetés azért, mert a leg nem érte el a kért kerülőt.
 *
 * Enélkül a köztes pont nélküli tartalék jelölt MINDIG nyerne: hibátlan, csak
 * épp nem kerül. Így viszont csak akkor, ha a kerülős jelöltek tényleg
 * rosszak.
 */
function offsetShortfallPenalty(request: LegRequest, points: readonly LatLng[]): number {
  if (request.offsetM <= 0 || points.length === 0) return 0;
  let total = 0;
  for (const point of points) {
    total += Math.abs(signedSideOffsetM(request.axisFrom, request.axisTo, point));
  }
  const achieved = total / points.length;
  const shortfall = Math.max(0, 1 - achieved / request.offsetM);
  return Math.round(shortfall * OFFSET_SHORTFALL_WEIGHT);
}

/**
 * Büntetés azért, mert a köztes pontot a motor messzire kapcsolta.
 *
 * A `snapped_waypoints` az összes kért pontot tartalmazza (rajt, köztesek,
 * cél) — a rajtot és a célt nem büntetjük, azok a felhasználó valódi helyei.
 */
function viaSnapPenalty(
  vias: readonly LatLng[],
  snapped: readonly LatLng[] | undefined,
): number {
  if (!snapped || snapped.length < vias.length + 2) return 0;
  let penalty = 0;
  for (let index = 0; index < vias.length; index += 1) {
    // A köztes pontok a rajt után, a cél előtt állnak.
    const snappedVia = snapped[index + 1];
    if (!snappedVia) continue;
    if (distanceM(vias[index]!, snappedVia) > VIA_SNAP_TOLERANCE_M) penalty += 5_000;
  }
  return penalty;
}

/**
 * Melyik oldalára esnek a felhasználó megállói az A–B tengelynek?
 *
 * Az átlagos előjeles oldaltávolság dönt. Ha a megállók épp a tengelyen
 * vannak, marad az alapértelmezett oldal.
 */
function sideOfStops(from: LatLng, to: LatLng, stops: readonly LatLng[]): RouteSide {
  let total = 0;
  for (const stop of stops) total += signedSideOffsetM(from, to, stop);
  return total < 0 ? 'right' : 'left';
}

/**
 * Az odaút a felhasználó megállóin át.
 *
 * Itt NINCS jelöltválasztás: a megállók kötelezőek, tehát egyetlen útvonal
 * létezik. A területi súlyozás megmarad, hogy a megállók között is a kívánt
 * oldalon haladjon, és a leggyorsabb vonalat itt is kerülje.
 */
async function planLegThroughStops(
  request: LegRequest & { stops: readonly LatLng[] },
): Promise<RouteLeg | null> {
  const customModel = legCustomModel(request);
  const route = await requestGraphHopperPath(
    [request.start, ...request.stops, request.end],
    request.ghProfile,
    customModel,
    { snapPrevention: SNAP_PREVENTION, passThrough: true },
  );
  if (!route) return null;
  return { route, points: decodePolyline(route.polyline) };
}

/**
 * Egy leg hibapontszáma — a jelöltek közül ez választ.
 *
 * A SORREND SZÁNDÉKOS, és Geri képeiből jött (2026-09-12):
 *
 *   1. **önmagába visszatérés** a legsúlyosabb. Ez a „bevisszük a
 *      Margitszigetre, aztán kihozzuk" és a tömb körüli hurok — a felhasználó
 *      ezt éli meg a legértelmetlenebbnek, és a spec is kimondja, hogy az
 *      útvonal lehetőleg ne keresztezze saját magát;
 *   2. a valódi **visszafordulás**;
 *   3. a lazább **rövidkerülő**-heurisztika.
 *
 * ⚠️ A VISSZATÉRÉS KÜLÖN MÉRTÉK, NEM A VISSZAFORDULÁS VÁLTOZATA. Amikor a
 * köztes pontnál `pass_through`-val megtiltottuk a megfordulást, a tervező egy
 * részüket HUROKKÁ alakította: a `countUTurns` szerint javult, a térképen nem.
 */
function legDefectScore(points: readonly LatLng[]): number {
  return (
    countSelfRevisits(points) * 10_000 +
    countUTurns(points) * 1_000 +
    countShortDetours(points)
  );
}

/**
 * A kör minőségi mutatói.
 *
 * A teljes kört EGY nyomvonalként is megmérjük (odaút + visszaút egymás után),
 * mert a visszafordulás és a rövid kitérő a két leg CSATLAKOZÁSÁNÁL is
 * keletkezhet — külön-külön mérve pont az maradna láthatatlan.
 */
export function measureLoopQuality(
  from: LatLng,
  to: LatLng,
  outboundPoints: readonly LatLng[],
  inboundPoints: readonly LatLng[],
  outboundSide: RouteSide = OUTBOUND_SIDE,
): LoopQuality {
  const full = [...outboundPoints, ...inboundPoints];
  const outboundSideM = meanSideOffsetM(from, to, outboundPoints);
  const inboundSideM = meanSideOffsetM(from, to, inboundPoints);

  return {
    uTurns: countUTurns(full),
    shortDetours: countShortDetours(full),
    sharedPathRatio: sharedPathRatio(outboundPoints, inboundPoints),
    outboundSideM,
    inboundSideM,
    // Ellentétes előjel: a két leg tényleg a vonal két oldalán megy. A
    // nullához közeli összeg nem baj — az a szimmetria, nem a szétválás hiánya.
    // A szétválás az ODAÚT oldalához mérve értendő: megállóknál ez lehet a
    // jobb oldal is, ilyenkor az előjelek megfordulnak.
    separated:
      outboundSide === 'left'
        ? outboundSideM > 0 && inboundSideM < 0
        : outboundSideM < 0 && inboundSideM > 0,
  };
}

/** Az útvonal átlagos előjeles oldaltávolsága a közvetlen A–B vonaltól. */
function meanSideOffsetM(from: LatLng, to: LatLng, points: readonly LatLng[]): number {
  if (points.length === 0) return 0;
  let total = 0;
  for (const point of points) total += signedSideOffsetM(from, to, point);
  return total / points.length;
}

/** A kör hossza a légvonalhoz képest — a felület ebből mutat becsült időt. */
export function detourRatio(loop: TwoSidedLoop, from: LatLng, to: LatLng): number {
  const direct = distanceM(from, to);
  return direct === 0 ? 0 : loop.totalDistanceM / (2 * direct);
}
