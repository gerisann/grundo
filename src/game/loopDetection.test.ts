import { describe, expect, it } from 'vitest';
import { traceToCellPath } from './cells';
import { buildTrace, ORIGIN, offset } from './fixtures';
import { detectLoops } from './loopDetection';

const p = (eastM: number, northM: number) => offset(ORIGIN, eastM, northM);

describe('overlap-aware loop detection', () => {
  it('a következő hurok újrahasználhatja az előző bezárás régi falát', () => {
    // 1. hurok: A-B-C-D-A
    // 2. hurok: C-D-A-E-F-C — az első hurok C-D-A falrészét újrahasználja.
    //
    // A korábbi lastSeenAt.clear() miatt a második C már nem találta meg a
    // régi C-D-A útvonalat, így csak egyetlen bezárás maradt.
    const points = buildTrace(
      [
        p(0, 0),
        p(0, 220),
        p(220, 220),
        p(220, 0),
        p(0, 0),
        p(0, -180),
        p(320, -180),
        p(220, 220),
      ],
      { stepM: 6 },
    );
    const { path } = traceToCellPath(points);
    const loops = detectLoops(path);

    expect(loops).toHaveLength(2);
    expect(loops[0]!.interior.size).toBeGreaterThan(0);
    expect(loops[1]!.interior.size).toBeGreaterThan(0);
  });

  it('a rávezető szakaszon visszamenés továbbra sem süti el újra a régi hurkot', () => {
    const points = buildTrace(
      [
        p(-200, 0),
        p(0, 0),
        p(0, 220),
        p(220, 220),
        p(220, 0),
        p(0, 0),
        p(-200, 0),
      ],
      { stepM: 6 },
    );
    const { path } = traceToCellPath(points);
    expect(detectLoops(path)).toHaveLength(1);
  });

  it('ugyanaz a teljes kör újra bejárva továbbra is új bezárás és defense-építés alapja', () => {
    const lap = [p(0, 0), p(0, 220), p(220, 220), p(220, 0), p(0, 0)];
    const points = buildTrace([...lap, ...lap.slice(1)], { stepM: 6 });
    const { path } = traceToCellPath(points);
    expect(detectLoops(path)).toHaveLength(2);
  });
});
