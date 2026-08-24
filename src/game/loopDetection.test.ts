import { describe, expect, it } from 'vitest';
import { gridRingUnsafe, latLngToCell } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import { traceToCellPath } from './cells';
import { buildTrace, ORIGIN, offset } from './fixtures';
import { detectLoops } from './loopDetection';

const p = (eastM: number, northM: number) => offset(ORIGIN, eastM, northM);

describe('overlap-aware loop detection', () => {
  it('a következő hurok újrahasználhatja az előző bezárás régi falát', () => {
    // 1. hurok: A-B-C-D-A
    // 2. hurok: C-D-A-E-F-C — az első hurok C-D-A falrészét újrahasználja.
    //
    // A régi lastSeenAt.clear() miatt a második C már nem találta meg a
    // korábbi C-D-A útvonalat, így csak egyetlen bezárás maradt.
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

  it('egy H3 keresztezési kapu több szomszédos cellája nem süti el többször ugyanazt a hurkot', () => {
    const center = latLngToCell(ORIGIN.lat, ORIGIN.lng, GAMEPLAY.H3_RESOLUTION);
    const ring = gridRingUnsafe(center, 4);

    // Egyszer megkerüljük a gyűrűt, bezárjuk, majd még több cellán haladunk
    // tovább UGYANAZON a korábbi falon. A régi overlap-aware detector ezeknél
    // a celláknál ugyanazt a területet újra és újra huroknak látta, ami egy
    // fizikai körből rögtön 3–5-ös defense-t csinált.
    const path = [
      ...ring,
      ring[0]!,
      ring[1]!,
      ring[2]!,
      ring[3]!,
      ring[4]!,
      ring[5]!,
    ];

    expect(detectLoops(path)).toHaveLength(1);
  });

  it('ugyanaz a geometriai kör csak egy TELJES új traversal után számít újra', () => {
    const center = latLngToCell(ORIGIN.lat, ORIGIN.lng, GAMEPLAY.H3_RESOLUTION);
    const ring = gridRingUnsafe(center, 4);

    // Első teljes kör + második teljes kör. A második kör köztes cellái nem
    // új bezárások; csak akkor jár a második hurok, amikor a teljes új lap
    // valóban visszaér a kapuhoz.
    const twice = [
      ...ring,
      ring[0]!,
      ...ring.slice(1),
      ring[0]!,
    ];

    expect(detectLoops(twice)).toHaveLength(2);
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
