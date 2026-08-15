/**
 * A geometria tesztjei — a projekt legkockázatosabb kódja.
 *
 * A pontrendszer (scoring.test.ts) eddig is tesztelt volt, de a cellalánc-
 * képzés, az önmetszés-felismerés és a flood fill soha nem futott valós
 * nyomvonalon. Ezek a tesztek ezt pótolják.
 *
 * docs/03-jatekszabalyok.md → A rögzítés és a bezárás
 */

import { describe, expect, it } from 'vitest';
import { GAMEPLAY } from '@/config/gameplay';
import { cellsToM2, traceToCellPath } from './cells';
import { detectLoops, floodFillInterior, loopCells } from './loops';
import {
  figureEight,
  gpsGap,
  hugeBBox,
  multiLap,
  openRoute,
  selfTouch,
  simpleLoop,
} from './fixtures';
import { gridDisk } from 'h3-js';

/** Összefüggő-e a cellalánc? (minden szomszédos pár élszomszéd) */
function isContiguous(path: readonly string[]): boolean {
  for (let i = 1; i < path.length; i++) {
    const previous = path[i - 1]!;
    const current = path[i]!;
    if (previous === current) continue;
    if (!gridDisk(previous, 1).includes(current)) return false;
  }
  return true;
}

describe('traceToCellPath', () => {
  it('összefüggő láncot ad — nincs lyuk a falban', () => {
    const { path } = traceToCellPath(simpleLoop());
    expect(path.length).toBeGreaterThan(50);
    expect(isContiguous(path)).toBe(true);
  });

  it('GPS-kihagyást is áthidal, a lánc összefüggő marad', () => {
    const { path, largeGaps } = traceToCellPath(gpsGap());
    expect(isContiguous(path)).toBe(true);
    expect(largeGaps).toBe(0); // 60 m még a megengedett hézagon belül
  });

  it('eldobja a pontatlan pontokat', () => {
    const points = simpleLoop().map((p, i) =>
      i % 10 === 0 ? { ...p, accuracy: 99 } : p,
    );
    const { droppedPoints } = traceToCellPath(points);
    expect(droppedPoints).toBeGreaterThan(0);
  });
});

describe('1. simple-loop — alap bezárás', () => {
  it('egy hurkot ismer fel, és a terület a várt nagyságrendben van', () => {
    const { path } = traceToCellPath(simpleLoop(200));
    const loops = detectLoops(path);

    expect(loops).toHaveLength(1);

    const claimed = loopCells(loops[0]!);
    const areaM2 = cellsToM2(claimed.size);

    // 200 m oldalú négyzet = 40 000 m². A cellarács kerekítése és a fal
    // vastagsága miatt ennél némileg több; ±25 % elfogadható.
    expect(areaM2).toBeGreaterThan(40_000 * 0.75);
    expect(areaM2).toBeLessThan(40_000 * 1.35);
  });

  it('a belső cellák száma bőven a minimum fölött van', () => {
    const { path } = traceToCellPath(simpleLoop(200));
    const [loop] = detectLoops(path);
    expect(loop!.interior.size).toBeGreaterThan(GAMEPLAY.MIN_INTERIOR_CELLS);
  });
});

describe('2. figure-eight — egy aktivitás, két bezárás', () => {
  it('két külön hurkot ismer fel', () => {
    const { path } = traceToCellPath(figureEight());
    const loops = detectLoops(path);
    expect(loops).toHaveLength(2);
  });

  it('a két hurok belseje nem fed át', () => {
    const { path } = traceToCellPath(figureEight());
    const [a, b] = detectLoops(path);
    const overlap = [...a!.interior].filter((c) => b!.interior.has(c));
    expect(overlap).toHaveLength(0);
  });
});

describe('3. multi-lap — ugyanaz a kör négyszer', () => {
  it('négy bezárást ad — ez alapozza meg a védelemépítést', () => {
    const { path } = traceToCellPath(multiLap(4, 200));
    const loops = detectLoops(path);
    expect(loops).toHaveLength(4);
  });

  it('a körök nagyjából ugyanazt a területet fedik', () => {
    const { path } = traceToCellPath(multiLap(4, 200));
    const loops = detectLoops(path);
    const sizes = loops.map((l) => l.interior.size);
    const min = Math.min(...sizes);
    const max = Math.max(...sizes);
    expect(max - min).toBeLessThan(max * 0.15);
  });
});

describe('4. open-route — nincs bezárás', () => {
  it('nem ad területet', () => {
    const { path } = traceToCellPath(openRoute(1000));
    expect(detectLoops(path)).toHaveLength(0);
  });
});

describe('5. gps-gap — a hézagkitöltés zárja a falat', () => {
  it('a kör a kihagyás ellenére bezárul', () => {
    const { path } = traceToCellPath(gpsGap());
    const loops = detectLoops(path);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.interior.size).toBeGreaterThan(GAMEPLAY.MIN_INTERIOR_CELLS);
  });
});

describe('6. self-touch — GPS-remegés nem ér területet', () => {
  it('a pár méteres ál-hurok nem ad claim-et', () => {
    const { path } = traceToCellPath(selfTouch());
    const loops = detectLoops(path);
    expect(loops).toHaveLength(0);
  });
});

describe('7. huge-bbox — védőkorlát', () => {
  it('a 30 km-es hurkot elutasítja, és nem fut ki a memóriából', () => {
    const { path } = traceToCellPath(hugeBBox());
    const started = Date.now();
    const loops = detectLoops(path);
    expect(loops).toHaveLength(0);
    // Ha a védőkorlát a polyfill UTÁN futna, ez percekig tartana.
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('floodFillInterior', () => {
  it('üres falra üres belsőt ad', () => {
    expect(floodFillInterior(new Set()).size).toBe(0);
  });

  it('a belső cellák egyike sem esik a falra', () => {
    const { path } = traceToCellPath(simpleLoop(200));
    const [loop] = detectLoops(path);
    const shared = [...loop!.interior].filter((c) => loop!.wall.has(c));
    expect(shared).toHaveLength(0);
  });
});
