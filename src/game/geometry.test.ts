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
import { cellsToM2, layerOf, traceToCellPath } from './cells';
import { detectLoops, floodFillInterior, loopCells, pruneDeadEnds } from './loops';
import { processActivity } from './index';
import {
  ORIGIN,
  buildTrace,
  figureEight,
  gpsGap,
  offset,
  hugeBBox,
  multiLap,
  openRoute,
  selfTouch,
  simpleLoop,
} from './fixtures';
import { gridDisk } from 'h3-js';
import type { TracePoint } from '@/types';

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

describe('layerOf', () => {
  it('a futást és sétát a foot, a bringát a bike réteghez rendeli', () => {
    expect(layerOf('run')).toBe('foot');
    expect(layerOf('walk')).toBe('foot');
    expect(layerOf('ride')).toBe('bike');
  });
});

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

describe('bezáráshoz kihagyott mező kell', () => {
  /**
   * Két nyomvonal `gapM` méterre egymástól, oda-vissza.
   *
   * Ha a két sáv szomszédos cellasorokban fut, NINCS közte kihagyott mező —
   * és akkor nem bezárás. Ez a szabály 2026-08-17-én került vissza, miután
   * kiderült, hogy nélküle egyetlen oda-vissza séta ugyanazon az utcán
   * TIZENHÁROM hurkot generál, és a folyosót azonnal 5-ös védelemre viszi.
   *
   * Az ok: ha ugyanazokon a cellákon jössz vissza, minden cella újralátogatás,
   * és mindegyik saját beágyazott hurkot szül. Egy kihagyott mező megkövetelése
   * ezt a kaszkádot tövében vágja el.
   */
  function corridor(gapM: number, lengthM = 300): TracePoint[] {
    return buildTrace(
      [
        ORIGIN,
        offset(ORIGIN, 0, lengthM),
        offset(ORIGIN, gapM, lengthM),
        offset(ORIGIN, gapM, 0),
        ORIGIN,
      ],
      { stepM: 6 },
    );
  }

  it('ugyanazon a nyomvonalon oda-vissza NEM bezárás', () => {
    const { path } = traceToCellPath(
      buildTrace([ORIGIN, offset(ORIGIN, 0, 300), ORIGIN], { stepM: 6 }),
    );
    expect(detectLoops(path)).toHaveLength(0);
  });

  it('szomszédos sávok (20 m) sem: nincs köztük kihagyott mező', () => {
    const { path } = traceToCellPath(corridor(20));
    expect(detectLoops(path)).toHaveLength(0);
  });

  it('egy kihagyott mezőnyi hézag (30 m) már bezárás', () => {
    const { path } = traceToCellPath(corridor(30));
    const loops = detectLoops(path);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.interior.size).toBeGreaterThanOrEqual(GAMEPLAY.MIN_INTERIOR_CELLS);
  });

  it('álló helyzeti remegés NEM lesz bezárás', () => {
    const jitter = buildTrace(
      [ORIGIN, offset(ORIGIN, 4, 0), offset(ORIGIN, 0, 4), ORIGIN],
      { stepM: 2 },
    );
    const { path } = traceToCellPath(jitter);
    expect(detectLoops(path)).toHaveLength(0);
  });
});

/**
 * A három eset, ahogy a szabály a rajzon néz ki.
 *
 * ✗  szomszédos sorokon oda-vissza  → nincs bezárás, semmi nem lesz a tiéd
 * ✓  egy kihagyott mezősor közte    → bezárás: a fal ÉS a belső a tiéd
 * ✓  bezárás + utána kilógó érintés → a kilógó rész NEM számít
 *
 * Ez a felhasználó saját ábrája alapján készült, és azért él tesztként, mert a
 * három eset együtt írja le a szabályt — külön-külön mindegyik félreérthető.
 */
describe('a bezárás szabálya három esetben', () => {
  const A = ORIGIN;
  const B = offset(ORIGIN, 0, 200);
  const C = offset(ORIGIN, 200, 200);
  const D = offset(ORIGIN, 200, 0);

  const claimOf = (waypoints: { lat: number; lng: number }[]) => {
    const points = buildTrace(waypoints, { stepM: 6 });
    const { path } = traceToCellPath(points);
    return {
      walked: new Set(path),
      loops: detectLoops(path),
      claimed: processActivity({
        points,
        type: 'run',
        distanceKm: 1,
        actorId: 'u1',
        ownership: new Map(),
        streakDays: 0,
        gpEarnedToday: 0,
      }).claimedCells,
    };
  };

  it('✗ szomszédos sorokon: nincs bezárás', () => {
    const { loops, claimed } = claimOf([A, B, offset(ORIGIN, 20, 200), offset(ORIGIN, 20, 0), A]);
    expect(loops).toHaveLength(0);
    expect(claimed.size).toBe(0);
  });

  it('✓ egy kihagyott mezősorral: a fal és a belső is a tiéd', () => {
    const { loops, claimed, walked } = claimOf([
      A,
      B,
      offset(ORIGIN, 40, 200),
      offset(ORIGIN, 40, 0),
      A,
    ]);
    expect(loops).toHaveLength(1);
    // Több mint amit bejártunk: a közrezárt belső is hozzájön.
    expect(claimed.size).toBeGreaterThan(walked.size);
  });

  it('✓ a bezárás UTÁNI kilógó érintés nem számít területnek', () => {
    const clean = claimOf([A, B, C, D, A]);
    const withSpur = claimOf([A, B, C, D, A, offset(ORIGIN, 240, -40), A]);

    // A kiszögellés bejárt mezőket ad, megszerzettet nem.
    expect(withSpur.walked.size).toBeGreaterThan(clean.walked.size);
    expect(withSpur.claimed.size).toBe(clean.claimed.size);
  });
});

