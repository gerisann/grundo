/**
 * Küldetés-ajánló — a tiszta rész.
 *
 * Ez NEM egyszerű útvonaltervező. A bemenet IDŐ vagy TÁVOLSÁG, a kimenet pedig
 * játékbeli tét: mennyi területet szerezhetsz, kitől vehetsz el, melyik
 * zónád védelme nő. A „fuss 8 km-t" logika bármelyik futóappban megvan; a
 * GRUNDO-ban az útvonalnak következménye van a rácson.
 *
 * MI VAN ITT, ÉS MI NINCS:
 *
 *   ITT van a geometria (hol legyenek a kör pontjai) és a válogatás (melyik
 *   jelöltből melyik küldetés lesz) — tiszta függvények, I/O nélkül, tehát
 *   emulátor és hálózat nélkül tesztelhetők.
 *
 *   NINCS itt az úthálózat lekérdezése (az `server/src/lib/directions.ts`,
 *   mert hálózati hívás) és a birtokviszony beolvasása (az a `grid.ts`,
 *   mert Firestore). A `src/game/` modul közös a klienssel — ide se DOM, se
 *   Firebase, se Node API nem kerülhet (AGENTS.md 4. szabály).
 *
 * A JELÖLTEK ÉRTÉKELÉSE a valódi motorral megy: `traceToCellPath` →
 * `detectLoopsDetailed` → `resolveClaim`. Nincs külön „becslő" algoritmus,
 * ami eltérhetne az élestől — amit a küldetés ígér, azt ugyanaz a kód
 * számolja ki, ami a tényleges futás után a területet adja.
 *
 * docs/02-funkcionalis-spec.md → Útvonalak fül — Küldetés-ajánló
 */

import { DEFAULT_GAMEPLAY, type GameplayConfig } from '@/config/gameplay';
import type { ActivityType, ClaimResult } from '@/types';
import type { LatLng } from './geo';

/**
 * A négy küldetés-karakter.
 *
 * Szándékosan négy KÜLÖNBÖZŐ motiváció, nem ugyanannak a négy fokozata: aki
 * terjeszkedni akar, aki vissza akar vágni, aki a meglévőt védené, és aki
 * új helyeket akar látni. A docs/02 táblázata ezt a négyet nevesíti.
 */
export type MissionKind = 'conquest' | 'raid' | 'fortify' | 'explore';

export const MISSION_KINDS: readonly MissionKind[] = [
  'conquest',
  'raid',
  'fortify',
  'explore',
];

/** A Föld közepes sugara méterben (WGS-84 szerinti átlag). */
const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/* ════════════════════════════════════════════════════════════════════════
   1. Időből távolság
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Mennyit tesz meg a felhasználó a vállalt idő alatt?
 *
 * A tempó a SAJÁTJA, a korábbi aktivitásaiból — nem egy általános átlag. Aki
 * lassabban fut, rövidebb kört kap ugyanarra a 45 percre, és így ugyanúgy
 * visszaér. Ha még nincs elég mért aktivitása, a típus szerinti alapérték
 * ugrik be (`MISSION_DEFAULT_PACE_S_PER_KM`).
 */
export function targetDistanceKm(
  minutes: number,
  paceSecPerKm: number,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): number {
  const pace = Number.isFinite(paceSecPerKm) && paceSecPerKm > 0
    ? paceSecPerKm
    : cfg.MISSION_DEFAULT_PACE_S_PER_KM.run;
  return (minutes * 60) / pace;
}

/**
 * Átlagtempó (mp/km) korábbi aktivitásokból.
 *
 * A NULLA VAGY HIÁNYZÓ mintát kihagyjuk, nem nullaként vesszük: egy elrontott
 * (0 másodperces) aktivitás különben lehúzná az átlagot, és irreálisan hosszú
 * kört ajánlanánk. Ha egyetlen használható minta sincs, `null` — a hívó ilyenkor
 * az alapértékkel számol.
 */
export function averagePaceSecPerKm(
  samples: readonly { distanceM: number; movingS: number }[],
): number | null {
  let distanceM = 0;
  let movingS = 0;
  for (const sample of samples) {
    if (!(sample.distanceM > 0) || !(sample.movingS > 0)) continue;
    distanceM += sample.distanceM;
    movingS += sample.movingS;
  }
  if (distanceM <= 0 || movingS <= 0) return null;
  return movingS / (distanceM / 1000);
}

