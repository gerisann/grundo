import { describe, expect, it } from 'vitest';
import { interpolateMapPosition, isUserCameraMove, mapMotionDuration } from './mapMotion';

describe('isUserCameraMove', () => {
  it('a Mapbox programozott animációját nem tekinti kézi elmozdításnak', () => {
    expect(isUserCameraMove({})).toBe(false);
    expect(isUserCameraMove({ originalEvent: null })).toBe(false);
  });

  it('minden DOM-eseményből indult kameramozgást felismer', () => {
    expect(isUserCameraMove({ originalEvent: { type: 'touchmove' } })).toBe(true);
    expect(isUserCameraMove({ originalEvent: { type: 'wheel' } })).toBe(true);
  });
});

describe('mapMotionDuration', () => {
  it('a normál mintaközt kitölti, de ésszerű tartományba vágja', () => {
    expect(mapMotionDuration({ lat: 0, lng: 0, t: 0 }, { lat: 0, lng: 0, t: 1_000 })).toBe(1_000);
    expect(mapMotionDuration({ lat: 0, lng: 0, t: 0 }, { lat: 0, lng: 0, t: 100 })).toBe(300);
    expect(mapMotionDuration({ lat: 0, lng: 0, t: 0 }, { lat: 0, lng: 0, t: 4_000 })).toBe(1_200);
  });

  it('hosszú háttérszünet után gyorsan felzárkózik', () => {
    expect(mapMotionDuration({ lat: 0, lng: 0, t: 0 }, { lat: 0, lng: 0, t: 30_000 })).toBe(450);
  });
});

describe('interpolateMapPosition', () => {
  it('folytonosan halad a két pont között', () => {
    expect(interpolateMapPosition(
      { lat: 47, lng: 19 },
      { lat: 48, lng: 21 },
      0.25,
    )).toEqual({ lat: 47.25, lng: 19.5 });
  });

  it('a dátumváltó meridiánnál a rövid úton halad', () => {
    const middle = interpolateMapPosition(
      { lat: 0, lng: 179 },
      { lat: 0, lng: -179 },
      0.5,
    );
    expect(Math.abs(middle.lng)).toBe(180);
  });
});
