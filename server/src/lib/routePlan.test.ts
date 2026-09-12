import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LatLng } from '../../../src/game/geo';
import { encodePolyline } from '../../../src/game/polyline';
import { distanceM } from '../../../src/game/geo';
import { signedSideOffsetM } from '../../../src/game/routeCorridor';
import { measureLoopQuality, planDirectRoute, planTwoSidedLoop } from './routePlan';

const FROM: LatLng = { lat: 47.4979, lng: 19.0544 };
const TO: LatLng = { lat: 47.5148, lng: 19.0777 };

/** Egyenes vonal két pont között — a mock ezt adja vissza útvonalként. */
function line(from: LatLng, to: LatLng, count = 12): LatLng[] {
  return Array.from({ length: count }, (_unused, index) => ({
    lat: from.lat + ((to.lat - from.lat) * index) / (count - 1),
    lng: from.lng + ((to.lng - from.lng) * index) / (count - 1),
  }));
}

interface CapturedRequest {
  points: [number, number][];
  customModel: Record<string, unknown>;
}

/**
 * GraphHopper-mock: minden kérésre az ÁTADOTT pontokon átmenő törtvonalat
 * adja vissza, és rögzíti a kérést. Így a teszt azt nézi, amit a tervező
 * KÜLD — a valódi útvonalválasztást a mérés ellenőrzi, nem a teszt.
 */
function stubGraphHopper(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      points: [number, number][];
      custom_model?: Record<string, unknown>;
    };
    captured.push({ points: body.points, customModel: body.custom_model ?? {} });

    const waypoints = body.points.map(([lng, lat]) => ({ lat, lng }));
    const path: LatLng[] = [];
    for (let index = 1; index < waypoints.length; index += 1) {
      path.push(...line(waypoints[index - 1]!, waypoints[index]!));
    }
    return {
      ok: true,
      json: async () => ({
        paths: [{ distance: 1_000 * waypoints.length, time: 600_000, points: encodePolyline(path) }],
      }),
    } as Response;
  });
  return captured;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GRAPHHOPPER_URL;
  delete process.env.MAPBOX_TOKEN;
});

describe('planDirectRoute', () => {
  it('GraphHopperrel egyetlen A→B útvonalat kér, köztes pont nélkül', async () => {
    process.env.GRAPHHOPPER_URL = 'http://localhost:8989';
    const captured = stubGraphHopper();

    const routes = await planDirectRoute(FROM, TO, 'walking');

    expect(routes).toHaveLength(1);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.points).toHaveLength(2);
    expect(captured[0]!.customModel.areas).toBeUndefined();
  });

  it('a preferencia külön súlyokat tesz a kérésbe', async () => {
    process.env.GRAPHHOPPER_URL = 'http://localhost:8989';
    const captured = stubGraphHopper();

    await planDirectRoute(FROM, TO, 'cycling', 'quiet');

    const priority = JSON.stringify(captured[0]!.customModel.priority);
    expect(priority).toContain('TERTIARY');
  });
});

