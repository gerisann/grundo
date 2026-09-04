/**
 * Beépített teljesítményteszt-útvonal a LAB E2E indítójához (GRUNDO #32).
 *
 * MIÉRT KELL: a LAB E2E a mentett scenariókat a böngésző `localStorage`-ából
 * olvassa, ami eszközhöz kötött — az asztali gépen megrajzolt útvonal SOSEM
 * jut át a telefonra. Márpedig a főszál-terhelést csak valódi eszközön lehet
 * megmérni. Ez a scenario ezért kódban él: minden eszközön ott van, rajzolás
 * nélkül.
 *
 * MIÉRT PONT EZ AZ ÚTVONAL: pontosan ez futott az asztali mérőpadon
 * (GRUNDO #32, `tmp/perf/`), tehát a telefonon leolvasott ezredmásodperc
 * közvetlenül összevethető a 23 ms-os asztali értékkel. Oda-vissza kanyargó
 * („boustrophedon") városi minta, a végén egyenes visszatéréssel a
 * kiindulópontba — így hurkot ZÁR, és pont a hurokzárás az, ami a
 * `processActivityGeometry()` költségét megugrasztja.
 */

import {
  DEFAULT_GPS_SIMULATION_CONFIG,
  type SimulationWaypoint,
} from '@/tracking/simulationSource';
import type { LabPhase, LabPlayer } from './labScenarioEngine';

/** Budapest, Kálvin tér környéke — a LAB többi mérése is innen indul. */
const ORIGIN = { lat: 47.4979, lng: 19.0402 };
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** Egy „utcányi" sáv hossza és a sávok távolsága méterben. */
const LEG_LENGTH_M = 600;
const ROW_SPACING_M = 200;

function offset(eastM: number, northM: number): SimulationWaypoint {
  return {
    lat: ORIGIN.lat + northM / M_PER_DEG_LAT,
    lng: ORIGIN.lng + eastM / M_PER_DEG_LNG,
  };
}

function cityRoute(legs: number): SimulationWaypoint[] {
  const route: SimulationWaypoint[] = [offset(0, 0)];
  for (let row = 0; row < legs; row += 1) {
    const eastEnd = row % 2 === 0 ? LEG_LENGTH_M : 0;
    route.push(offset(eastEnd, row * ROW_SPACING_M));
    route.push(offset(eastEnd, (row + 1) * ROW_SPACING_M));
  }
  route.push(offset(0, legs * ROW_SPACING_M));
  route.push(offset(0, 0));
  return route;
}

const PERF_PLAYER: LabPlayer = { id: 'perf-rider', name: 'Mérés (te)' };

/**
 * A mérőpaddal AZONOS paraméterek. Ha ezeken változtatsz, a telefonon kapott
 * szám többé nem vethető össze a `tmp/perf/` asztali értékeivel.
 */
const PERF_CONFIG = {
  ...DEFAULT_GPS_SIMULATION_CONFIG,
  activityType: 'ride' as const,
  speedKmh: 25,
  sampleIntervalS: 1,
  seed: 4242,
};

function phase(id: string, name: string, legs: number): LabPhase {
  return {
    id,
    name,
    runs: [
      {
        id: `${id}-run`,
        playerId: PERF_PLAYER.id,
        route: cityRoute(legs),
        config: PERF_CONFIG,
      },
    ],
  };
}

export interface BuiltInLabScenario {
  id: string;
  name: string;
  savedAt: number;
  players: LabPlayer[];
  phases: LabPhase[];
  tieBreakSeed: number;
}

/** Erről az id-ről ismeri fel az indító, hogy valós idejű lejátszás kell. */
export const PERF_SCENARIO_ID = 'builtin-perf-city';

export const PERF_TEST_SCENARIO: BuiltInLabScenario = {
  id: PERF_SCENARIO_ID,
  name: '⏱ Teljesítményteszt · városi kör (beépített)',
  savedAt: 0,
  players: [PERF_PLAYER],
  phases: [
    phase('perf-short', 'Rövid · ~6 km, kb. 14 perc', 6),
    phase('perf-full', 'Teljes · ~12 km, kb. 29 perc', 12),
  ],
  tieBreakSeed: 1,
};
