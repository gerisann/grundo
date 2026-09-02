/**
 * A KÖRÜLJÁRÁSI SZÁM NEM FÜGGHET A BEMENET SORRENDJÉTŐL.
 *
 * A `windingCounts` cellahalmazt kap, és halmaznak sorrendje elvileg nincs —
 * a JavaScript `Set`-jének viszont van beszúrási sorrendje, és a régi
 * megvalósítás minden régió értékét az ELSŐKÉNT talált cellájánál mérte.
 *
 * MÉRVE (2026-09-02): a kitöltés belső halmazának előállítási sorrendjét
 * megváltoztatva a kifelé tartó spirál magja 3× helyett 2× védelmen maradt.
 * Vagyis a felhasználó területének védettsége egy `Set` beszúrási
 * sorrendjén múlt — pontosan azon a fajta rejtett függésen, amitől a kliens
 * és a szerver eredménye szétcsúszhat, holott a modul fejléce bitre azonos
 * eredményt ígér.
 *
 * Ez a teszt ugyanazt a halmazt többféle sorrendben adja át, és azt állítja,
 * hogy a kimenet szóról szóra ugyanaz.
 */

import { describe, expect, it } from 'vitest';
import { windingCounts } from './winding';
import { traceToCellPath } from './cells';
import { detectLoopsDetailed } from './loopDetection';
import { loopCells } from './loops';
import { buildTrace, multiLap, offset, ORIGIN } from './fixtures';
import type { CellId } from '@/types';

/** Determinisztikus keverés — ugyanaz a halmaz, más beszúrási sorrend. */
function shuffled(cells: readonly CellId[], seed: number): CellId[] {
  const out = [...cells];
  let state = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function claimedOf(points: ReturnType<typeof buildTrace>): { path: CellId[]; cells: CellId[] } {
  const { path } = traceToCellPath(points);
  const cells = new Set<CellId>();
  for (const loop of detectLoopsDetailed(path).loops) {
    for (const cell of loopCells(loop)) cells.add(cell);
  }
  return { path, cells: [...cells] };
}

/** A `reinforcement.test.ts` spirálja — ott bukott meg a sorrendfüggés. */
function outwardSpiral(clockwise: boolean) {
  const squarePoint = (t: number, r: number) => {
    const a = ((t % 1) + 1) % 1;
    if (a < 0.25) return { x: -r + 8 * r * a, y: -r };
    if (a < 0.5) return { x: r, y: -r + 8 * r * (a - 0.25) };
    if (a < 0.75) return { x: r - 8 * r * (a - 0.5), y: r };
    return { x: -r, y: r - 8 * r * (a - 0.75) };
  };
  const points: { lat: number; lng: number }[] = [];
  for (let i = 0; i <= 120; i += 1) {
    const t = i / 40;
    const { x, y } = squarePoint(clockwise ? t : -t, 100 + 25 * t);
    points.push(offset(ORIGIN, x, y));
  }
  return buildTrace(points);
}

describe('windingCounts — sorrendfüggetlen', () => {
  const cases: [string, ReturnType<typeof buildTrace>][] = [
    ['kifelé tartó spirál (óramutató szerint)', outwardSpiral(true)],
    ['kifelé tartó spirál (ellenirányban)', outwardSpiral(false)],
    ['négy kör egymáson', multiLap()],
  ];

  for (const [name, points] of cases) {
    it(name, () => {
      const { path, cells } = claimedOf(points);
      expect(cells.length).toBeGreaterThan(0);

      const reference = windingCounts(path, cells);
      for (const seed of [1, 7, 4242]) {
        const other = windingCounts(path, shuffled(cells, seed));
        expect(other.size).toBe(reference.size);
        for (const [cell, turns] of reference) {
          expect(other.get(cell)).toBe(turns);
        }
      }
    });
  }
});