/* ════════════════════════════════════════════════════════════════════════
   2. A kör geometriája
   ════════════════════════════════════════════════════════════════════════ */

/** Célpont adott irányban és távolságban — gömbi képlet. */
export function destinationPoint(origin: LatLng, bearingDeg: number, distanceM: number): LatLng {
  const angular = distanceM / EARTH_RADIUS_M;
  const bearing = bearingDeg * RAD;
  const lat1 = origin.lat * RAD;
  const lng1 = origin.lng * RAD;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  // A hosszúság −180…180 közé normalizálva, hogy a dátumvonalon se csússzon el.
  return { lat: lat2 * DEG, lng: (((lng2 * DEG + 540) % 360) - 180) };
}

/**
 * Egy kör pontjai, ami ÁTMEGY a kiindulóponton.
 *
 * A kör középpontja a `bearingDeg` irányban van, `radius` távolságra — így a
 * felhasználó a kör egy pontjáról indul, körbemegy, és oda ér vissza. A nyolc
 * irány nyolc különböző kört ad: mindegyik más városrész felé nyit.
 *
 * A visszaadott lista a KÖZTES pontokat tartalmazza, a kiinduló nélkül: azt a
 * hívó teszi az elejére és a végére (start és cél ugyanaz).
 */
export function loopWaypoints(
  origin: LatLng,
  bearingDeg: number,
  targetKm: number,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): LatLng[] {
  const radiusM = loopRadiusM(targetKm, cfg);
  const centre = destinationPoint(origin, bearingDeg, radiusM);

  // A kiindulópont a középponthoz képest az ELLENTÉTES irányban van.
  const originAngle = bearingDeg + 180;
  const count = Math.max(2, Math.round(cfg.MISSION_WAYPOINTS));
  const step = 360 / (count + 1);

  const points: LatLng[] = [];
  for (let index = 1; index <= count; index += 1) {
    points.push(destinationPoint(centre, originAngle + index * step, radiusM));
  }
  return points;
}

/**
 * A kör sugara a célhosszból.
 *
 * A kerület `2πr` lenne egy tökéletes körnél — de a valódi útvonal hosszabb,
 * mert utcákon megy. A `MISSION_DETOUR_FACTOR` ezt fogja meg: a sugarat
 * ennyivel kisebbre vesszük, hogy a TÉNYLEGES útvonal érjen a célhosszra.
 */
export function loopRadiusM(targetKm: number, cfg: GameplayConfig = DEFAULT_GAMEPLAY): number {
  const detour = cfg.MISSION_DETOUR_FACTOR > 0 ? cfg.MISSION_DETOUR_FACTOR : 1;
  return Math.max(1, (targetKm * 1000) / detour / (2 * Math.PI));
}

/** A nyolc (vagy ahány konfigurált) indulási irány, fokban. */
export function missionBearings(cfg: GameplayConfig = DEFAULT_GAMEPLAY): number[] {
  const count = Math.max(1, Math.round(cfg.MISSION_BEARINGS));
  const step = 360 / count;
  return Array.from({ length: count }, (_, index) => index * step);
}

/** Belefér-e a jelölt a célhossz ±tűréshatárába? */
export function withinTolerance(
  actualKm: number,
  targetKm: number,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): boolean {
  if (!(targetKm > 0)) return false;
  return Math.abs(actualKm - targetKm) / targetKm <= cfg.MISSION_DISTANCE_TOLERANCE;
}

/* ════════════════════════════════════════════════════════════════════════
   3. A jelöltek értékelése és válogatása
   ════════════════════════════════════════════════════════════════════════ */

