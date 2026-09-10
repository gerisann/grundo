import { afterEach, describe, expect, it, vi } from 'vitest';
import { loopBearings, planLoop, planMissionLoop } from './directions';
import { GAMEPLAY } from '../../../src/config/gameplay';
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
  delete process.env.GRAPHHOPPER_URL;
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
    expect(url).toContain('steps=true');
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

  it('a Mapbox-lépéseket közös manővermodellre alakítja, a belső waypoint-érkezések nélkül', async () => {
    process.env.MAPBOX_TOKEN = 'test-token';
    const geometry = encodePolyline([ORIGIN, WAYPOINTS[0]!, WAYPOINTS[1]!, ORIGIN]);
    vi.stubGlobal('fetch', vi.fn(async () => response({
      code: 'Ok',
      routes: [{
        distance: 450,
        duration: 300,
        geometry,
        legs: [
          {
            steps: [
              { distance: 100, name: 'Első utca', maneuver: { type: 'depart', location: [19.04, 47.5] } },
              { distance: 200, name: 'Második utca', maneuver: { type: 'turn', modifier: 'right', location: [19.05, 47.51] } },
              { distance: 0, maneuver: { type: 'arrive', location: [19.06, 47.5] } },
            ],
          },
          {
            steps: [
              { distance: 150, name: 'Harmadik utca', maneuver: { type: 'depart', location: [19.06, 47.5] } },
              { distance: 0, maneuver: { type: 'arrive', location: [19.04, 47.5] } },
            ],
          },
        ],
      }],
    })));

    const routes = await planLoop(ORIGIN, WAYPOINTS, 'walking');

    expect(routes[0]?.maneuvers).toEqual([
      expect.objectContaining({ type: 'depart', routeOffsetM: 0, streetName: 'Első utca' }),
      expect.objectContaining({ type: 'turn', modifier: 'right', routeOffsetM: 100 }),
      expect.objectContaining({ type: 'continue', routeOffsetM: 300, streetName: 'Harmadik utca' }),
      expect.objectContaining({ type: 'arrive', routeOffsetM: 450 }),
    ]);
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

describe('planMissionLoop', () => {
  it('a GraphHopper round_trip-jét hívja, magonként egyszer, és a duplikátumokat kiszűri', async () => {
    process.env.GRAPHHOPPER_URL = 'http://localhost:8989/';
    const fetchMock = vi.fn(async () => response({
      paths: [{ distance: 7600, time: 5_400_000, points: 'same' }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const routes = await planMissionLoop(ORIGIN, 90, 7.5, 'walking', GAMEPLAY, 'twisty');

    expect(fetchMock).toHaveBeenCalledTimes(3); // GH_SEEDS_PER_BEARING
    expect(routes).toHaveLength(1); // a három azonos geometriájú válasz egybeolvad
    expect(routes[0]).toEqual({ distanceM: 7600, durationS: 5400, polyline: 'same' });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toBe('http://localhost:8989/route');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.algorithm).toBe('round_trip');
    expect(body.profile).toBe('foot');
    expect(body['round_trip.distance']).toBe(7500);
    expect(body.headings).toEqual([90]);
    expect(body.instructions).toBe(true);
    expect((body.custom_model as Record<string, unknown>).turn_penalty).toBeUndefined();
  });

  it('a GraphHopper instrukcióit szemantikus manőverekké és útvonal-offsetekké alakítja', async () => {
    process.env.GRAPHHOPPER_URL = 'http://localhost:8989';
    const points = encodePolyline([ORIGIN, WAYPOINTS[0]!, ORIGIN]);
    vi.stubGlobal('fetch', vi.fn(async () => response({
      paths: [{
        distance: 2400,
        time: 1_200_000,
        points,
        instructions: [
          { sign: 0, interval: [0, 0], street_name: 'Induló utca' },
          { sign: 2, interval: [1, 1], street_name: 'Jobb utca' },
          { sign: 4, interval: [2, 2] },
        ],
      }],
    })));

    const routes = await planMissionLoop(ORIGIN, 90, 2.4, 'walking', GAMEPLAY, 'twisty');

    expect(routes[0]?.maneuvers).toEqual([
      expect.objectContaining({ type: 'depart', routeOffsetM: 0, streetName: 'Induló utca' }),
      expect.objectContaining({ type: 'turn', modifier: 'right', streetName: 'Jobb utca' }),
      expect.objectContaining({ type: 'arrive' }),
    ]);
    expect(routes[0]?.maneuvers?.[1]?.routeOffsetM).toBeGreaterThan(0);
  });

  it('"straight" karakternél a kérésbe kerül a turn_penalty, bringánál a bike profil', async () => {
    process.env.GRAPHHOPPER_URL = 'http://localhost:8989';
    const fetchMock = vi.fn(async () => response({ paths: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await planMissionLoop(ORIGIN, 0, 16, 'cycling', GAMEPLAY, 'straight');

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { profile: string; custom_model: { turn_penalty?: unknown } };
    expect(body.profile).toBe('bike');
    expect(body.custom_model.turn_penalty).toBeDefined();
  });

  it('ha a GraphHopper nem ad jelöltet, Mapboxra esik vissza, ha van token', async () => {
    process.env.GRAPHHOPPER_URL = 'http://localhost:8989';
    process.env.MAPBOX_TOKEN = 'test-token';
    const fetchMock = vi
      .fn()
      // 3 GraphHopper-kísérlet, mind üres
      .mockResolvedValueOnce(response({ paths: [] }))
      .mockResolvedValueOnce(response({ paths: [] }))
      .mockResolvedValueOnce(response({ paths: [] }))
      // a Mapbox-ág első, irányhelyes kérése
      .mockResolvedValueOnce(response({
        code: 'Ok',
        routes: [{ distance: 7500, duration: 3000, geometry: 'mapbox-fallback' }],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const routes = await planMissionLoop(ORIGIN, 90, 7.5, 'walking', GAMEPLAY, 'twisty');

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(routes.map((route) => route.polyline)).toEqual(['mapbox-fallback']);
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain('api.mapbox.com');
  });

  it('se GraphHopper, se Mapbox: üres listát ad, hívás nélkül', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const routes = await planMissionLoop(ORIGIN, 0, 5, 'walking', GAMEPLAY, 'twisty');

    expect(routes).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
