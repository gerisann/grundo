/**
 * A birtoklási szabályok tesztjei.
 *
 * docs/03-jatekszabalyok.md → Birtoklási szabályok
 */

import { describe, expect, it } from 'vitest';
import { gridDisk, latLngToCell } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import { absorbIsolatedRivalCells, multiplierFor, resolveClaim } from './claim';
import { processActivity } from './index';
import { traceToCellPath } from './cells';
import { detectLoops, loopCells } from './loops';
import { multiLap, simpleLoop } from './fixtures';
import type { CellOwnership, OwnershipMap } from '@/types';

const ME = 'user-me';
const RIVAL = 'user-rival';

function ownership(entries: Record<string, CellOwnership>): OwnershipMap {
  return new Map(Object.entries(entries));
}

describe('resolveClaim — cellánkénti szabályok', () => {
  it('szabad cella: a tiéd lesz, védelem 1', () => {
    const result = resolveClaim(new Set(['a', 'b']), new Map(), ME);
    expect(result.counts.free).toBe(2);
    expect(result.updates.get('a')).toEqual({ owner: ME, defense: 1 });
    expect(result.gainedM2).toBeCloseTo(2 * GAMEPLAY.CELL_AREA_M2, 2);
  });

  it('saját cella: a védelem nő, a szorzó az ÚJ szint szerint jár', () => {
    const result = resolveClaim(
      new Set(['a']),
      ownership({ a: { owner: ME, defense: 1 } }),
      ME,
    );
    expect(result.counts.reclaimed).toBe(1);
    expect(result.updates.get('a')).toEqual({ owner: ME, defense: 2 });
    // 2-es szint szorzója 1,5
    expect(result.weightedClaimM2).toBeCloseTo(GAMEPLAY.CELL_AREA_M2 * 1.5, 2);
    // Újrafoglalásnál nem NYERTÉL területet, csak megerősítetted
    expect(result.gainedM2).toBe(0);
  });

  it('a védelem 5-nél megáll', () => {
    const result = resolveClaim(
      new Set(['a']),
      ownership({ a: { owner: ME, defense: 5 } }),
      ME,
    );
    expect(result.updates.get('a')?.defense).toBe(GAMEPLAY.MAX_DEFENSE);
  });

  it('idegen cella védelem nélkül: elveszed', () => {
    const result = resolveClaim(
      new Set(['a']),
      ownership({ a: { owner: RIVAL, defense: 1 } }),
      ME,
    );
    expect(result.counts.stolen).toBe(1);
    expect(result.updates.get('a')).toEqual({ owner: ME, defense: 1 });
    expect(result.stolenFrom[RIVAL]).toBe(1);
  });

  it('idegen cella védve: NEM cserél gazdát, csak a védelem csökken', () => {
    const result = resolveClaim(
      new Set(['a']),
      ownership({ a: { owner: RIVAL, defense: 3 } }),
      ME,
    );
    expect(result.counts.breakthrough).toBe(1);
    expect(result.updates.get('a')).toEqual({ owner: RIVAL, defense: 2 });
    expect(result.gainedM2).toBe(0);
    // A károsult akkor is értesül, ha nem vesztett területet
    expect(result.stolenFrom).toHaveProperty(RIVAL);
  });

  it('vegyes halmaz: minden cella a saját szabálya szerint', () => {
    const result = resolveClaim(
      new Set(['free', 'mine', 'weak', 'strong']),
      ownership({
        mine: { owner: ME, defense: 2 },
        weak: { owner: RIVAL, defense: 1 },
        strong: { owner: RIVAL, defense: 4 },
      }),
      ME,
    );
    expect(result.counts).toEqual({ free: 1, reclaimed: 1, stolen: 1, breakthrough: 1 });
    expect(result.updates.get('strong')).toEqual({ owner: RIVAL, defense: 3 });
  });
});

describe('multiplierFor', () => {
  it('a doksi táblája szerint', () => {
    // A nyíl kell: a `multiplierFor` második paramétere a konfiguráció, a
    // `map` viszont az INDEXET adná át neki.
    expect([1, 2, 3, 4, 5].map((d) => multiplierFor(d))).toEqual([1.0, 1.5, 2.0, 3.0, 5.0]);
  });
});