describe('planTwoSidedLoop', () => {
  it('GraphHopper nélkül őszinte nemleges választ ad, nem rossz útvonalat', async () => {
    process.env.MAPBOX_TOKEN = 'nem-elég-a-kétoldali-körhöz';
    const result = await planTwoSidedLoop(FROM, TO, 'walking', { detour: 'medium' });
    expect(result).toEqual({ ok: false, reason: 'engine_unavailable' });
  });

  it('mindkét leg köztes ponton megy át, és a két leg ellentétes oldalra tér ki', async () => {
    process.env.GRAPHHOPPER_URL = 'http://localhost:8989';
    const captured = stubGraphHopper();

    const result = await planTwoSidedLoop(FROM, TO, 'walking', { detour: 'medium' });
    expect(result.ok).toBe(true);

    // Az első kérés az alapvonal (2 pont). A leg-jelöltek egy vagy két köztes
    // ponton mennek át — mindkét alakzat kimegy, a legkevésbé hibás nyer —,
    // és van közöttük egy köztes pont NÉLKÜLI tartalék is (2 pont).
    expect(captured[0]!.points).toHaveLength(2);
    const legRequests = captured.slice(1);
    expect(legRequests.length).toBeGreaterThan(1);
    for (const request of legRequests) {
      expect(request.points.length).toBeGreaterThanOrEqual(2);
      expect(request.points.length).toBeLessThanOrEqual(4);
    }
    expect(legRequests.some((request) => request.points.length === 4)).toBe(true);
    // ⚠️ A tartalék jelölt nélkül a tervező nem tudná elengedni a rossz helyre
    // eső köztes pontot (Duna, zárt terület) — lásd `OFFSET_SHORTFALL_WEIGHT`.
    expect(legRequests.some((request) => request.points.length === 2)).toBe(true);

    // A köztes pontok előjele oldalanként ellentétes.
    const sides = legRequests
      .filter((request) => request.points.length > 2)
      .map((request) => {
        const [lng, lat] = request.points[1]!;
        return signedSideOffsetM(FROM, TO, { lat, lng });
      });
    expect(sides.some((side) => side > 0)).toBe(true);
    expect(sides.some((side) => side < 0)).toBe(true);
  });

  it('⚠️ a zóna if/else_if/else lánca a prioritáslista VÉGÉN áll', async () => {
    process.env.GRAPHHOPPER_URL = 'http://localhost:8989';
    const captured = stubGraphHopper();

    await planTwoSidedLoop(FROM, TO, 'walking', { detour: 'small' });

    // A GraphHopperben az `else` a közvetlenül előtte álló `if`-hez tartozik:
    // ha a sorrend elcsúszik, a súlyozás csendben mást jelent.
    const priority = captured[1]!.customModel.priority as Record<string, unknown>[];
    expect(priority.at(-3)).toMatchObject({ if: 'in_reached' });
    expect(priority.at(-2)).toMatchObject({ else_if: 'in_approach' });
    expect(priority.at(-1)).toMatchObject({ else: '' });
  });

  it('⚠️ MINDKÉT leg kerüli a leggyorsabb útvonalat', async () => {
    process.env.GRAPHHOPPER_URL = 'http://localhost:8989';
    const captured = stubGraphHopper();

    await planTwoSidedLoop(FROM, TO, 'walking', { detour: 'medium' });

    // Enélkül az odaútnak nincs mit kerülnie, és a köztes pontig a közvetlen
    // úton megy — a visszaút pedig látványosan máshol fut.
    for (const request of captured.slice(1)) {
      expect(JSON.stringify(request.customModel.areas)).toContain('"fast0"');
    }
  });

  it('a visszaút az odaút foltjait is megkapja, az odaút még nem', async () => {
    process.env.GRAPHHOPPER_URL = 'http://localhost:8989';
    const captured = stubGraphHopper();

    await planTwoSidedLoop(FROM, TO, 'walking', { detour: 'medium' });

    const withOutboundAvoid = captured.filter((request) =>
      JSON.stringify(request.customModel.areas ?? {}).includes('"used0"'),
    );
    expect(withOutboundAvoid.length).toBeGreaterThan(0);
    // Az odaút tervezésekor az odaút még nem létezik.
    expect(JSON.stringify(captured[1]!.customModel.areas)).not.toContain('used0');
  });

  it('⚠️ a kerülőt a közvetlen táv arányában vágja — rövid úton nincs nagy kitérő', async () => {
    process.env.GRAPHHOPPER_URL = 'http://localhost:8989';
    const captured = stubGraphHopper();

    // A FROM–TO légvonal ~2,6 km; a 2000 m-es kérés a 45%-os plafonra vágódik.
    await planTwoSidedLoop(FROM, TO, 'walking', { detour: 'large' });
    const offsets = captured.slice(1).map((request) =>
      Math.abs(
        signedSideOffsetM(FROM, TO, {
          lat: request.points[1]![1],
          lng: request.points[1]![0],
        }),
      ),
    );
    expect(Math.max(...offsets)).toBeLessThan(2_000);
  });

  it('a nagyobb kerülő távolabbi köztes pontot kér', async () => {
    process.env.GRAPHHOPPER_URL = 'http://localhost:8989';

    const capturedSmall = stubGraphHopper();
    await planTwoSidedLoop(FROM, TO, 'walking', { detour: 'small' });
    const small = Math.abs(
      signedSideOffsetM(FROM, TO, {
        lat: capturedSmall[1]!.points[1]![1],
        lng: capturedSmall[1]!.points[1]![0],
      }),
    );

    vi.unstubAllGlobals();
    const capturedLarge = stubGraphHopper();
    await planTwoSidedLoop(FROM, TO, 'walking', { detour: 'large' });
    const large = Math.abs(
      signedSideOffsetM(FROM, TO, {
        lat: capturedLarge[1]!.points[1]![1],
        lng: capturedLarge[1]!.points[1]![0],
      }),
    );

    expect(large).toBeGreaterThan(small);
  });
});

