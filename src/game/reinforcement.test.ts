/**
 * A védelemépítés regressziós készlete — VALÓDI geometriával.
 *
 * A korábbi két tesztfájl kézzel gyártott `DetectedLoop` objektumokkal dolgozott
 * (`wall-small-0`, `blue-existing`), és emiatt olyan index-heurisztikákat
 * rögzített, amiknek a valódi H3-geometriához semmi közük nem volt. Az irányfüggő
 * hibát épp ezért egyik sem fogta meg. Itt minden eset nyomvonalból indul.
 */

import { describe, expect, it } from 'vitest';
import { buildTrace, offset, ORIGIN, squareWaypoints } from './fixtures';
import { processActivity, IncrementalActivityGeometry, processActivityGeometry } from './index';
import type { CellId, OwnershipMap, TracePoint } from '@/types';

const ME = 'me';

function run(points: readonly TracePoint[], ownership: OwnershipMap = new Map()) {
  return processActivity({
    points, type: 'run', distanceKm: 3, actorId: ME,
    ownership, streakDays: 0, gpEarnedToday: 0,
  });
}

/** Az aktivitás utáni teljes birtokállapot. */
function after(result: ReturnType<typeof run>, before: OwnershipMap = new Map()): OwnershipMap {
  const state: OwnershipMap = new Map(before);
  for (const [cell, ownership] of result.claim?.updates ?? []) state.set(cell, ownership);
  return state;
}

function defenceHistogram(state: OwnershipMap): Map<number, number> {
  const hist = new Map<number, number>();
  for (const [, ownership] of state) {
    if (ownership.owner !== ME) continue;
    hist.set(ownership.defense, (hist.get(ownership.defense) ?? 0) + 1);
  }
  return hist;
}

function defenceOf(state: OwnershipMap, cells: Iterable<CellId>): Set<number> {
  const levels = new Set<number>();
  for (const cell of cells) {
    const held = state.get(cell);
    if (held?.owner === ME) levels.add(held.defense);
  }
  return levels;
}

/** Négyzetes kerületi pont `t ∈ [0,1)` paraméterrel. */
function squarePoint(t: number, r: number): { x: number; y: number } {
  const u = ((t % 1) + 1) % 1;
  const s = u * 4;
  if (s < 1) return { x: -r + 2 * r * s, y: -r };
  if (s < 2) return { x: r, y: -r + 2 * r * (s - 1) };
  if (s < 3) return { x: r - 2 * r * (s - 2), y: r };
  return { x: -r, y: r - 2 * r * (s - 3) };
}

/** `laps` teljes kör, körönként `growth` méterrel kijjebb. `cw` = forgásirány. */
function laps(r0: number, growth: number, count: number, cw = true) {
  const corners: [number, number][] = cw
    ? [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]
    : [[-1, -1], [-1, 1], [1, 1], [1, -1], [-1, -1]];
  const points: { lat: number; lng: number }[] = [];
  for (let lap = 0; lap < count; lap += 1) {
    const r = r0 + growth * lap;
    for (const [sx, sy] of corners) points.push(offset(ORIGIN, sx * r, sy * r));
  }
  return points;
}

/** Determinisztikus ál-GPS-zaj: nem `Math.random`, hogy a teszt reprodukálható legyen. */
function jitter(points: readonly TracePoint[], seed: number, metres = 4): TracePoint[] {
  let state = seed * 2654435761 % 2147483647;
  const next = () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647 - 0.5;
  };
  return points.map((p) => ({
    ...p,
    lat: p.lat + (next() * metres * 2) / 111_320,
    lng: p.lng + (next() * metres * 2) / (111_320 * Math.cos((p.lat * Math.PI) / 180)),
  }));
}

describe('7.1 ugyanaz a kör N-szer', () => {
  for (const count of [1, 2, 3, 5]) {
    it(`${count} kör után a védelem ${count}×`, () => {
      const state = after(run(buildTrace(laps(100, 0, count))));
      expect([...defenceHistogram(state).keys()]).toEqual([count]);
    });
  }

  it('GPS-zajjal is ugyanoda jut ki, több maggal', () => {
    for (const seed of [1, 7, 42]) {
      const state = after(run(jitter(buildTrace(laps(100, 0, 3)), seed)));
      const levels = [...defenceHistogram(state).keys()].sort((a, b) => b - a);
      // A zaj a szélén hozhat 1-2× cellát, de a magnak el kell érnie a 3×-t.
      expect(levels[0]).toBe(3);
    }
  });
});

