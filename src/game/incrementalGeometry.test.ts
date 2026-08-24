import { describe, expect, it } from 'vitest';
import { buildActivityGeometry, IncrementalActivityGeometry } from './index';
import { buildTrace, ORIGIN, offset } from './fixtures';

const p = (eastM: number, northM: number) => offset(ORIGIN, eastM, northM);

describe('IncrementalActivityGeometry', () => {
  it('ugyanazt a végső hurokgeometriát adja, mint a batch feldolgozás', () => {
    const points = buildTrace([
      p(0, 0),
      p(0, 240),
      p(240, 240),
      p(240, 0),
      p(0, 0),
      p(-180, -180),
      p(180, -180),
      p(240, 240),
    ], { stepM: 5, accuracy: 1 });

    const incremental = new IncrementalActivityGeometry();
    for (let end = 2; end <= points.length; end += 7) {
      incremental.update(points.slice(0, end));
    }
    const actual = incremental.update(points);
    const expected = buildActivityGeometry(points);

    expect(actual.cellPath).toEqual(expected.cellPath);
    expect(actual.loops.map((loop) => [loop.fromIndex, loop.toIndex])).toEqual(
      expected.loops.map((loop) => [loop.fromIndex, loop.toIndex]),
    );
    expect(actual.loopDiagnostics.successful).toEqual(expected.loopDiagnostics.successful);
    expect(actual.loopDiagnostics.rejected).toEqual(expected.loopDiagnostics.rejected);
  });

  it('route reset után tisztán újraépíti az állapotot', () => {
    const first = buildTrace([p(0, 0), p(0, 220), p(220, 220), p(220, 0), p(0, 0)], { stepM: 5 });
    const second = buildTrace([p(500, 0), p(500, 220), p(720, 220), p(720, 0), p(500, 0)], { stepM: 5 });
    const incremental = new IncrementalActivityGeometry();

    incremental.update(first);
    const actual = incremental.update(second);
    const expected = buildActivityGeometry(second);

    expect(actual.cellPath).toEqual(expected.cellPath);
    expect(actual.loops.map((loop) => [loop.fromIndex, loop.toIndex])).toEqual(
      expected.loops.map((loop) => [loop.fromIndex, loop.toIndex]),
    );
  });
});
