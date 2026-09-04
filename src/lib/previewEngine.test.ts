import { describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { EMPTY_DISPATCH_STATE, planDispatch, PreviewSession } from './previewEngine';
import type { OwnershipMap, TracePoint } from '@/types';

const START = { lat: 47.4979, lng: 19.0402 };

/**
 * Négyzet alakú kör, amiből a motor hurkot ismer fel. A lépésköz akkora, hogy
 * res12 cellánként legalább egy pont essen — különben nincs összefüggő
 * cellalánc, és nincs mit mérni.
 */
function squareLoop(sideMeters: number, step: number): TracePoint[] {
  const metersPerLat = 111_320;
  const metersPerLng = 111_320 * Math.cos((START.lat * Math.PI) / 180);
  const points: TracePoint[] = [];
  let t = 1_700_000_000_000;
  const push = (dx: number, dy: number) => {
    points.push({ lat: START.lat + dy / metersPerLat, lng: START.lng + dx / metersPerLng, t });
    t += 1000;
  };
  for (let d = 0; d <= sideMeters; d += step) push(d, 0);
  for (let d = 0; d <= sideMeters; d += step) push(sideMeters, d);
  for (let d = sideMeters; d >= 0; d -= step) push(d, sideMeters);
  for (let d = sideMeters; d >= 0; d -= step) push(0, d);
  return points;
}

const REQUEST = { type: 'run' as const, distanceM: 800, actorId: 'u1' };

describe('PreviewSession', () => {
  it('a nyom folytatásakor NEM épül újra a gyorsítótár', () => {
    const session = new PreviewSession();
    const points = squareLoop(200, 8);

    // Első köteg: ez a szükségszerű „újraépítés", innentől már csak folytatás.
    session.appendPoints(points.slice(0, 2));
    session.run(REQUEST);
    for (let i = 2; i < points.length; i += 1) {
      session.appendPoints([points[i]!]);
      session.run(REQUEST);
    }

    /**
     * ⚠️ EZ AZ EGÉSZ WORKER LÉTJOGOSULTSÁGA. Ha a `PreviewSession` bárhol
     * MÁSOLNÁ a pontokat (a worker `structuredClone`-ja pontosan ezt tenné a
     * teljes lista átküldésekor), az objektum-azonosság elveszne, minden
     * hívás a nulláról építene, és a mérve 2,6 ms-os folytatásból 1 248 ms
     * lenne. A `rebuilds` ezért CSAK az első hívás lehet.
     */
    expect(session.stats.rebuilds).toBe(1);
    expect(session.stats.appends).toBe(points.length - 2);
  });

  it('a teljes lista cseréje viszont újraépít', () => {
    const session = new PreviewSession();
    const points = squareLoop(200, 8);

    session.appendPoints(points);
    session.run(REQUEST);
    // Ugyanaz az adat, de MÁS objektumok — pont amit a klónozás okozna.
    session.replacePoints(points.map((point) => ({ ...point })));
    session.run(REQUEST);

    expect(session.stats.rebuilds).toBe(2);
  });

  it('bezárt hurokra ad foglalható mezőket, GP-t és pillanatképet', () => {
    const session = new PreviewSession();
    session.appendPoints(squareLoop(200, 8));
    const output = session.run(REQUEST);

    expect(output.counts.loops).toBeGreaterThan(0);
    expect(output.claimable.length).toBeGreaterThan(0);
    expect(output.gp).toBeGreaterThan(0);
    expect(output.snapshot.loopCount).toBe(output.counts.loops);
    expect(output.snapshot.cells.size).toBe(output.counts.fates);
    // Minden előnézeti mező a saját színnel rajzolódik — lásd `PreviewCell`.
    for (const cell of output.own) expect(cell.owner).toBe('u1');
  });

  it('rivális birtokában lévő mezőt elrablottnak mutat', () => {
    const points = squareLoop(200, 8);

    const free = new PreviewSession();
    free.appendPoints(points);
    const baseline = free.run(REQUEST);
    expect(baseline.stolen).toHaveLength(0);

    const ownership: OwnershipMap = new Map();
    for (const cell of baseline.claimable) ownership.set(cell, { owner: 'rival', defense: 1 });

    const contested = new PreviewSession();
    contested.setOwnership(ownership);
    contested.appendPoints(points);
    const output = contested.run(REQUEST);

    expect(output.stolen.length).toBeGreaterThan(0);
    for (const cell of output.stolen) expect(cell.owner).toBe('u1');
  });

  it('két pont alatt üres eredményt ad, nem hibát', () => {
    const session = new PreviewSession();
    session.appendPoints([{ lat: START.lat, lng: START.lng, t: 1 }]);
    const output = session.run(REQUEST);

    expect(output.claimable).toEqual([]);
    expect(output.gp).toBe(0);
    expect(output.counts.points).toBe(1);
  });

  it('a `reset` után a régi futás hurkai nem lógnak át', () => {
    const session = new PreviewSession();
    session.appendPoints(squareLoop(200, 8));
    expect(session.run(REQUEST).counts.loops).toBeGreaterThan(0);

    session.reset();
    session.appendPoints(squareLoop(200, 8).slice(0, 4));
    const output = session.run(REQUEST);

    expect(output.counts.loops).toBe(0);
    expect(output.claimable).toEqual([]);
  });

  it('a birtokviszony cseréje új elszámolást ad ugyanarra a nyomra', () => {
    const points = squareLoop(200, 8);
    const session = new PreviewSession();
    session.appendPoints(points);
    const before = session.run(REQUEST);

    const ownership: OwnershipMap = new Map();
    ownership.set(latLngToCell(START.lat, START.lng, 12), { owner: 'rival', defense: 3 });
    session.setOwnership(ownership);
    const after = session.run(REQUEST);

    // A nyom nem változott, tehát a folytatás-számláló sem ugorhat.
    expect(session.stats.rebuilds).toBe(1);
    expect(after.counts.cells).toBe(before.counts.cells);
  });
});

describe('planDispatch', () => {
  const ownership: OwnershipMap = new Map();
  const points = squareLoop(60, 10);
  const plan = (state = EMPTY_DISPATCH_STATE, override: Partial<{
    sessionKey: string;
    points: readonly TracePoint[];
    ownership: OwnershipMap;
  }> = {}) => planDispatch(state, {
    sessionKey: 'a:1',
    points,
    ownership,
    ...override,
  });

  it('az első körben resetel, a birtokviszonyt küldi, és a teljes nyomot adja', () => {
    const result = plan();

    expect(result.reset).toBe(true);
    expect(result.sendOwnership).toBe(true);
    expect(result.replace).toBe(false);
    expect(result.delta).toHaveLength(points.length);
  });

  it('folytatáskor CSAK az új pontokat küldi, és ugyanazokat az objektumokat', () => {
    const first = plan(EMPTY_DISPATCH_STATE, { points: points.slice(0, 5) });
    const grown = [...points.slice(0, 5), ...points.slice(5, 8)];
    const second = plan(first.next, { points: grown });

    expect(second.reset).toBe(false);
    expect(second.sendOwnership).toBe(false);
    expect(second.replace).toBe(false);
    expect(second.delta).toHaveLength(3);
    /**
     * ⚠️ AZONOS OBJEKTUMOK, nem másolatok. Egy `map(p => ({...p}))` itt
     * észrevétlenül átmenne minden más ellenőrzésen, a worker gyorsítótára
     * viszont minden hívásnál a nulláról épülne (mérve: 2,6 ms → 1 248 ms).
     */
    expect(second.delta[0]).toBe(points[5]);
    expect(second.delta[2]).toBe(points[7]);
  });

  it('visszamenőleg átírt nyomnál teljes cserét kér', () => {
    const first = plan(EMPTY_DISPATCH_STATE, { points: points.slice(0, 5) });
    // Ugyanolyan hosszú, de MÁS objektumok — a hossz önmagában nem árulná el.
    const rewritten = points.slice(0, 5).map((point) => ({ ...point }));
    const second = plan(first.next, { points: [...rewritten, points[5]!] });

    expect(second.replace).toBe(true);
    expect(second.delta).toHaveLength(6);
  });

  it('rövidebb nyomnál is teljes cserét kér', () => {
    const first = plan(EMPTY_DISPATCH_STATE, { points: points.slice(0, 10) });
    const second = plan(first.next, { points: points.slice(0, 4) });

    expect(second.replace).toBe(true);
    expect(second.delta).toHaveLength(4);
  });

  it('új rögzítésnél resetel, és a birtokviszonyt is újraküldi', () => {
    const first = plan();
    const second = plan(first.next, { sessionKey: 'b:2' });

    expect(second.reset).toBe(true);
    // A worker mindent elfelejtett, tehát a változatlan Map-et is újra kell adni.
    expect(second.sendOwnership).toBe(true);
    expect(second.replace).toBe(false);
    expect(second.delta).toHaveLength(points.length);
  });

  it('a birtokviszonyt csak AZONOSSÁG-változáskor küldi újra', () => {
    const first = plan();
    const unchanged = plan(first.next);
    expect(unchanged.sendOwnership).toBe(false);

    // Tartalmilag ugyanaz, de más Map — a gyorsítótár kulcsa az azonosság.
    const rebuilt = plan(first.next, { ownership: new Map(ownership) });
    expect(rebuilt.sendOwnership).toBe(true);
  });
});
