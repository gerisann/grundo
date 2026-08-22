import { describe, expect, it } from 'vitest';
import { GAMEPLAY } from '@/config/gameplay';
import { distanceM } from './geo';
import {
  averagePaceSecPerKm,
  cellOverlap,
  destinationPoint,
  directionsProfile,
  kindScore,
  loopRadiusM,
  loopWaypoints,
  missionBearings,
  pickMissions,
  targetDistanceKm,
  withinTolerance,
  type MissionCandidate,
} from './missions';
import type { CellFate, ClaimResult } from '@/types';

/** Budapest, Gazdagrét — ugyanaz a környék, amin a fixture-ök is futnak. */
const ORIGIN = { lat: 47.4735, lng: 19.0125 };

function claimOf(counts: Partial<Record<CellFate, number>>, stolenFrom: Record<string, number> = {}): ClaimResult {
  const full: Record<CellFate, number> = {
    free: counts.free ?? 0,
    reclaimed: counts.reclaimed ?? 0,
    stolen: counts.stolen ?? 0,
    breakthrough: counts.breakthrough ?? 0,
  };
  const owned = full.free + full.reclaimed + full.stolen;
  return {
    updates: new Map(),
    fates: new Map(),
    counts: full,
    stolenFrom,
    breakthroughFrom: {},
    weightedClaimM2: owned * GAMEPLAY.CELL_AREA_M2,
    gainedM2: (full.free + full.stolen) * GAMEPLAY.CELL_AREA_M2,
  };
}

function candidate(over: Partial<MissionCandidate> = {}): MissionCandidate {
  return {
    bearing: 0,
    distanceKm: 5,
    polyline: '',
    claim: claimOf({ free: 10 }),
    gainedM2: 3070,
    estimatedGp: 100,
    newBlocks: 0,
    cells: new Set(['a']),
    uTurns: 0,
    ...over,
  };
}

describe('1. Időből távolság', () => {
  it('a saját tempóból számol, nem általános átlagból', () => {
    // 45 perc 300 mp/km tempóval = 9 km; 600 mp/km-mel ugyanannyi idő 4,5 km.
    expect(targetDistanceKm(45, 300)).toBeCloseTo(9, 5);
    expect(targetDistanceKm(45, 600)).toBeCloseTo(4.5, 5);
  });

  it('hibás tempónál nem ad végtelen vagy negatív távot', () => {
    for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      const km = targetDistanceKm(45, bad);
      expect(Number.isFinite(km)).toBe(true);
      expect(km).toBeGreaterThan(0);
    }
  });

  it('átlagtempó a mintákból, a hibás rekordok kihagyásával', () => {
    // 10 km 3000 mp alatt = 300 mp/km. A nullás rekord nem ronthatja el.
    const pace = averagePaceSecPerKm([
      { distanceM: 5000, movingS: 1500 },
      { distanceM: 5000, movingS: 1500 },
      { distanceM: 0, movingS: 0 },
      { distanceM: 4000, movingS: 0 },
    ]);
    expect(pace).toBeCloseTo(300, 5);
  });

  it('null, ha egyetlen használható minta sincs', () => {
    expect(averagePaceSecPerKm([])).toBeNull();
    expect(averagePaceSecPerKm([{ distanceM: 0, movingS: 0 }])).toBeNull();
  });
});

describe('2. A kör geometriája', () => {
  it('a célpont tényleg a megadott távolságra van', () => {
    for (const bearing of [0, 45, 90, 180, 270, 315]) {
      const point = destinationPoint(ORIGIN, bearing, 1200);
      expect(distanceM(ORIGIN, point)).toBeCloseTo(1200, 0);
    }
  });

  it('a köztes pontok mind a kör sugarán vannak', () => {
    const targetKm = 5;
    const radius = loopRadiusM(targetKm);
    const bearing = 90;
    const centre = destinationPoint(ORIGIN, bearing, radius);

    for (const point of loopWaypoints(ORIGIN, bearing, targetKm)) {
      // 1 méteres tűrés a gömbi kerekítésre.
      expect(Math.abs(distanceM(centre, point) - radius)).toBeLessThan(1);
    }
  });

  it('a kiindulópont IS a körön van — oda kell visszaérni', () => {
    const radius = loopRadiusM(5);
    const centre = destinationPoint(ORIGIN, 210, radius);
    expect(Math.abs(distanceM(centre, ORIGIN) - radius)).toBeLessThan(1);
  });

  it('a kör kerülete a kerülő-szorzóval együtt adja a célhosszt', () => {
    const targetKm = 8;
    const circumferenceKm = (2 * Math.PI * loopRadiusM(targetKm)) / 1000;
    // A mértani kör RÖVIDEBB, mert a valódi útvonal kerülőkkel hosszabb.
    expect(circumferenceKm * GAMEPLAY.MISSION_DETOUR_FACTOR).toBeCloseTo(targetKm, 5);
  });

  it('minden irány más kört ad', () => {
    const first = loopWaypoints(ORIGIN, 0, 5)[0]!;
    const second = loopWaypoints(ORIGIN, 180, 5)[0]!;
    expect(distanceM(first, second)).toBeGreaterThan(100);
  });

  it('a konfigurált számú irányt adja, egyenletesen elosztva', () => {
    const bearings = missionBearings();
    expect(bearings).toHaveLength(GAMEPLAY.MISSION_BEARINGS);
    expect(bearings[0]).toBe(0);
    expect(new Set(bearings).size).toBe(bearings.length);
  });

  it('a tűréshatár a dokumentált ±15 %', () => {
    expect(withinTolerance(10, 10)).toBe(true);
    expect(withinTolerance(11.4, 10)).toBe(true);
    expect(withinTolerance(11.6, 10)).toBe(false);
    expect(withinTolerance(8.6, 10)).toBe(true);
    expect(withinTolerance(8.4, 10)).toBe(false);
  });
});