/** Egy kiértékelt jelölt — a hívó tölti ki a valódi motor eredményéből. */
export interface MissionCandidate {
  /** Melyik irányból jött (fok) — csak diagnosztikához. */
  bearing: number;
  distanceKm: number;
  /** A tervezett útvonal, kódolt vonalláncként (Mapbox/Google alak). */
  polyline: string;
  /** A bezárások eredménye a JELENLEGI birtokviszony ellen. `null` = nem zárt kört. */
  claim: ClaimResult | null;
  /** A megszerezhető terület m²-ben. */
  gainedM2: number;
  /** Becsült GP a valódi képlettel. */
  estimatedGp: number;
  /** Hány olyan blokkot érint, ahol a felhasználónak MOST semmije nincs. */
  newBlocks: number;
  /**
   * Hány fölösleges visszafordulás van az útvonalon (`countUTurns`).
   *
   * NEM játékérték: két azonos tétű kör közül ez dönti el, melyiken kellemesebb
   * végigmenni. Lásd `routeShape.ts` — ott áll, mit mértem és mit vetettem el.
   */
  uTurns: number;
  /** Az összes érintett (fal + belső) cella — az átfedés-vizsgálathoz. */
  cells: ReadonlySet<string>;
}

/** Egy kiválasztott küldetés. */
export interface Mission extends MissionCandidate {
  kind: MissionKind;
  /** A küldetés tétje az adott karakter szerint (m², vagy `explore`-nál blokk). */
  headlineValue: number;
  /** Kitől vennénk el a legtöbbet — a hívó oldja fel névre, ha szabad. */
  topVictimUid: string | null;
  topVictimCells: number;
}

/**
 * Mennyire illik a jelölt az adott karakterhez?
 *
 * Mindegyik a SAJÁT mértékét nézi: a hódítás a szabad mezőket, a rajtaütés az
 * elvehetőket, az erősítés a sajátokat, a felfedezés az ismeretlen blokkokat.
 * Nulla azt jelenti, hogy ez a jelölt erre a karakterre alkalmatlan — nem
 * „gyenge", hanem nem az.
 */
export function kindScore(candidate: MissionCandidate, kind: MissionKind): number {
  const counts = candidate.claim?.counts;
  if (!counts) return 0;
  switch (kind) {
    case 'conquest':
      return counts.free;
    case 'raid':
      return counts.stolen;
    case 'fortify':
      return counts.reclaimed;
    case 'explore':
      /*
        ⚠️ A FELFEDEZÉSHEZ SZEREZNI IS KELL VALAMIT.

        Az „új körzet" önmagában nem elég. Egy végig VÉDETT idegen zóna is
        csupa ismeretlen körzet, de egyetlen mezőt sem ad — csak áttörést.
        Ilyen ajánlat csapda lenne: a kártyán ott állna, hogy „3 körzet, ahol
        még egyetlen meződ sincs", a Terület rovatban meg nulla. Emulátoros
        teszt fogta meg (`missionEvaluate.emulator.test.ts` → „védett idegen
        területen NEM ígér tulajdonszerzést").
      */
      return counts.free + counts.stolen > 0 ? candidate.newBlocks : 0;
  }
}

/**
 * Két jelölt fedi-e egymást annyira, hogy ugyanannak számítson?
 *
 * A docs „3 ÉRDEMBEN KÜLÖNBÖZŐ ajánlat"-ot kér. Két szomszédos irányból
 * generált kör bőven adhat majdnem azonos útvonalat — ha mindkettőt
 * felajánlanánk, a felhasználó ugyanazt látná kétszer, más címkével.
 *
 * Jaccard-hasonlóság a megszerzett cellákon: a metszet és az unió aránya.
 */
export function cellOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const cell of small) if (large.has(cell)) shared += 1;
  const union = a.size + b.size - shared;
  return union > 0 ? shared / union : 0;
}

/** E fölött két ajánlat ugyanannak számít, és a gyengébbik kiesik. */
const MAX_MISSION_OVERLAP = 0.6;

/**
 * Ekkora normalizált különbségen belül két jelölt DÖNTETLEN.
 *
 * A döntetlent az útvonal tisztasága bontja fel (kevesebb visszafordulás nyer).
 * A lépcső azért kell, mert a nyers pontszámok szinte sosem egyeznek pontosan —
 * tisztán utolsó szempontként a tisztaság gyakorlatilag soha nem érvényesülne.
 *
 * ⚠️ A JÁTÉKÉRTÉKET NEM ÍRJA FELÜL. Öt százalék az a sáv, amin belül a két
 * ajánlat tétje a felhasználó szemében úgyis egyforma; ennél nagyobb
 * különbségnél mindig az erősebb küldetés nyer, akármilyen kacskaringós.
 *
 * Mérve (2026-08-22, 3 kiindulás × 8 irány): a tisztaság előnyben részesítése
 * a bezárt területből ~1%-ot vitt el, míg a Directions `continue_straight=true`
 * beállítása 25%-ot. Ezért választás, nem paraméter.
 */
