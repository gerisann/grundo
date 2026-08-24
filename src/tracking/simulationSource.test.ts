import { describe, expect, it } from 'vitest';
import { applySample, createRecorder, start } from './recorder';
import {
  generateGpsActivity,
  routeDistanceM,
  type SimulationWaypoint,
} from './simulationSource';

const T0 = 1_800_000_000_000;
const BASE = { lat: 47.475, lng: 19.015 };

function east(meters: number): SimulationWaypoint {
  const metersPerLng = 111_320 * Math.cos((BASE.lat * Math.PI) / 180);
  return { lat: BASE.lat, lng: BASE.lng + meters / metersPerLng };
}

const ROUTE = [east(0), east(1000)];

const CLEAN = {
  startAt: T0,
  speedKmh: 36,
  sampleIntervalS: 1,
  intervalJitter: 0,
  speedVariation: 0,
  accuracyM: 4,
  noiseM: 0,
  driftM: 0,
  dropoutProbability: 0,
  spikeProbability: 0,
  seed: 12345,
} as const;

describe('GPS activity generator', () => {
  it('azonos seedből bitpontosan azonos telemetry készül', () => {
    const a = generateGpsActivity(ROUTE, { ...CLEAN, noiseM: 3, driftM: 0.3 });
    const b = generateGpsActivity(ROUTE, { ...CLEAN, noiseM: 3, driftM: 0.3 });
    expect(a).toEqual(b);
  });

  it('más seed eltérő mért GPS nyomot ad', () => {
    const a = generateGpsActivity(ROUTE, { ...CLEAN, noiseM: 4, seed: 1 });
    const b = generateGpsActivity(ROUTE, { ...CLEAN, noiseM: 4, seed: 2 });
    expect(a.samples).not.toEqual(b.samples);
  });

  it('a route hossza és a generált idő fizikailag konzisztens', () => {
    const result = generateGpsActivity(ROUTE, CLEAN);
    expect(routeDistanceM(ROUTE)).toBeCloseTo(1000, 0);
    expect(result.routeDistanceM).toBeCloseTo(1000, 0);
    // 36 km/h = 10 m/s, 1 km ≈ 100 s.
    expect(result.durationMs).toBeCloseTo(100_000, -2);
    expect(result.samples.length).toBeGreaterThan(95);
    expect(result.samples.length).toBeLessThan(105);
  });

  it('a telemetry timestampjei szigorúan növekednek', () => {
    const result = generateGpsActivity(ROUTE, {
      ...CLEAN,
      intervalJitter: 0.2,
      dropoutProbability: 0.1,
    });
    for (let i = 1; i < result.samples.length; i += 1) {
      expect(result.samples[i]!.t).toBeGreaterThan(result.samples[i - 1]!.t);
    }
  });

  it('a generált tiszta GPS ugyanazon recorder/filter láncon végigfut', () => {
    const result = generateGpsActivity(ROUTE, CLEAN);
    let recorder = start(createRecorder('ride', 'lab-test'), T0);
    for (const sample of result.samples) recorder = applySample(recorder, sample);

    expect(recorder.points.length).toBe(result.samples.length);
    expect(recorder.distanceM).toBeCloseTo(1000, -1);
    expect(Object.values(recorder.rejected).reduce((sum, value) => sum + value, 0)).toBe(0);
  });

  it('a dropout ténylegesen kihagy location callbackeket', () => {
    const clean = generateGpsActivity(ROUTE, CLEAN);
    const lossy = generateGpsActivity(ROUTE, { ...CLEAN, dropoutProbability: 0.5 });
    expect(lossy.droppedSamples).toBeGreaterThan(0);
    expect(lossy.samples.length).toBeLessThan(clean.samples.length);
  });

  it('a spike mérési hibát hoz létre, nem az ideális route-ot módosítja', () => {
    const result = generateGpsActivity(ROUTE, {
      ...CLEAN,
      spikeProbability: 1,
      spikeMinM: 80,
      spikeMaxM: 80,
    });
    expect(result.route).toEqual(ROUTE);
    expect(result.spikeSamples).toBeGreaterThan(0);
    expect(result.samples.some((sample) => Math.abs(sample.lat - BASE.lat) > 0.0001)).toBe(true);
  });
});
