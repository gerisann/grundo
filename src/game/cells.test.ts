import { describe, expect, it } from 'vitest';
import { IncrementalCellPath, traceToCellPath } from './cells';
import { buildTrace, ORIGIN, offset } from './fixtures';
import type { TracePoint } from '@/types';

const p = (eastM: number, northM: number) => offset(ORIGIN, eastM, northM);

describe('IncrementalCellPath', () => {
  it('mintánkénti bővítéssel pontosan ugyanazt a láncot adja, mint a kötegelt traceToCellPath', () => {
    const points = buildTrace([p(0, 0), p(0, 400), p(400, 400), p(400, 0), p(0, 0)], { stepM: 5 });
    const expected = traceToCellPath(points).path;

    const incremental = new IncrementalCellPath();
    let seen: TracePoint[] = [];
    let last: string[] = [];
    for (const point of points) {
      seen = [...seen, point];
      last = incremental.update(seen).path;
    }

    expect(last).toEqual(expected);
  });

  it('a köztes eredmény minden lépésben a mindaddigi pontok kötegelt eredményével egyezik', () => {
    const points = buildTrace([p(0, 0), p(300, 0), p(300, 300), p(0, 300)], { stepM: 4 });

    const incremental = new IncrementalCellPath();
    let seen: TracePoint[] = [];
    for (const point of points) {
      seen = [...seen, point];
      const batch = traceToCellPath(seen).path;
      expect(incremental.update(seen).path).toEqual(batch);
    }
  });

  it('nem újítja a láncot, ha nem érkezett új pont (a hívó ugyanazt a tömböt adja vissza)', () => {
    const points = buildTrace([p(0, 0), p(200, 0), p(200, 200)], { stepM: 5 });
    const incremental = new IncrementalCellPath();
    incremental.update(points);
    const first = incremental.update(points).path;
    const second = incremental.update(points).path;
    expect(second).toBe(first);
  });

  it('sorrenden kívüli beszúrás után teljesen újraépít, és a végeredmény helyes marad', () => {
    const points = buildTrace([p(0, 0), p(250, 0), p(250, 250), p(500, 250)], { stepM: 5 });
    const incremental = new IncrementalCellPath();

    // Az első felét folytatásként dolgozzuk fel.
    const firstHalf = points.slice(0, Math.floor(points.length / 2));
    incremental.update(firstHalf);

    // Egy korábban be nem mutatott, korai időpontú pont beszúrása —
    // az `applySample` `!appended` ágának felel meg: a régi tömb elemei
    // a beszúrási pont UTÁN eltolódnak, tehát a referenciaellenőrzésnek
    // el kell térnie.
    const inserted: TracePoint = { ...firstHalf[2]!, t: firstHalf[2]!.t - 500 };
    const withInsertion = [
      ...firstHalf.slice(0, 2),
      inserted,
      ...firstHalf.slice(2),
      ...points.slice(firstHalf.length),
    ];

    const result = incremental.update(withInsertion).path;
    const expected = traceToCellPath(withInsertion).path;
    expect(result).toEqual(expected);
  });

  it('reset() után a következő update() teljesen újraépít, nem az előző munkamenetre fűz', () => {
    const first = buildTrace([p(0, 0), p(300, 0)], { stepM: 5 });
    const second = buildTrace([p(1000, 1000), p(1000, 1300)], { stepM: 5, startAt: Date.UTC(2026, 7, 16) });

    const incremental = new IncrementalCellPath();
    incremental.update(first);
    incremental.reset();

    const result = incremental.update(second).path;
    expect(result).toEqual(traceToCellPath(second).path);
    // A két nyomvonal földrajzilag távol esik — ha a régi lánc bennragadt
    // volna, az első pontok is megjelennének az eredményben.
    expect(result).not.toEqual(expect.arrayContaining(traceToCellPath(first).path));
  });

  it('a pontatlan (nagy accuracy) minták kumulatívan számítanak a droppedPoints-ba', () => {
    const good = buildTrace([p(0, 0), p(100, 0)], { stepM: 10 });
    const noisy: TracePoint = { lat: p(200, 0).lat, lng: p(200, 0).lng, t: good.at(-1)!.t + 1000, accuracy: 999 };

    const incremental = new IncrementalCellPath();
    incremental.update(good);
    const result = incremental.update([...good, noisy]);

    expect(result.droppedPoints).toBe(1);
  });
});
