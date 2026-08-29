import { describe, expect, it } from 'vitest';
import { buildOwnerRouteView, normalizePrivacy, publicRouteNeedsRebuild } from './publicRoute';

describe('publikus aktivitás-útvonal', () => {
  it('biztonságos alapértékeket ad régi profilhoz', () => {
    expect(normalizePrivacy(undefined)).toEqual({
      hideStart: true,
      startRadiusM: 200,
      hideEnd: true,
      endRadiusM: 200,
      routeRevision: 0,
    });
  });

  it('hibás sugár helyett a specifikáció szerinti alapértéket használja', () => {
    const privacy = normalizePrivacy({
      hideStart: false,
      startRadiusM: 75,
      hideEnd: true,
      endRadiusM: 100,
      routeRevision: 4.8,
    });
    expect(privacy).toMatchObject({
      hideStart: false,
      startRadiusM: 200,
      hideEnd: true,
      endRadiusM: 100,
      routeRevision: 4,
    });
  });

  it('régi, félbemaradt vagy más privacy-verziójú útvonalat újraépít', () => {
    const privacy = normalizePrivacy({ routeRevision: 3 });
    expect(publicRouteNeedsRebuild({ routeVersion: 1 }, privacy)).toBe(true);
    // A 2-es verzió a privátzóna-hiba javítása ELŐTTI vágással készült — a
    // 3-asra emelés pont azért van, hogy ezek újraépüljenek (2026-08-29).
    expect(publicRouteNeedsRebuild({ routeVersion: 2, routePrivacyRevision: 3 }, privacy)).toBe(true);
    expect(publicRouteNeedsRebuild({ routeVersion: 3, routePending: true }, privacy)).toBe(true);
    expect(publicRouteNeedsRebuild({ routeVersion: 3, routePrivacyRevision: 2 }, privacy)).toBe(true);
    expect(publicRouteNeedsRebuild({ routeVersion: 3, routePrivacyRevision: 3 }, privacy)).toBe(false);
  });

  it('törölt aktivitást nem épít újra', () => {
    const privacy = normalizePrivacy({ routeRevision: 2 });
    expect(publicRouteNeedsRebuild({ routeVersion: 1, deletedAt: new Date() }, privacy)).toBe(false);
  });

  it('a tulajdonosi nézet a teljes nyomvonalat kódolja privacy-vágás nélkül', () => {
    const points = [
      { lat: 47.49, lng: 19.02, t: 1 },
      { lat: 47.491, lng: 19.021, t: 2 },
      { lat: 47.492, lng: 19.023, t: 3 },
    ];
    const view = buildOwnerRouteView(points);
    expect(view?.route.length).toBeGreaterThan(0);
    expect(view?.routeHidden).toBe(false);
    expect(view?.bounds).toEqual({
      north: 47.492,
      south: 47.49,
      east: 19.023,
      west: 19.02,
    });
  });
});
