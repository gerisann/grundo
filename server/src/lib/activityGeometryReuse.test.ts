/**
 * A TERVBEN HORDOZOTT GEOMETRIA ÚJRAHASZNÁLHATÓ — ez a retry biztonsága.
 *
 * MIÉRT KELL EZ A TESZT? Mert a gyors mentési út korábban KÉTSZER futtatta le
 * a hurokfelismerést ugyanarra a nyomvonalra: egyszer a `planActivity`-ben,
 * majd MÉG EGYSZER a `commitActivity`-ben — a Firestore-TRANZAKCIÓN BELÜL.
 * A tranzakció ütközéskor magától újrapróbál, tehát a legdrágább számítás
 * annyiszor futott le, ahányszor a commit újraindult. Mérve: 20 km-es körnél
 * a `processActivity` 337 ms-ából 289 ms (86 %) a geometria.
 *
 * A javítás abból él, hogy a geometria ÚJRAHASZNÁLHATÓ: kizárólag a
 * pontokból következik, és a feldolgozás nem módosítja. Ez a teszt pontosan
 * ezt a feltevést állítja — mert ha nem igaz, a hiba némán jelentkezne:
 * egy tranzakció-újrapróbálás után MÁS területet könyvelnénk el, mint
 * elsőre, és a felhasználó a saját körét kapná meg rosszul.
 *
 * ⚠️ Ugyanezt a mintát a DARABOLT út már ma is használja élesben
 * (`activityChunked.ts` a `plan.loops`-t tizenöt tranzakción viszi át) —
 * ez a teszt azt a meglévő, kimondatlan szerződést is rögzíti.
 */
import { describe, expect, it } from 'vitest';
import {
  buildActivityGeometry,
  processActivity,
  processActivityGeometry,
  type ProcessInput,
} from '../../../src/game';
import { figureEight, multiLap, simpleLoop } from '../../../src/game/fixtures';
import type { TracePoint } from '../../../src/types';

function inputFor(points: TracePoint[]): ProcessInput {
  return {
    points,
    type: 'run',
    distanceKm: 2,
    actorId: 'teszt-jatekos',
    ownership: new Map(),
    streakDays: 0,
    gpEarnedToday: 0,
  };
}

describe.each([
  ['egyszerű hurok', simpleLoop()],
  ['nyolcas', figureEight()],
  ['négy kör ugyanazon a pályán', multiLap()],
])('geometria újrahasználata — %s', (_name, points) => {
  it('ugyanazt az eredményt adja másodszorra is (a retry biztonsága)', () => {
    const geometry = buildActivityGeometry(points);

    const first = processActivityGeometry(inputFor(points), geometry);
    // ⚠️ SZÁNDÉKOSAN UGYANAZ AZ OBJEKTUM, nem másolat — épp azt mérjük, hogy
    // az első futás nem írta-e át.
    const second = processActivityGeometry(inputFor(points), geometry);

    expect(second.claimedCellCount).toBe(first.claimedCellCount);
    expect(second.areaGainedM2).toBe(first.areaGainedM2);
    expect(second.gp.total).toBe(first.gp.total);
    expect(second.loops.length).toBe(first.loops.length);
    expect([...second.claimedCells].sort()).toEqual([...first.claimedCells].sort());
  });

  it('ugyanazt adja, mint a régi, mindent egyben számoló út', () => {
    // Ez bizonyítja, hogy a `planActivity`/`commitActivity` átalakítása
    // VISELKEDÉST NEM VÁLTOZTAT — csak kevesebbszer számol.
    const viaPlan = processActivityGeometry(inputFor(points), buildActivityGeometry(points));
    const viaOldPath = processActivity(inputFor(points));

    expect(viaPlan.claimedCellCount).toBe(viaOldPath.claimedCellCount);
    expect(viaPlan.areaGainedM2).toBe(viaOldPath.areaGainedM2);
    expect(viaPlan.gp).toEqual(viaOldPath.gp);
    expect([...viaPlan.claimedCells].sort()).toEqual([...viaOldPath.claimedCells].sort());
  });

  it('a geometriát változatlanul hagyja', () => {
    const geometry = buildActivityGeometry(points);
    const cellPathBefore = [...geometry.cellPath];
    const loopSizesBefore = geometry.loops.map((loop) => ({
      wall: loop.wall.size,
      interior: loop.interior.size,
    }));

    processActivityGeometry(inputFor(points), geometry);

    expect(geometry.cellPath).toEqual(cellPathBefore);
    expect(geometry.loops.map((loop) => ({ wall: loop.wall.size, interior: loop.interior.size })))
      .toEqual(loopSizesBefore);
  });
});
