/**
 * A KÉT KITÖLTÉS AZONOSSÁGA.
 *
 * A `floodFillInterior` 2026-09-02 óta a fal ÉS a befoglaló doboz arányából
 * választ a pontos (terület-arányos) és az adaptív (kerület-arányos) menet
 * között — ez adta a hosszú aktivitások mentésének gyorsulását. Az egész
 * gyorsítás azon a feltevésen áll, hogy a két út UGYANAZT a halmazt adja.
 *
 * Ez a fájl nem hiszi el, hanem ellenőrzi: minden alakzatra mindkét menetet
 * lefuttatja, és a két halmaz egyezését állítja. Ha valaha eltérnek, az nem
 * teljesítménykérdés lesz, hanem rossz terület a felhasználó térképén.
 */

import { describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import { floodFillInteriorAdaptive, floodFillInteriorExact, pruneDeadEnds } from './loops';
import { traceToCellPath } from './cells';
import { detectLoopsDetailed } from './loopDetection';
import { figureEight, multiLap, offset, ORIGIN, simpleLoop } from './fixtures';
import type { CellId } from '@/types';

function sorted(cells: Iterable<CellId>): CellId[] {
  return [...cells].sort();
}

/** A megadott sarokpontok által kijelölt téglalap kerülete cellákban. */
function rectangleWall(widthM: number, heightM: number, stepM = 8): Set<CellId> {
  const wall = new Set<CellId>();
  const add = (eastM: number, northM: number) => {
    const point = offset(ORIGIN, eastM, northM);
    wall.add(latLngToCell(point.lat, point.lng, GAMEPLAY.H3_RESOLUTION));
  };
  for (let x = 0; x <= widthM; x += stepM) {
    add(x, 0);
    add(x, heightM);
  }
  for (let y = 0; y <= heightM; y += stepM) {
    add(0, y);
    add(widthM, y);
  }
  return wall;
}

describe('floodFillInterior — a pontos és az adaptív menet ugyanazt adja', () => {
  const rectangles: [string, number, number][] = [
    ['apró négyzet (60 m)', 60, 60],
    ['kis négyzet (200 m)', 200, 200],
    ['közepes négyzet (600 m)', 600, 600],
    ['nagy négyzet (2 km)', 2000, 2000],
    ['elnyúlt téglalap (3 km × 200 m)', 3000, 200],
    ['keskeny folyosó (1 km × 40 m)', 1000, 40],
  ];

  for (const [name, width, height] of rectangles) {
    it(name, () => {
      const wall = rectangleWall(width, height);
      expect(sorted(floodFillInteriorExact(wall))).toEqual(
        sorted(floodFillInteriorAdaptive(wall)),
      );
    });
  }

  /**
   * A valódi hurokfalak nem szabályos téglalapok: zsákutcáktól megtisztított,
   * GPS-remegéssel kvantált cellaláncok. Ezeket a detektor állítja elő, tehát
   * pontosan azt az alakot kapjuk, amire a mentés is számol.
   */
  // A `selfTouch` szándékosan NEM szerepel: az az érintés-fixture, ami
  // egyetlen elfogadott hurkot sem ad — nincs mit kitölteni rajta.
  const traces = {
    'egyszerű kör': simpleLoop(),
    nyolcas: figureEight(),
    'négy kör egymáson': multiLap(),
  };

  for (const [name, points] of Object.entries(traces)) {
    it(`fixture: ${name}`, () => {
      const { path } = traceToCellPath(points);
      const loops = detectLoopsDetailed(path).loops;
      expect(loops.length).toBeGreaterThan(0);
      for (const loop of loops) {
        const wall = pruneDeadEnds(loop.wall);
        expect(sorted(floodFillInteriorExact(wall))).toEqual(
          sorted(floodFillInteriorAdaptive(wall)),
        );
      }
    });
  }

  it('üres fal mindkét úton üres', () => {
    const empty = new Set<CellId>();
    expect(floodFillInteriorExact(empty).size).toBe(0);
    expect(floodFillInteriorAdaptive(empty).size).toBe(0);
  });

  /**
   * NYITOTT fal: nincs mit bezárni, tehát mindkét menetnek üresen kell
   * visszatérnie. Ez a legkönnyebben elrontható eset — az adaptív menet
   * harmadik, visszaterjesztő lépése pontosan ezért létezik (egy szűk
   * folyosón bejutó „kívül" nem maradhat észrevétlen).
   */
  it('nyitott fal — egyik út sem talál belsőt', () => {
    const wall = rectangleWall(400, 400);
    const opened = new Set(wall);
    let removed = 0;
    for (const cell of wall) {
      opened.delete(cell);
      removed += 1;
      if (removed >= 6) break;
    }
    expect(sorted(floodFillInteriorExact(opened))).toEqual(
      sorted(floodFillInteriorAdaptive(opened)),
    );
  });
});

/**
 * A DURVA ELŐKÉSZÜLET GYORSÍTÓTÁRA (2026-09-04, GRUNDO #37).
 *
 * Az adaptív menet durva része — befoglaló polyfill, durva kitöltés, sáv,
 * sávperem — a DURVA fal tiszta függvénye, és a hurokdetektor egymást követő
 * jelöltjeinek durva fala szinte mindig azonos (mérve: 499 jelölt, 29
 * különböző durva fal). Ezért gyorsítótárazzuk.
 *
 * KÉT KONKRÉT VESZÉLYE VAN, és mindkettőt CSENDBEN rossz területként adná ki:
 *
 *  1. A halmaz BEJÁRÁSI SORRENDJE hívásonként más — ha a kulcs erre érzékeny,
 *     a gyorsítótár sosem talál (csak lassabb lesz, de az is baj);
 *  2. A visszaterjesztés (3. lépés) MUTÁLNÁ a durva kültér halmazát, és a
 *     következő, azonos durva falú jelölt kinyitott kültérrel indulna.
 *
 * ⚠️ A MÁSODIKAT EZEK A TESZTEK NEM FOGJÁK MEG, és ezt ki kell mondani: a
 * visszaterjesztés csak ritka alakzatra (öbölbe vezető szűk folyosó) fut le
 * egyáltalán, a lenti téglalapokon egyszer sem — kipróbálva, a másolat
 * elhagyásával is mind a 14 eset zöld marad. Ezért a védelem ott TÍPUSSZINTŰ:
 * a `CoarseContext.outside` `ReadonlySet`, tehát a másolat elhagyása
 * fordítási hiba (`loops.ts`). Az alábbiak a kulcsot és a megosztást őrzik.
 */
describe('az adaptív kitöltés durva gyorsítótára', () => {
  it('ugyanazt adja a fal MÁS BEJÁRÁSI SORRENDJE mellett is', () => {
    const wall = rectangleWall(600, 600);
    const first = sorted(floodFillInteriorAdaptive(wall));
    const reversed = new Set([...wall].reverse());
    expect(sorted(floodFillInteriorAdaptive(reversed))).toEqual(first);
  });

  it('azonos durva lábnyomú, eltérő finom falakra mind a pontos menetet adja', () => {
    /**
     * Azonos durva lábnyom, eltérő finom fal — pontosan az az eset, amit a
     * detektor gyárt, és amin egy megosztott (nem másolt) kültér elhasalna.
     * Mindegyikre a PONTOS menet a referencia.
     */
    const walls = [560, 570, 580, 590, 600].map((size) => rectangleWall(size, 600));

    for (const wall of walls) {
      expect(sorted(floodFillInteriorAdaptive(wall))).toEqual(sorted(floodFillInteriorExact(wall)));
    }

    // Másodszor is, immár melegen: a gyorsítótár nem változtathat az eredményen.
    for (const wall of walls) {
      expect(sorted(floodFillInteriorAdaptive(wall))).toEqual(sorted(floodFillInteriorExact(wall)));
    }
  });

  it('a nyolcas hurok mindkét lapját ugyanúgy adja vissza gyorsítótárral', () => {
    const { path } = traceToCellPath(figureEight());
    const loops = detectLoopsDetailed(path).loops;
    expect(loops.length).toBeGreaterThan(0);
    for (const loop of loops) {
      const wall = pruneDeadEnds(loop.wall);
      expect(sorted(floodFillInteriorAdaptive(wall))).toEqual(sorted(floodFillInteriorExact(wall)));
    }
  });
});