describe('felhasználói megállók', () => {
  it('⚠️ a megállók CSAK az odaútra kerülnek — a visszaút egyben megy', async () => {
    process.env.GRAPHHOPPER_URL = 'http://localhost:8989';
    const captured = stubGraphHopper();

    const stop: LatLng = { lat: 47.508, lng: 19.075 };
    await planTwoSidedLoop(FROM, TO, 'walking', { detour: 'medium', stops: [stop] });

    const withStop = captured.filter((request) =>
      request.points.some(
        ([lng, lat]) => Math.abs(lat - stop.lat) < 1e-6 && Math.abs(lng - stop.lng) < 1e-6,
      ),
    );
    // Pontosan egy kérés megy át a megállón: az odaút. A visszaútnak több
    // jelöltje van, egyik sem érintheti.
    expect(withStop).toHaveLength(1);
    expect(captured.length).toBeGreaterThan(2);
  });

  it('a megállók oldala dönti el, merre megy az odaút', async () => {
    process.env.GRAPHHOPPER_URL = 'http://localhost:8989';
    const captured = stubGraphHopper();

    // A tengelytől JOBBRA eső megálló.
    const right = { lat: 47.5, lng: 19.08 };
    expect(signedSideOffsetM(FROM, TO, right)).toBeLessThan(0);
    await planTwoSidedLoop(FROM, TO, 'walking', { detour: 'medium', stops: [right] });

    // A visszaút jelöltjeinek köztes pontjai így a BAL oldalra esnek.
    const inboundVias = captured
      .slice(2)
      .filter((request) => request.points.length > 2)
      .map((request) => {
        const [lng, lat] = request.points[1]!;
        return signedSideOffsetM(FROM, TO, { lat, lng });
      });
    expect(inboundVias.length).toBeGreaterThan(0);
    expect(inboundVias.every((side) => side > 0)).toBe(true);
  });
});

describe('köztes pont rákapcsolása', () => {
  /**
   * ⚠️ GERI KÉPÉBŐL: a Duna menti tengelynél a „bal oldal" maga a folyó, és a
   * vízbe eső köztes pontot a motor egy STÉGRE kapcsolja. A jelöltnek ezért
   * veszítenie kell azzal szemben, amelyik rendes útra kapcsolódott.
   */
  it('a messzire kapcsolt köztes pontú jelölt veszít', async () => {
    process.env.GRAPHHOPPER_URL = 'http://localhost:8989';

    const captured: { points: [number, number][]; far: boolean }[] = [];
    let callIndex = 0;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { points: [number, number][] };
      const waypoints = body.points.map(([lng, lat]) => ({ lat, lng }));

      // Minden második köztes pontos kérésnél messzire "kapcsolunk".
      const isLeg = waypoints.length > 2;
      const far = isLeg && callIndex % 2 === 0;
      if (isLeg) callIndex += 1;
      captured.push({ points: body.points, far });

      const snapped = waypoints.map((point, index) =>
        far && index > 0 && index < waypoints.length - 1
          ? { lat: point.lat + 0.004, lng: point.lng }
          : point,
      );
      const path: LatLng[] = [];
      for (let index = 1; index < waypoints.length; index += 1) {
        path.push(...line(waypoints[index - 1]!, waypoints[index]!));
      }
      return {
        ok: true,
        json: async () => ({
          paths: [
            {
              distance: 1_000 * waypoints.length,
              time: 600_000,
              points: encodePolyline(path),
              snapped_waypoints: encodePolyline(snapped),
            },
          ],
        }),
      } as Response;
    });

    const result = await planTwoSidedLoop(FROM, TO, 'walking', { detour: 'medium' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A győztes leg geometriája ne a messzire kapcsolt változat legyen: a
    // ~440 m-es eltolás a vonalláncban is látszana.
    const outboundStart = result.loop.outbound.points[0]!;
    expect(distanceM(outboundStart, FROM)).toBeLessThan(50);
  });
});

describe('measureLoopQuality', () => {
  it('az ellentétes oldalon futó legeket szétváltnak látja', () => {
    const outbound = [FROM, { lat: 47.512, lng: 19.055 }, TO];
    const inbound = [TO, { lat: 47.5, lng: 19.075 }, FROM];
    const quality = measureLoopQuality(FROM, TO, outbound, inbound);

    expect(quality.outboundSideM).toBeGreaterThan(0);
    expect(quality.inboundSideM).toBeLessThan(0);
    expect(quality.separated).toBe(true);
  });

  it('⚠️ az ugyanazon az úton visszajövő legre teljes közös szakaszt mér', () => {
    const outbound = line(FROM, TO);
    const quality = measureLoopQuality(FROM, TO, outbound, [...outbound].reverse());

    expect(quality.sharedPathRatio).toBeCloseTo(1, 5);
    expect(quality.separated).toBe(false);
  });
});
