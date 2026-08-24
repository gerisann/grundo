import { describe, expect, it } from 'vitest';
import { gridRingUnsafe, latLngToCell } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import { traceToCellPath } from './cells';
import { buildTrace, ORIGIN, offset } from './fixtures';
import { detectLoops } from './loopDetection';

const p = (eastM: number, northM: number) => offset(ORIGIN, eastM, northM);

describe('overlap-aware loop detection', () => {
  it('a következő hurok újrahasználhatja az előző bezárás régi falát', () => {
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

  it('a bezárás utáni kilépő cella kötelező szeparátor, nem új hurok', () => {
    // Egy normál kör bezárása után azonnal kifelé indulunk. A korábbi gate
    // logika a kontaktzóna első külső celláján már újraélesedett, és ott a
    // frissen bezárt területet még egyszer el tudta sütni.
    const points = buildTrace(
      [
        p(0, 0),
        p(0, 220),
        p(220, 220),
        p(220, 0),
        p(0, 0),
        p(-60, -50),
        p(-140, -120),
      ],
      { stepM: 6 },
    );
    const { path } = traceToCellPath(points);
    expect(detectLoops(path)).toHaveLength(1);
  });

  it('egy valódi kétlebenyes keresztező útvonal pontosan két hurkot ad', () => {
    // Két külön hurok ugyanazon középső találkozási ponttal. Az első hurok
    // kilépése nem lehet külön harmadik bezárás, a második valódi visszaérés
    // viszont igen.
    const points = buildTrace(
      [
        p(0, 0),
        p(-180, 180),
        p(180, 180),
        p(0, 0),
        p(180, -180),
        p(-180, -180),
        p(0, 0),
      ],
      { stepM: 6 },
    );
    const { path } = traceToCellPath(points);
    expect(detectLoops(path)).toHaveLength(2);
  });

  it('ugyanaz a geometriai kör csak egy TELJES új traversal után számít újra', () => {
    const center = latLngToCell(ORIGIN.lat, ORIGIN.lng, GAMEPLAY.H3_RESOLUTION);
    const ring = gridRingUnsafe(center, 4);
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
