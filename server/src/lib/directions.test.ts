import { afterEach, describe, expect, it, vi } from 'vitest';
import { loopBearings, planLoop } from './directions';
import type { LatLng } from '../../../src/game/geo';
import { encodePolyline } from '../../../src/game/polyline';
import { destinationPoint } from '../../../src/game/missions';

const ORIGIN: LatLng = { lat: 47.5, lng: 19.04 };
const WAYPOINTS: LatLng[] = [
  { lat: 47.51, lng: 19.05 },
  { lat: 47.5, lng: 19.06 },
  { lat: 47.49, lng: 19.05 },
];

function response(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MAPBOX_TOKEN;
});

describe('loopBearings', () => {
  it('csak a köztes pontokat korlátozza, a következő körpont irányában', () => {
    const path = [ORIGIN, ...WAYPOINTS, ORIGIN];
    const values = loopBearings(path).split(';');

    expect(values).toHaveLength(path.length);
    expect(values[0]).toBe('');
    expect(values.at(-1)).toBe('');
    expect(values.slice(1, -1)).toEqual([
      expect.stringMatching(/^\d{1,3},45$/),
      expect.stringMatching(/^\d{1,3},45$/),
      expect.stringMatching(/^\d{1,3},45$/),
    ]);
  });
});

describe('planLoop', () => {
  it('irányhelyes továbbhaladást és Mapbox-alternatívákat kér', async () => {
    process.env.MAPBOX_TOKEN = 'test-token';
    const fetchMock = vi.fn(async () => response({
      code: 'Ok',
      routes: [
        { distance: 5100, duration: 3000, geometry: 'first' },
        { distance: 5250, duration: 3050, geometry: 'second' },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const routes = await planLoop(ORIGIN, WAYPOINTS, 'walking');

    expect(routes.map((route) => route.polyline)).toEqual(['first', 'second']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = decodeURIComponent(String(fetchMock.mock.calls[0]?.[0]));
    expect(url).toContain('alternatives=true');
    expect(url).toContain('continue_straight=true');
    expect(url).toContain('bearings=;');
    expect(url).toMatch(/bearings=;[^;]+;[^;]+;[^;]+;(&|access_token)/);
  });

  it('csak útvonalhiánynál esik vissza a régi, laza kérésre', async () => {
    process.env.MAPBOX_TOKEN = 'test-token';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ code: 'NoRoute', routes: [] }))
      .mockResolvedValueOnce(response({
        code: 'Ok',
        routes: [{ distance: 4900, duration: 2900, geometry: 'fallback' }],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const routes = await planLoop(ORIGIN, WAYPOINTS, 'cycling');

    expect(routes.map((route) => route.polyline)).toEqual(['fallback']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = decodeURIComponent(String(fetchMock.mock.calls[0]?.[0]));
    const secondUrl = decodeURIComponent(String(fetchMock.mock.calls[1]?.[0]));
    expect(firstUrl).toContain('continue_straight=true');
    expect(firstUrl).toContain('bearings=;');
    expect(secondUrl).toContain('continue_straight=false');
    expect(secondUrl).not.toContain('bearings=');
  });

  it('kiszűri a hibás és a duplikált Mapbox-válaszokat', async () => {
    process.env.MAPBOX_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn(async () => response({
      code: 'Ok',
      routes: [
        { distance: 5000, duration: 3000, geometry: 'valid' },
        { distance: 5000, duration: 3000, geometry: 'valid' },
        { distance: 5000, duration: 3000 },
      ],
    })));

    await expect(planLoop(ORIGIN, WAYPOINTS, 'walking')).resolves.toHaveLength(1);
  });

  it('a visszatérő lábat okozó köztes ponttal újratervezi a járható útvonalat', async () => {
    process.env.MAPBOX_TOKEN = 'test-token';
    const tip = destinationPoint(WAYPOINTS[0]!, 0, 60);
    const spurred = encodePolyline([
      ORIGIN,
      WAYPOINTS[0]!,
      tip,
      WAYPOINTS[0]!,
      WAYPOINTS[1]!,
      WAYPOINTS[2]!,
      ORIGIN,
    ]);
    const repaired = encodePolyline([ORIGIN, ...WAYPOINTS, ORIGIN]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({
        code: 'Ok',
        routes: [{ distance: 5000, duration: 3000, geometry: spurred }],
      }))
      .mockResolvedValueOnce(response({
        code: 'Ok',
        routes: [{ distance: 4900, duration: 2950, geometry: repaired }],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const routes = await planLoop(ORIGIN, WAYPOINTS, 'walking');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(routes.map((route) => route.polyline)).toEqual([repaired, spurred]);
    expect(String(fetchMock.mock.calls[1]?.[0])).not.toBe(String(fetchMock.mock.calls[0]?.[0]));
  });
});
