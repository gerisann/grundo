import { describe, expect, it } from 'vitest';
import {
  containsBounds,
  pointInBounds,
  renderBounds,
  visibleTrackSegments,
} from './mapRender';

describe('renderBounds', () => {
  const viewport = { south: 47.49, west: 19.03, north: 47.5, east: 19.04 };

  it('a kamera körül ráhagyást tart az előtöltéshez', () => {
    const result = renderBounds(viewport, 0.1, null, null);
    expect(result.south).toBeCloseTo(47.489);
    expect(result.west).toBeCloseTo(19.029);
    expect(result.north).toBeCloseTo(47.501);
    expect(result.east).toBeCloseTo(19.041);
  });

  it('a pozíció körüli sugár nem engedi korlátlanra nőni a FOV-ot', () => {
    const result = renderBounds(viewport, 0.3, { lat: 47.495, lng: 19.035 }, 250);
    expect(result.north - result.south).toBeLessThan(0.005);
    expect(result.east - result.west).toBeLessThan(0.007);
    expect(pointInBounds({ lat: 47.495, lng: 19.035 }, result)).toBe(true);
  });

  it('felismeri, amikor a látható kivágás még az előtöltött ablakban van', () => {
    const outer = renderBounds(viewport, 0.2, null, null);
    expect(containsBounds(outer, viewport)).toBe(true);
  });
});

describe('visibleTrackSegments', () => {
  it('megtart egy határpontot a látható vonal két oldalán', () => {
    const track = Array.from({ length: 10 }, (_, index) => ({ lat: 0, lng: index }));
    const segments = visibleTrackSegments(
      track,
      { south: -1, west: 3, north: 1, east: 5 },
      1,
    );
    expect(segments).toEqual([[track[2], track[3], track[4], track[5], track[6]]]);
  });

  it('külön vonal marad, ha a nyomvonal többször lép be a FOV-ba', () => {
    const track = [
      { lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 0, lng: 2 },
      { lat: 10, lng: 10 }, { lat: 0, lng: 2 }, { lat: 0, lng: 1 }, { lat: 0, lng: 0 },
    ];
    const segments = visibleTrackSegments(track, { south: -1, west: 0, north: 1, east: 1 }, 1);
    expect(segments).toHaveLength(2);
  });

  it('egy hosszú aktivitásból is csak a kamera körüli fix munkakészletet adja vissza', () => {
    const track = Array.from({ length: 20_000 }, (_, index) => ({
      lat: 47.5,
      lng: 18 + index * 0.00001,
    }));
    const segments = visibleTrackSegments(
      track,
      { south: 47.49, west: 18.099, north: 47.51, east: 18.101 },
      4,
    );
    const renderedPointCount = segments.reduce((sum, segment) => sum + segment.length, 0);
    expect(renderedPointCount).toBeLessThan(60);
  });
});