describe('7.2 egyre nagyobb teljes lapok', () => {
  it('a közös belső magot minden lap eggyel erősíti, az új gyűrű 1×', () => {
    const state = after(run(buildTrace(laps(100, 25, 4))));
    const hist = defenceHistogram(state);
    // Négy egymásba ágyazott szint: a mag 4×, kifelé 3×, 2×, 1×.
    expect([...hist.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(hist.get(4)).toBeGreaterThan(100);
  });
});

describe('7.3 egy cellával nagyobb második lap', () => {
  it('valódi megerősítés, nem sliver és nem duplikátum', () => {
    // 12 m ≈ egy res12 cellányi eltolás.
    const state = after(run(buildTrace(laps(100, 12, 2))));
    const hist = defenceHistogram(state);
    expect(hist.get(2)).toBeGreaterThan(100);
  });
});

describe('7.4 köztes lebeny + záró nagy hurok', () => {
  /**
   * Első aktivitás: 200 m-es négyzet → ez a KÉK terület, 1×.
   * Második aktivitás: nagyobb kör a kék körül, közben egy önmetsző kitérővel,
   * ami menet közben egy külön kis lebenyt (SÁRGA) is bezár.
   */
  function blueThenOuter() {
    const blue = run(buildTrace(squareWaypoints(ORIGIN, 200)));
    const owned = after(blue);

    const outer = buildTrace([
      offset(ORIGIN, -150, -150),
      offset(ORIGIN, 150, -150),
      offset(ORIGIN, 150, 60),
      offset(ORIGIN, 240, 60),
      offset(ORIGIN, 240, -30),
      offset(ORIGIN, 130, -30),
      offset(ORIGIN, 150, 150),
      offset(ORIGIN, -150, 150),
      offset(ORIGIN, -150, -150),
    ]);
    return { owned, result: run(outer, owned) };
  }

  it('a kék terület pontosan 2× lesz, a menet közben szerzett sárga marad 1×', () => {
    const { owned, result } = blueThenOuter();
    const state = after(result, owned);

    // Minden, ami az aktivitás ELŐTT a miénk volt, pontosan egy megerősítést kap.
    expect(defenceOf(state, owned.keys())).toEqual(new Set([2]));

    // Amit az aktivitás közben szereztünk, az 1× marad: a záró nagy hurok nem
    // adhat rá azonnal még egy védelmet.
    const acquired = [...state.keys()].filter((cell) => !owned.has(cell));
    expect(acquired.length).toBeGreaterThan(0);
    expect(defenceOf(state, acquired)).toEqual(new Set([1]));
  });
});

describe('7.5 ugyanazon fizikai bejárás átfedő bezárásai', () => {
  it('a már saját cella egyszer erősödik, és nem előbb, mint a záró bezárás', () => {
    const blue = run(buildTrace(squareWaypoints(ORIGIN, 200)));
    const owned = after(blue);

    const points = buildTrace([
      offset(ORIGIN, -150, -150),
      offset(ORIGIN, 150, -150),
      offset(ORIGIN, 150, 60),
      offset(ORIGIN, 240, 60),
      offset(ORIGIN, 240, -30),
      offset(ORIGIN, 130, -30),
      offset(ORIGIN, 150, 150),
      offset(ORIGIN, -150, 150),
      offset(ORIGIN, -150, -150),
    ]);

    // Élő előnézet: prefixenként újraszámolva a kék védelme SOHA nem lépheti
    // túl a végállapotot, és csak a záró bezárásnál éri el azt.
    const geometry = new IncrementalActivityGeometry();
    const sample = [...owned.keys()][0]!;
    const timeline: { at: number; defense: number; closures: number }[] = [];

    for (let cut = 20; cut <= points.length; cut += 20) {
      const preview = processActivityGeometry(
        {
          points: points.slice(0, cut), type: 'run', distanceKm: 3, actorId: ME,
          ownership: owned, streakDays: 0, gpEarnedToday: 0,
        },
        geometry.update(points.slice(0, cut)),
      );
      const state = after(preview, owned);
      timeline.push({
        at: cut,
        defense: state.get(sample)?.defense ?? 0,
        closures: preview.loops.length,
      });
    }

    const final = timeline[timeline.length - 1]!;
    expect(final.defense).toBe(2);
    // Sehol nem ugorhat 2 fölé, és nem eshet vissza.
    for (const step of timeline) expect(step.defense).toBeLessThanOrEqual(2);
    for (let i = 1; i < timeline.length; i += 1) {
      expect(timeline[i]!.defense).toBeGreaterThanOrEqual(timeline[i - 1]!.defense);
    }
    // A megerősítés csak akkor jelenhet meg, amikor a nagy kör már bezárult.
    const raised = timeline.find((step) => step.defense === 2);
    expect(raised).toBeDefined();
    expect(raised!.closures).toBeGreaterThan(0);
  });
});

describe('7.6 irányfüggetlenség', () => {
  it('azonos lapsorrend ellenkező forgásiránnyal ugyanazt a védelmi képet adja', () => {
    for (const growth of [0, 12, 25]) {
      const cw = defenceHistogram(after(run(buildTrace(laps(100, growth, 4, true)))));
      const ccw = defenceHistogram(after(run(buildTrace(laps(100, growth, 4, false)))));

      expect([...ccw.keys()].sort()).toEqual([...cw.keys()].sort());
      for (const [level, count] of cw) {
        const other = ccw.get(level) ?? 0;
        // A megfordított nyom H3-kvantálása pár cellával eltérhet; a védelmi
        // szintek eloszlásának ettől függetlenül egyeznie kell.
        expect(Math.abs(other - count)).toBeLessThanOrEqual(Math.ceil(count * 0.1) + 2);
      }
    }
  });
});

describe('7.8 nyolcas', () => {
  it('két külön fizikai hurok, mindkettő 1×', () => {
    const h = 80;
    const north = offset(ORIGIN, 0, 160);
    const south = offset(ORIGIN, 0, -160);
    const state = after(run(buildTrace([
      ORIGIN,
      offset(north, -h, -h), offset(north, -h, h), offset(north, h, h), offset(north, h, -h),
      ORIGIN,
      offset(south, h, h), offset(south, h, -h), offset(south, -h, -h), offset(south, -h, h),
      ORIGIN,
    ])));
    expect([...defenceHistogram(state).keys()]).toEqual([1]);
  });
});

describe('7.9 sliver és korridor — nincs védelemfarm', () => {
  it('oda-vissza ugyanazon az úton nem ad területet', () => {
    const result = run(buildTrace([
      ORIGIN, offset(ORIGIN, 400, 0), offset(ORIGIN, 400, 12), ORIGIN,
    ]));
    expect(result.loops).toHaveLength(0);
    expect(result.claim).toBeNull();
  });

  it('a bezárás utáni fal menti csíkozás nem növeli a védelmet', () => {
    const points = [...squareWaypoints(ORIGIN, 200)];
    for (let k = 0; k < 8; k += 1) {
      points.push(offset(ORIGIN, -100 + k * 25, -112));
      points.push(offset(ORIGIN, -100 + k * 25, -100));
    }
    const state = after(run(buildTrace(points)));
    expect([...defenceHistogram(state).keys()]).toEqual([1]);
  });
});

describe('a nyomvonal vége nem hoz be hamis körüljárást', () => {
  it('egy kör után 1,7 km elsétálás nem változtat a védelmen', () => {
    const state = after(run(buildTrace([
      ...squareWaypoints(ORIGIN, 200),
      offset(ORIGIN, 1500, 900),
    ])));
    expect([...defenceHistogram(state).keys()]).toEqual([1]);
  });

  it('két kör után 1,7 km elsétálás után is 2× marad', () => {
    const state = after(run(buildTrace([
      ...laps(100, 0, 2),
      offset(ORIGIN, 1500, 900),
    ])));
    expect([...defenceHistogram(state).keys()]).toEqual([2]);
  });
});

describe('rivális terület', () => {
  it('ötször megkerülve az 5-ös védelmű rivális mező átkerül és épülni kezd', () => {
    const rival = run(buildTrace(laps(100, 0, 5)), new Map());
    const rivalState: OwnershipMap = new Map();
    for (const [cell, ownership] of rival.claim?.updates ?? []) {
      rivalState.set(cell, { owner: 'rival', defense: ownership.defense });
    }
    expect(new Set([...rivalState.values()].map((o) => o.defense))).toEqual(new Set([5]));

    // Hat körüljárás: öt áttörés/elvétel, majd egy megerősítés.
    const state = after(run(buildTrace(laps(100, 0, 6)), rivalState), rivalState);
    const mine = [...state].filter(([, o]) => o.owner === ME);
    expect(mine.length).toBeGreaterThan(100);
  });
});

/** A `squarePoint` a kifelé tartó spirál fixture-jéhez kell. */
describe('kifelé tartó spirál', () => {
  it('a spirál magja három kör után 3× lesz, mindkét forgásiránnyal', () => {
    const build = (cw: boolean) => {
      const points: { lat: number; lng: number }[] = [];
      for (let i = 0; i <= 120; i += 1) {
        const t = i / 40;
        const { x, y } = squarePoint(cw ? t : -t, 100 + 25 * t);
        points.push(offset(ORIGIN, x, y));
      }
      return buildTrace(points);
    };
    for (const cw of [true, false]) {
      const hist = defenceHistogram(after(run(build(cw))));
      expect(hist.get(3)).toBeGreaterThan(100);
    }
  });
});
