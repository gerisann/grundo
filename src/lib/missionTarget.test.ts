import { describe, expect, it } from 'vitest';
import { compatibleDistanceTarget } from './missionTarget';

describe('compatibleDistanceTarget', () => {
  it('a kilométer mellett a régi backendnek is érvényes időbecslést ad', () => {
    expect(compatibleDistanceTarget(50, 144)).toEqual({ distanceKm: 50, minutes: 120 });
  });

  it('az időbecslést a szerver által elfogadott tartományba szorítja', () => {
    expect(compatibleDistanceTarget(0.5, 60).minutes).toBe(5);
    expect(compatibleDistanceTarget(50, 3600).minutes).toBe(480);
  });
});
