/**
 * A címkereső összefésülő logikája — HÁLÓZAT NÉLKÜL.
 *
 * Amit itt bizonyítunk, az nem a Mapbox működése, hanem a MIÉNK: a két forrás
 * egyesítése, a deduplikálás, a távolság szerinti rendezés, és a
 * költségvédelem (rövid lekérdezés és gyorsítótár). Ezek a szabályok mérésből
 * születtek (lásd `geocode.ts` fejléc), tehát regresszió esetén itt kell
 * elhasalnia, nem élesben.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Egy Mapbox-szerű találat legyártása. */
function feature(name: string, lng: number, lat: number, address?: string) {
  return {
    properties: { name, full_address: address },
    geometry: { coordinates: [lng, lat] },
  };
}

const BUDAPEST = { lat: 47.4979, lng: 19.0544 };

describe('searchPlaces', () => {
  let calls: string[];

  beforeEach(() => {
    vi.resetModules();
    process.env.MAPBOX_TOKEN = 'pk.teszt';
    calls = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MAPBOX_TOKEN;
  });

  /** A két végpontot a válaszaival együtt kicseréljük. */
  function stubMapbox(v6: unknown[], searchBox: unknown[]) {
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      const body = url.includes('/geocode/v6/') ? { features: v6 } : { features: searchBox };
      return { ok: true, json: async () => body } as unknown as Response;
    });
  }

  it('TÁVOLSÁG szerint rendez, nem a szolgáltató sorrendjében', async () => {
    /*
      A mért eset: a „Blaha Lujza tér” keresésre budapesti nézetből is a
      kiskunfélegyházi jött elsőnek, mert a Mapbox a pontos névegyezést
      erősebbnek látja a közelségnél.
    */
    stubMapbox(
      [feature('Blaha Lujza tér', 19.6900, 46.7100)], // Kiskunfélegyháza
      [feature('Blaha Lujza tér', 19.0700, 47.4960)], // Budapest
    );
    const { searchPlaces } = await import('./geocode');
    const hits = await searchPlaces('Blaha Lujza tér', BUDAPEST);

    expect(hits).toHaveLength(2);
    expect(hits[0]!.distanceM).toBeLessThan(hits[1]!.distanceM);
    expect(hits[0]!.lat).toBeCloseTo(47.4960, 3);
  });

  it('a KÉT forrás uniója megy vissza, ~11 méteren belül deduplikálva', async () => {
    stubMapbox(
      [feature('Deák Ferenc tér', 19.0544, 47.4979)],
      [
        feature('Deák Ferenc tér', 19.05442, 47.49791), // ugyanaz a hely
        feature('Astoria', 19.0600, 47.4940),
      ],
    );
    const { searchPlaces } = await import('./geocode');
    const hits = await searchPlaces('deák tér', BUDAPEST);

    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.label)).toContain('Astoria');
    /* Mindkét végpontot megkérdeztük — egyik forrás sem elég önmagában. */
    expect(calls.some((u) => u.includes('/geocode/v6/'))).toBe(true);
    expect(calls.some((u) => u.includes('/searchbox/'))).toBe(true);
  });

  it('három karakter alatt NEM hív külső szolgáltatást', async () => {
    stubMapbox([feature('Bármi', 19.05, 47.5)], []);
    const { searchPlaces } = await import('./geocode');

    expect(await searchPlaces('de', BUDAPEST)).toEqual([]);
    expect(await searchPlaces('  x ', BUDAPEST)).toEqual([]);
    /* EZ A LÉNYEG: a geocoding pénzbe kerül, gépelés közben ne fizessünk. */
    expect(calls).toHaveLength(0);
  });

  it('a gyorsítótár megspórolja az ismételt hívást', async () => {
    stubMapbox([feature('Deák Ferenc tér', 19.0544, 47.4979)], []);
    const { searchPlaces } = await import('./geocode');

    await searchPlaces('deák tér', BUDAPEST);
    const afterFirst = calls.length;
    await searchPlaces('DEÁK TÉR', BUDAPEST); // kis/nagybetű nem számít
    expect(calls).toHaveLength(afterFirst);
  });

  it('az ÜRES találatot nem tárolja el — lehet átmeneti hiba is', async () => {
    stubMapbox([], []);
    const { searchPlaces } = await import('./geocode');

    await searchPlaces('nincs ilyen', BUDAPEST);
    const afterFirst = calls.length;
    await searchPlaces('nincs ilyen', BUDAPEST);
    expect(calls.length).toBeGreaterThan(afterFirst);
  });

  it('az egyik forrás hibája nem viszi el a másikat', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      if (url.includes('/geocode/v6/')) throw new Error('hálózati hiba');
      return {
        ok: true,
        json: async () => ({ features: [feature('Astoria', 19.0600, 47.4940)] }),
      } as unknown as Response;
    });
    const { searchPlaces } = await import('./geocode');

    const hits = await searchPlaces('astoria', BUDAPEST);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.label).toBe('Astoria');
  });

  it('token nélkül üres listát ad, nem hibázik', async () => {
    delete process.env.MAPBOX_TOKEN;
    stubMapbox([feature('Bármi', 19.05, 47.5)], []);
    const { searchPlaces, geocodeConfigured } = await import('./geocode');

    expect(geocodeConfigured()).toBe(false);
    expect(await searchPlaces('deák tér', BUDAPEST)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