describe('3. Karakter-illeszkedés', () => {
  it('mindegyik karakter a SAJÁT mértékét nézi', () => {
    const mixed = candidate({
      claim: claimOf({ free: 3, stolen: 7, reclaimed: 5 }),
      newBlocks: 2,
    });
    expect(kindScore(mixed, 'conquest')).toBe(3);
    expect(kindScore(mixed, 'raid')).toBe(7);
    expect(kindScore(mixed, 'fortify')).toBe(5);
    expect(kindScore(mixed, 'explore')).toBe(2);
  });

  it('bezárás nélkül minden karakterre nulla', () => {
    const empty = candidate({ claim: null });
    expect(kindScore(empty, 'conquest')).toBe(0);
    expect(kindScore(empty, 'raid')).toBe(0);
  });

  it('a felfedezés SEMMIT nem ér, ha egyetlen mezőt sem lehet szerezni', () => {
    /*
      Végig védett idegen zóna: csupa ismeretlen körzet, de a claim csak
      áttörés — egyetlen mező sem cserél gazdát. Ilyet nem ajánlunk fel,
      mert a kártyán „3 új körzet" állna, a Terület rovatban meg nulla.
    */
    const walled = candidate({ claim: claimOf({ breakthrough: 40 }), newBlocks: 6 });
    expect(kindScore(walled, 'explore')).toBe(0);

    // Egyetlen megszerezhető mező már elég, hogy legyen értelme elmenni.
    const withGain = candidate({ claim: claimOf({ breakthrough: 40, free: 1 }), newBlocks: 6 });
    expect(kindScore(withGain, 'explore')).toBe(6);
  });

  it('a bringa a kerékpáros útvonalprofilt kapja', () => {
    expect(directionsProfile('ride')).toBe('cycling');
    expect(directionsProfile('run')).toBe('walking');
    expect(directionsProfile('walk')).toBe('walking');
  });
});

describe('4. Átfedés', () => {
  it('azonos halmaz teljes átfedés, idegen halmaz nulla', () => {
    expect(cellOverlap(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(cellOverlap(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('a fele közös halmaz a Jaccard-értéket adja', () => {
    // metszet 2, unió 6 → 1/3
    expect(cellOverlap(new Set(['a', 'b', 'c', 'd']), new Set(['c', 'd', 'e', 'f']))).toBeCloseTo(1 / 3, 5);
  });
});

describe('5. Válogatás', () => {
  it('karakterenként legfeljebb egy ajánlat, és mindegyik más jelöltből', () => {
    const missions = pickMissions([
      candidate({ claim: claimOf({ free: 40 }), cells: new Set(['a1']) }),
      candidate({ claim: claimOf({ stolen: 30 }), cells: new Set(['b1']) }),
      candidate({ claim: claimOf({ reclaimed: 20 }), cells: new Set(['c1']) }),
      candidate({ claim: claimOf({ free: 1 }), newBlocks: 9, cells: new Set(['d1']) }),
    ]);

    expect(missions).toHaveLength(4);
    expect(new Set(missions.map((m) => m.kind)).size).toBe(4);
    expect(new Set(missions.map((m) => m.cells)).size).toBe(4);
  });

  it('a kiosztás NEM függ a karakterek sorrendjétől', () => {
    /*
      A rajtaütés-jelölt a saját mezőnyében kiugró (30 a 30-ból), a hódítás-
      jelölt viszont csak közepes. Ha egyszerűen sorban osztanánk, a hódítás
      vinné el az erősebb jelöltet — a normalizálás ezt zárja ki.
    */
    const raider = candidate({ claim: claimOf({ free: 5, stolen: 30 }), cells: new Set(['r']) });
    const conqueror = candidate({ claim: claimOf({ free: 40, stolen: 1 }), cells: new Set(['c']) });

    const missions = pickMissions([raider, conqueror]);
    const raid = missions.find((m) => m.kind === 'raid');
    const conquest = missions.find((m) => m.kind === 'conquest');

    expect(raid?.cells).toBe(raider.cells);
    expect(conquest?.cells).toBe(conqueror.cells);
  });

  it('a majdnem azonos útvonalat nem ajánlja fel kétszer, más címkével', () => {
    // Ugyanaz a tíz cella, csak az egyikben eggyel több — ez ugyanaz a kör.
    const shared = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    const first = candidate({ claim: claimOf({ free: 30 }), cells: new Set(shared) });
    const twin = candidate({ claim: claimOf({ stolen: 30 }), cells: new Set([...shared, '11']) });

    const missions = pickMissions([first, twin]);
    expect(missions).toHaveLength(1);
  });

  it('a bezárás nélküli jelölt nem kerül be', () => {
    expect(pickMissions([candidate({ claim: null })])).toHaveLength(0);
    expect(pickMissions([])).toHaveLength(0);
  });

  it('a legnagyobb károsultat jelöli meg célpontként', () => {
    const missions = pickMissions([
      candidate({
        claim: claimOf({ stolen: 12 }, { kata: 3, peti: 9 }),
        cells: new Set(['x']),
      }),
    ]);
    expect(missions[0]?.topVictimUid).toBe('peti');
    expect(missions[0]?.topVictimCells).toBe(9);
  });

  it('nulla pontszámú karakterre nem gyárt ajánlatot', () => {
    // Csak szabad mezők: rajtaütésre és erősítésre nincs mit ajánlani.
    const missions = pickMissions([candidate({ claim: claimOf({ free: 10 }), cells: new Set(['a']) })]);
    expect(missions.map((m) => m.kind)).toEqual(['conquest']);
  });
});