describe('zsákutca-metszés', () => {
  const A = ORIGIN;
  const B = offset(ORIGIN, 0, 200);
  const C = offset(ORIGIN, 200, 200);
  const D = offset(ORIGIN, 200, 0);

  const claimedCount = (waypoints: { lat: number; lng: number }[]) => {
    const points = buildTrace(waypoints, { stepM: 6 });
    return processActivity({
      points,
      type: 'run',
      distanceKm: 1,
      actorId: 'u1',
      ownership: new Map(),
      streakDays: 0,
      gpEarnedToday: 0,
    }).claimedCells.size;
  };

  /**
   * A szabály: amelyik cellának csak EGY szomszédja van a falban, az nem
   * része a körnek — és mivel a hegy levágásával a mögötte lévő válik
   * zsákutcává, addig ismételjük, amíg el nem fogynak.
   *
   * Enélkül a menet közbeni kitérők beleszámítottak a területbe, mert a fal
   * a két találkozás között bejárt MINDEN cellát tartalmazta.
   */
  it('a menet közbeni kitérő nem ad területet', () => {
    const clean = claimedCount([A, B, C, D, A]);
    const withDetour = claimedCount([
      A,
      B,
      offset(ORIGIN, 100, 200),
      offset(ORIGIN, 100, 260),
      offset(ORIGIN, 100, 200),
      C,
      D,
      A,
    ]);
    expect(withDetour).toBe(clean);
  });

  it('a hosszabb kitérő sem — a metszés a hegyétől visszafelé halad', () => {
    const clean = claimedCount([A, B, C, D, A]);
    const withLongDetour = claimedCount([
      A,
      B,
      offset(ORIGIN, 100, 200),
      offset(ORIGIN, 100, 300),
      offset(ORIGIN, 100, 200),
      C,
      D,
      A,
    ]);
    expect(withLongDetour).toBe(clean);
  });

  it('a valódi kört nem érinti: ott minden cellának két szomszédja van', () => {
    const { path } = traceToCellPath(buildTrace([A, B, C, D, A], { stepM: 6 }));
    const [loop] = detectLoops(path);
    expect(pruneDeadEnds(loop!.wall).size).toBe(loop!.wall.size);
  });
});

describe('két területet összekötő folyosó', () => {
  const p = (e: number, n: number) => offset(ORIGIN, e, n);

  const claimed = (waypoints: { lat: number; lng: number }[], km: number) =>
    processActivity({
      points: buildTrace(waypoints, { stepM: 6 }),
      type: 'run',
      distanceKm: km,
      actorId: 'u1',
      ownership: new Map(),
      streakDays: 0,
      gpEarnedToday: 0,
    }).claimedCells.size;

  /**
   * Két bezárt terület, közte egy vonal, amin oda is és vissza is átmentünk.
   *
   * A folyosó celláinak KÉT szomszédjuk van, tehát a zsákutca-szabály nem
   * fogja meg őket — mégsem részei egyetlen körnek sem. A hídkeresés viszont
   * igen: a folyosó minden éle híd, mert elvágva szétesik a gráf.
   */
  it('a folyosó nem ad területet: annyi lesz, mintha külön futottuk volna', () => {
    const both = claimed(
      [
        p(0, 0), p(0, 200), p(200, 200), p(200, 0), p(0, 0),
        p(500, 0),
        p(500, 200), p(700, 200), p(700, 0), p(500, 0),
        p(0, 0),
      ],
      2.6,
    );

    const left = claimed([p(0, 0), p(0, 200), p(200, 200), p(200, 0), p(0, 0)], 0.8);
    const right = claimed([p(500, 0), p(500, 200), p(700, 200), p(700, 0), p(500, 0)], 0.8);

    // A folyosó ~16 cellája kiesik; ami marad, az a két kör. A csatlakozási
    // pontnál egyetlen cella még körön fekszik (háromszöget zár a gyűrűvel),
    // ezért engedünk pár cellányi eltérést.
    expect(both).toBeGreaterThanOrEqual(left + right);
    expect(both).toBeLessThan(left + right + 5);
  });
});
