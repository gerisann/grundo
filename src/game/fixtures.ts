/**
 * Teszt-nyomvonalak a játékmotor ellenőrzéséhez.
 *
 * Miért generáljuk és nem GPX-fájlokat tárolunk: így determinisztikusak,
 * paraméterezhetők, verziókövetésben olvashatók, és nem kell bináris/XML
 * fixture-öket karbantartani. Ugyanezeket használja a fejlesztői
 * visszajátszó képernyő is.
 *
 * docs/06-architektura-es-admin.md → Fejlesztői eszköz: GPX-visszajátszó
 */

import type { TracePoint } from '@/types';

/** Egy referencia-pont Budapesten (Gazdagrét), a képernyőképek környéke. */
export const ORIGIN = { lat: 47.475, lng: 19.015 } as const;

const M_PER_DEG_LAT = 111_320;

function mPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/** Méteres eltolás egy alappontból. */
export function offset(base: { lat: number; lng: number }, eastM: number, northM: number) {
  return {
    lat: base.lat + northM / M_PER_DEG_LAT,
    lng: base.lng + eastM / mPerDegLng(base.lat),
  };
}

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (b.lat - a.lat) * M_PER_DEG_LAT;
  const dLng = (b.lng - a.lng) * mPerDegLng(a.lat);
  return Math.hypot(dLat, dLng);
}

export interface TraceOptions {
  /** Mintavételi távolság méterben (≈ sebesség × mintavételi idő). */
  stepM?: number;
  /** Kezdő időbélyeg. Fix érték, hogy a tesztek determinisztikusak legyenek. */
  startAt?: number;
  /** Másodperc két minta között. */
  intervalS?: number;
  /** Jelentett GPS-pontosság méterben. */
  accuracy?: number;
}

/**
 * Töréspontok listájából egyenletes mintavételű nyomvonalat épít.
 * A pontok között lineárisan interpolál — a valóságnál simább, de a
 * geometriai logika szempontjából ez pontosan a lényeg.
 */
export function buildTrace(
  waypoints: readonly { lat: number; lng: number }[],
  options: TraceOptions = {},
): TracePoint[] {
  const stepM = options.stepM ?? 3;
  const intervalS = options.intervalS ?? 1;
  const accuracy = options.accuracy ?? 8;
  let t = options.startAt ?? Date.UTC(2026, 7, 15, 8, 0, 0);

  const points: TracePoint[] = [];
  const first = waypoints[0];
  if (!first) return points;
  points.push({ ...first, t, accuracy });

  for (let i = 1; i < waypoints.length; i++) {
    const from = waypoints[i - 1]!;
    const to = waypoints[i]!;
    const segment = distanceM(from, to);
    const steps = Math.max(1, Math.round(segment / stepM));

    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      t += intervalS * 1000;
      points.push({
        lat: from.lat + (to.lat - from.lat) * f,
        lng: from.lng + (to.lng - from.lng) * f,
        t,
        accuracy,
      });
    }
  }
  return points;
}

/** Négyzet alakú kör töréspontjai, a középpont köré. */
export function squareWaypoints(
  center: { lat: number; lng: number },
  sideM: number,
): { lat: number; lng: number }[] {
  const h = sideM / 2;
  return [
    offset(center, -h, -h),
    offset(center, h, -h),
    offset(center, h, h),
    offset(center, -h, h),
    offset(center, -h, -h), // vissza a rajtba
  ];
}

/* ═══════════════════════════════════════════════════════════════════
   A nyolc fixture (docs/06)
   ═══════════════════════════════════════════════════════════════════ */

/** 1. Egyszerű kör: 200 m oldalú négyzet ≈ 40 000 m². */
export function simpleLoop(sideM = 200): TracePoint[] {
  return buildTrace(squareWaypoints(ORIGIN, sideM));
}

/**
 * 2. Nyolcas: két hurok, közös metszésponttal.
 * Elvárás: KÉT külön bezárás egyetlen aktivitásból.
 */
export function figureEight(sideM = 160): TracePoint[] {
  const h = sideM / 2;
  const north = offset(ORIGIN, 0, sideM);
  const south = offset(ORIGIN, 0, -sideM);
  return buildTrace([
    ORIGIN,
    offset(north, -h, -h),
    offset(north, -h, h),
    offset(north, h, h),
    offset(north, h, -h),
    ORIGIN, // első hurok zárul
    offset(south, h, h),
    offset(south, h, -h),
    offset(south, -h, -h),
    offset(south, -h, h),
    ORIGIN, // második hurok zárul
  ]);
}

/** 3. Többszörös kör: ugyanaz a négyzet N-szer → védelemépítés. */
export function multiLap(laps = 4, sideM = 200): TracePoint[] {
  const single = squareWaypoints(ORIGIN, sideM);
  const waypoints = [...single];
  for (let i = 1; i < laps; i++) waypoints.push(...single.slice(1));
  return buildTrace(waypoints);
}

/** 4. Nyitott útvonal: 1 km egyenes, nincs bezárás. */
export function openRoute(lengthM = 1000): TracePoint[] {
  return buildTrace([ORIGIN, offset(ORIGIN, lengthM, 0)]);
}

/**
 * 5. GPS-kihagyás: ugyanaz a négyzet, de az egyik oldal közepéről
 * hiányzik ~60 m-nyi minta. A `gridPathCells` hézagkitöltésének
 * vízhatlanul kell zárnia a falat.
 */
export function gpsGap(sideM = 200, gapM = 60): TracePoint[] {
  const points = simpleLoop(sideM);
  const start = Math.floor(points.length * 0.3);
  const skip = Math.round(gapM / 3);
  return [...points.slice(0, start), ...points.slice(start + skip)];
}

/**
 * 6. Ál-hurok: egyenes futás, közben pár méteres GPS-remegés, ami
 * visszaérint egy korábbi cellát. NEM adhat területet.
 */
export function selfTouch(): TracePoint[] {
  const line: { lat: number; lng: number }[] = [];
  for (let i = 0; i <= 40; i++) line.push(offset(ORIGIN, i * 10, 0));
  // remegés: kis oda-vissza a 20. pont körül
  const jitterAt = offset(ORIGIN, 200, 0);
  line.splice(
    20,
    0,
    offset(jitterAt, 0, 6),
    offset(jitterAt, 6, 6),
    offset(jitterAt, 6, 0),
    jitterAt,
  );
  return buildTrace(line, { stepM: 2 });
}

/**
 * 7. Túl nagy hurok: ~30 km-es „kör" (vonatút). A védőkorlátnak
 * el kell utasítania, MIELŐTT a polyfill memóriát falna.
 */
export function hugeBBox(sideM = 30_000): TracePoint[] {
  return buildTrace(squareWaypoints(ORIGIN, sideM), { stepM: 200, intervalS: 10 });
}

/** Kis kör egy megadott ponton — az elvétel-tesztekhez. */
export function loopAt(center: { lat: number; lng: number }, sideM = 200): TracePoint[] {
  return buildTrace(squareWaypoints(center, sideM));
}

export const FIXTURES = {
  'simple-loop': simpleLoop,
  'figure-eight': figureEight,
  'multi-lap': multiLap,
  'open-route': openRoute,
  'gps-gap': gpsGap,
  'self-touch': selfTouch,
  'huge-bbox': hugeBBox,
} as const;

export type FixtureName = keyof typeof FIXTURES;
