import { describe, expect, it } from 'vitest';
import { normalizePrivacy, publicRouteNeedsRebuild } from './publicRoute';

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
    expect(publicRouteNeedsRebuild({ routeVersion: 2, routePending: true }, privacy)).toBe(true);
    expect(publicRouteNeedsRebuild({ routeVersion: 2, routePrivacyRevision: 2 }, privacy)).toBe(true);
    expect(publicRouteNeedsRebuild({ routeVersion: 2, routePrivacyRevision: 3 }, privacy)).toBe(false);
  });

  it('törölt aktivitást nem épít újra', () => {
    const privacy = normalizePrivacy({ routeRevision: 2 });
    expect(publicRouteNeedsRebuild({ routeVersion: 1, deletedAt: new Date() }, privacy)).toBe(false);
  });
});
