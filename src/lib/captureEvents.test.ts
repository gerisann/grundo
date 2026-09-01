/**
 * A foglalás-események képzésének tesztjei.
 *
 * A hangsúly nem a számoláson van, hanem azon, MIKOR NEM keletkezik esemény:
 * a hamis riasztás itt hangot és konfettit jelent a semmiért.
 */

import { describe, expect, it } from 'vitest';
import { GAMEPLAY } from '@/config/gameplay';
import {
  captureKind,
  diffCaptureSnapshots,
  EMPTY_CAPTURE_SNAPSHOT,
  type CaptureCell,
  type CaptureSnapshot,
} from './captureEvents';
import type { CellId } from '@/types';

function snapshot(
  loopCount: number,
  cells: Record<string, CaptureCell>,
  totals?: { gainedCells?: number; gainedAreaM2?: number },
): CaptureSnapshot {
  const map = new Map(Object.entries(cells) as [CellId, CaptureCell][]);
  const gained =
    totals?.gainedCells ??
    [...map.values()].filter((c) => c.fate === 'free' || c.fate === 'stolen').length;
  return {
    loopCount,
    cells: map,
    gainedCells: gained,
    gainedAreaM2: totals?.gainedAreaM2 ?? gained * GAMEPLAY.CELL_AREA_M2,
  };
}

describe('diffCaptureSnapshots', () => {
  it('az első bezárás minden celláját eseménynek veszi', () => {
    const next = snapshot(1, {
      a: { fate: 'free', defense: 1 },
      b: { fate: 'free', defense: 1 },
      c: { fate: 'stolen', defense: 1 },
    });

    const event = diffCaptureSnapshots(EMPTY_CAPTURE_SNAPSHOT, next);

    expect(event).not.toBeNull();
    expect(event?.captured).toBe(2);
    expect(event?.stolen).toBe(1);
    expect(event?.gainedCells).toBe(3);
    expect(event?.gainedAreaM2).toBeCloseTo(3 * GAMEPLAY.CELL_AREA_M2, 2);
  });

  it('bezárás nélkül SOSEM keletkezik esemény, akkor sem, ha a cellák megváltoztak', () => {
    // Ez a friss `/api/tiles` válasz esete: ugyanaz a hurok, de a cella
    // sorsa „szabad"-ról „elvett"-re fordult, mert megjött a birtokviszony.
    const before = snapshot(1, { a: { fate: 'free', defense: 1 } });
    const after = snapshot(1, {
      a: { fate: 'stolen', defense: 1 },
      b: { fate: 'free', defense: 1 },
    });

    expect(diffCaptureSnapshots(before, after)).toBeNull();
  });

  it('a sors megváltozása egy MÁR ISMERT cellán nem esemény új bezárásnál sem', () => {
    const before = snapshot(1, { a: { fate: 'free', defense: 1 } });
    const after = snapshot(2, { a: { fate: 'stolen', defense: 1 } });

    // A hurokszám nőtt, de az `a` cella védelme nem, és az összesítés sem —
    // nincs mit ünnepelni, csak a birtokviszony pontosodott alatta.
    expect(diffCaptureSnapshots(before, after)).toBeNull();
  });

  it('a védelem növekedése megerősítés, és a maximumot külön jelzi', () => {
    const before = snapshot(1, {
      a: { fate: 'free', defense: 1 },
      b: { fate: 'reclaimed', defense: GAMEPLAY.MAX_DEFENSE - 1 },
    });
    const after = snapshot(
      2,
      {
        a: { fate: 'reclaimed', defense: 2 },
        b: { fate: 'reclaimed', defense: GAMEPLAY.MAX_DEFENSE },
      },
      { gainedCells: before.gainedCells, gainedAreaM2: before.gainedAreaM2 },
    );

    const event = diffCaptureSnapshots(before, after);

    expect(event?.reinforced).toBe(2);
    expect(event?.maxed).toBe(1);
    expect(event?.gainedCells).toBe(0);
    expect(event?.gainedAreaM2).toBe(0);
  });

  it('az áttörés nem számít megszerzett cellának', () => {
    const event = diffCaptureSnapshots(
      EMPTY_CAPTURE_SNAPSHOT,
      snapshot(1, { a: { fate: 'breakthrough', defense: 3 } }),
    );

    expect(event?.breakthrough).toBe(1);
    expect(event?.gainedCells).toBe(0);
    expect(event?.maxed).toBe(0);
  });

  it('a hurokszám csökkenése (geometria-újraépítés) nem esemény', () => {
    const before = snapshot(3, { a: { fate: 'free', defense: 1 } });
    const after = snapshot(2, { a: { fate: 'free', defense: 1 } });

    expect(diffCaptureSnapshots(before, after)).toBeNull();
  });

  it('tömör (nagy) huroknál az ÖSSZESÍTÉS adja a számokat, nem a cellatérkép', () => {
    // A `compactClaim` csak a finom határsávot teszi a `fates`-be, a
    // `counts`/`gainedM2` viszont a teljes belsőt — a felugró üzenetnek az
    // utóbbit kell mutatnia.
    const after = snapshot(
      1,
      { a: { fate: 'free', defense: 1 }, b: { fate: 'free', defense: 1 } },
      { gainedCells: 1_950_000, gainedAreaM2: 1_950_000 * GAMEPLAY.CELL_AREA_M2 },
    );

    const event = diffCaptureSnapshots(EMPTY_CAPTURE_SNAPSHOT, after);

    expect(event?.gainedCells).toBe(1_950_000);
    expect(event?.captured).toBe(2);
  });

  it('a csökkenő összesítés nem ad negatív területet', () => {
    const before = snapshot(1, {}, { gainedCells: 100, gainedAreaM2: 30_709 });
    const after = snapshot(2, {}, { gainedCells: 40, gainedAreaM2: 12_283 });

    expect(diffCaptureSnapshots(before, after)).toBeNull();
  });
});

describe('captureKind', () => {
  const base = {
    captured: 0,
    stolen: 0,
    reinforced: 0,
    maxed: 0,
    breakthrough: 0,
    gainedCells: 0,
    gainedAreaM2: 0,
    touchedCells: 0,
  };

  it('a lopás erősebb hír a szerzésnél', () => {
    expect(captureKind({ ...base, captured: 40, stolen: 1 })).toBe('stolen');
  });

  it('lopás nélkül a szerzés az üzenet', () => {
    expect(captureKind({ ...base, captured: 40, gainedCells: 40 })).toBe('claimed');
  });

  it('csak megerősítésnél a megerősítés', () => {
    expect(captureKind({ ...base, reinforced: 12 })).toBe('reinforced');
  });

  it('kizárólag áttörésre nincs üzenet', () => {
    expect(captureKind({ ...base, breakthrough: 5 })).toBeNull();
  });
});
