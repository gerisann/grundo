/**
 * Az API-kliens hibakezelése.
 *
 * A `profile_missing` felismerése kritikus: ezen múlik, hogy a felhasználó a
 * felhasználónév-választóra kerül-e, vagy némán beesik az appba profil nélkül.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';

function mockResponse(status: number, body: unknown, contentType = 'application/json; charset=utf-8') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('api.me — hibakódok', () => {
  it('404 profile_missing → ApiError, code = profile_missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockResponse(404, { code: 'profile_missing', message: 'Még nincs GRUNDO-profilod.' }),
    ));

    let caught: unknown;
    try {
      await api.me();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe('profile_missing');
    expect((caught as ApiError).status).toBe(404);
  });

  it('401 → unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockResponse(401, { code: 'unauthorized', message: 'Hiányzó azonosítás.' }),
    ));
    await expect(api.me()).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('HTML válasz → not_json, érthető üzenettel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(200, null, 'text/html')));
    await expect(api.me()).rejects.toMatchObject({ code: 'not_json' });
  });

  it('sikeres válasz visszaadja a profilt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(200, { profile: { uid: 'u1' } })));
    await expect(api.me()).resolves.toMatchObject({ profile: { uid: 'u1' } });
  });
});