const SCORE_TIE_BAND = 0.05;

/**
 * A végső válogatás: karakterenként a legjobb, egymástól érdemben eltérő.
 *
 * A KIOSZTÁS SORREND-FÜGGETLEN. Ha egyszerűen végigmennénk a karaktereken és
 * mindegyikhez elvinnénk a legjobb szabad jelöltet, az első karakter mindig
 * előnyt élvezne — pedig semmi nem indokolja, hogy a hódítás fontosabb legyen
 * a rajtaütésnél.
 *
 * Ehelyett minden (jelölt, karakter) párt a SAJÁT karakterén belül
 * normalizálunk (a legjobbhoz viszonyítva 0…1), és mindig a globálisan
 * legerősebb párt kötjük össze. Így az nyer, ami a saját mezőnyében a
 * legkiugróbb — függetlenül attól, melyik karakter került előre a listán.
 */
export function pickMissions(candidates: readonly MissionCandidate[]): Mission[] {
  const usable = candidates.filter((candidate) => candidate.claim !== null);
  if (usable.length === 0) return [];

  const best = new Map<MissionKind, number>();
  for (const kind of MISSION_KINDS) {
    best.set(kind, Math.max(...usable.map((candidate) => kindScore(candidate, kind)), 0));
  }

  interface Pair {
    candidate: MissionCandidate;
    kind: MissionKind;
    normalized: number;
    raw: number;
  }

  const pairs: Pair[] = [];
  for (const candidate of usable) {
    for (const kind of MISSION_KINDS) {
      const raw = kindScore(candidate, kind);
      if (raw <= 0) continue;
      const top = best.get(kind) ?? 0;
      pairs.push({ candidate, kind, raw, normalized: top > 0 ? raw / top : 0 });
    }
  }

  /*
    A legerősebb pár nyer — de a normalizált értéket SÁVOKBAN nézzük.

    Egy sávon belül a jelöltek tétje gyakorlatilag egyforma, és ilyenkor az
    útvonal minősége dönt: a kevesebb fölösleges visszafordulású nyer. Utána
    a nagyobb nyers szám, végül a több GP — hogy a sorrend determinisztikus
    maradjon.
  */
  const band = (value: number) => Math.round(value / SCORE_TIE_BAND);
  pairs.sort(
    (a, b) =>
      band(b.normalized) - band(a.normalized) ||
      a.candidate.uTurns - b.candidate.uTurns ||
      b.normalized - a.normalized ||
      b.raw - a.raw ||
      b.candidate.estimatedGp - a.candidate.estimatedGp,
  );

  const missions: Mission[] = [];
  const usedKinds = new Set<MissionKind>();
  const usedCandidates = new Set<MissionCandidate>();

  for (const pair of pairs) {
    if (usedKinds.has(pair.kind) || usedCandidates.has(pair.candidate)) continue;
    // Túl hasonló ajánlatot nem veszünk fel másodszor, más címkével.
    if (missions.some((mission) => cellOverlap(mission.cells, pair.candidate.cells) > MAX_MISSION_OVERLAP)) {
      continue;
    }

    usedKinds.add(pair.kind);
    usedCandidates.add(pair.candidate);
    missions.push(toMission(pair.candidate, pair.kind, pair.raw));
  }

  return missions;
}

function toMission(
  candidate: MissionCandidate,
  kind: MissionKind,
  score: number,
): Mission {
  const stolenFrom = candidate.claim?.stolenFrom ?? {};
  let topVictimUid: string | null = null;
  let topVictimCells = 0;
  for (const [uid, cells] of Object.entries(stolenFrom)) {
    if (cells > topVictimCells) {
      topVictimUid = uid;
      topVictimCells = cells;
    }
  }

  return {
    ...candidate,
    kind,
    // A `explore` tétje blokkban értendő, a többié cellában — a hívó váltja m²-re.
    headlineValue: score,
    topVictimUid,
    topVictimCells,
  };
}

/** A típushoz tartozó Mapbox útvonalprofil. */
export function directionsProfile(type: ActivityType): 'walking' | 'cycling' {
  return type === 'ride' ? 'cycling' : 'walking';
}