describe('absorbIsolatedRivalCells', () => {
  const center = latLngToCell(47.4979, 19.0402, GAMEPLAY.H3_RESOLUTION);
  const scope = new Set(gridDisk(center, 2));
  const orphan = gridDisk(center, 1).find((cell) => cell !== center)!;

  it('átveszi a frissen szerzett terület mellett egyedül maradt 1-es mezőt', () => {
    const before: OwnershipMap = new Map([[orphan, { owner: RIVAL, defense: 1 }]]);
    const initial = resolveClaim(new Set([center]), before, ME);
    const result = absorbIsolatedRivalCells(initial, before, ME, scope);

    expect(result.absorbed).toEqual(new Set([orphan]));
    expect(result.claim?.updates.get(orphan)).toEqual({ owner: ME, defense: 1 });
    expect(result.claim?.stolenFrom[RIVAL]).toBe(1);
  });

  it('nem kerüli meg a 2-es vagy erősebb védelmet', () => {
    const before: OwnershipMap = new Map([[orphan, { owner: RIVAL, defense: 2 }]]);
    const initial = resolveClaim(new Set([center]), before, ME);
    const result = absorbIsolatedRivalCells(initial, before, ME, scope);

    expect(result.absorbed.size).toBe(0);
    expect(result.claim?.updates.has(orphan)).toBe(false);
  });

  it('nem vesz át több mezőből álló rivális maradványt', () => {
    const connected = gridDisk(orphan, 1).find(
      (cell) => cell !== orphan && cell !== center && scope.has(cell),
    )!;
    const before: OwnershipMap = new Map([
      [orphan, { owner: RIVAL, defense: 1 }],
      [connected, { owner: RIVAL, defense: 1 }],
    ]);
    const initial = resolveClaim(new Set([center]), before, ME);
    const result = absorbIsolatedRivalCells(initial, before, ME, scope);

    expect(result.absorbed.size).toBe(0);
  });
});

describe('processActivity — több bezárás egy aktivitásban', () => {
  it('négy kör után a védelem 4× lesz ugyanazon a területen', () => {
    const result = processActivity({
      points: multiLap(4, 200),
      type: 'run',
      distanceKm: 3.2,
      actorId: ME,
      ownership: new Map(),
      streakDays: 1,
      gpEarnedToday: 0,
    });

    expect(result.loops).toHaveLength(4);

    const defenses = [...(result.claim?.updates.values() ?? [])].map((o) => o.defense);
    expect(Math.max(...defenses)).toBe(4);
  });

  it('a négy kör többet ér, mint négyszer az alapérték — ez a szorzók lényege', () => {
    const single = processActivity({
      points: simpleLoop(200),
      type: 'run',
      distanceKm: 0.8,
      actorId: ME,
      ownership: new Map(),
      streakDays: 1,
      gpEarnedToday: 0,
    });

    const four = processActivity({
      points: multiLap(4, 200),
      type: 'run',
      distanceKm: 3.2,
      actorId: ME,
      ownership: new Map(),
      streakDays: 1,
      gpEarnedToday: 0,
    });

    /**
     * Négy kör után a védelem 4-es, aminek a szorzója 3× — tehát a négyszer
     * megfutott kör HÁROMSZOR annyi igénypontot ér, mint az egyszeri.
     *
     * Korábban 7,5× volt (1 + 1,5 + 2 + 3), mert körönként külön fizettünk.
     * Ez tiszta körnél működött, egy valódi városi útvonalon viszont a
     * hurkok erősen átfedik egymást, és ugyanaz a cella tízszer is fizetett:
     * élesben 149 666 GP jött ki egy 11 km-es bringaútra.
     *
     * A mai szabály cellánként egyszer fizet, a VÉGSŐ védelmi szint szerint.
     * A körbe-körbe futás jutalma megmarad, de felülről korlátos: 5× a
     * legtöbb, amit egy cella érhet.
     */
    expect(four.gp.claim).toBeCloseTo(single.gp.claim * 3, 0);
  });

  it('a megszerzett terület nem duplázódik a körök számával', () => {
    const single = processActivity({
      points: simpleLoop(200),
      type: 'run',
      distanceKm: 0.8,
      actorId: ME,
      ownership: new Map(),
      streakDays: 1,
      gpEarnedToday: 0,
    });
    const four = processActivity({
      points: multiLap(4, 200),
      type: 'run',
      distanceKm: 3.2,
      actorId: ME,
      ownership: new Map(),
      streakDays: 1,
      gpEarnedToday: 0,
    });
    // Ugyanaz a terület — a körök nem adnak hozzá új km²-t
    expect(four.areaGainedM2).toBeCloseTo(single.areaGainedM2, -2);
  });

  it('idegen területet elvesz, és jelenti, kitől', () => {
    const { path } = traceToCellPath(simpleLoop(200));
    const [loop] = detectLoops(path);
    const rivalCells = [...loopCells(loop!)].slice(0, 30);
    const map: OwnershipMap = new Map(
      rivalCells.map((c) => [c, { owner: RIVAL, defense: 1 }] as const),
    );

    const result = processActivity({
      points: simpleLoop(200),
      type: 'run',
      distanceKm: 0.8,
      actorId: ME,
      ownership: map,
      streakDays: 1,
      gpEarnedToday: 0,
    });

    expect(result.claim?.counts.stolen).toBe(30);
    expect(result.claim?.stolenFrom[RIVAL]).toBe(30);
    expect(result.gp.steal).toBeGreaterThan(0);
  });

  it('bezárás nélkül nincs terület, de van alappont', () => {
    const result = processActivity({
      points: simpleLoop(200).slice(0, 40), // csak egy szakasz
      type: 'walk',
      distanceKm: 0.12,
      actorId: ME,
      ownership: new Map(),
      streakDays: 1,
      gpEarnedToday: 0,
    });
    expect(result.claim).toBeNull();
    expect(result.areaGainedM2).toBe(0);
    expect(result.gp.base).toBeCloseTo(1.2, 1);
    expect(result.gp.total).toBeGreaterThan(0);
  });
});
