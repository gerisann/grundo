import { describe, expect, it, vi } from 'vitest';
import { applySample, createRecorder, start } from './recorder';
import {
  generateGpsActivity,
  routeDistanceM,
  SimulationPositionSource,
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

  it('MAX lejátszás minden mintát átad és befejeződik', async () => {
    vi.useFakeTimers();
    try {
      const result = generateGpsActivity([east(0), east(3000)], CLEAN);
      const received: typeof result.samples = [];
      let completed = false;
      const source = new SimulationPositionSource(result.samples, 0, () => {
        completed = true;
      });

      await source.start(
        {
          onSample(sample) {
            received.push(sample);
          },
          onError() {},
        },
        'ride',
      );

      await vi.runAllTimersAsync();

      expect(received).toEqual(result.samples);
      expect(completed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * ⚠️ EZ EGY LAB-BELI FÉLREVEZETÉST RÖGZÍT (Geri, 2026-09-03).
   *
   * A szünet korábban csak a KIRAJZOLÁST állította meg: a lejátszás tovább
   * fogyasztotta a mintákat, a rögzítő pedig eldobta őket, mert szünetel.
   * Folytatáskor a nyomvonal légvonalban kötötte össze a kimaradt szakaszt —
   * a LAB tehát pont azt a helyzetet nem tudta megmutatni, amiért a szünetet
   * tesztelni akarjuk.
   */
  it('szünetben nem fogyaszt mintát, és folytatáskor ugyanonnan megy tovább', async () => {
    vi.useFakeTimers();
    try {
      const result = generateGpsActivity([east(0), east(3000)], CLEAN);
      const received: typeof result.samples = [];
      const source = new SimulationPositionSource(result.samples, 1);

      await source.start(
        { onSample: (sample) => { received.push(sample); }, onError() {} },
        'ride',
      );

      await vi.advanceTimersByTimeAsync(5_000);
      const beforePause = received.length;
      expect(beforePause).toBeGreaterThan(0);

      source.syncActivity({
        status: 'paused',
        startedAt: T0,
        distanceM: 0,
        pausedMs: 0,
        pausedAt: T0,
      });

      // A szünet alatt a falióra telik, a telemetria mégsem fogy.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(received.length).toBe(beforePause);

      source.syncActivity({
        status: 'recording',
        startedAt: T0,
        distanceM: 0,
        pausedMs: 30_000,
        pausedAt: null,
      });

      await vi.advanceTimersByTimeAsync(5_000);
      expect(received.length).toBeGreaterThan(beforePause);

      // A LÉNYEG: a folytatás a következő mintával megy tovább, nem ugrik —
      // se kimaradás, se duplikátum nincs a sorozatban.
      expect(received).toEqual(result.samples.slice(0, received.length));

      await source.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('az ismételt szünet-jelzés nem indít párhuzamos lejátszást', async () => {
    vi.useFakeTimers();
    try {
      const result = generateGpsActivity([east(0), east(3000)], CLEAN);
      const received: typeof result.samples = [];
      const source = new SimulationPositionSource(result.samples, 1);
      const recording = {
        status: 'recording' as const,
        startedAt: T0,
        distanceM: 0,
        pausedMs: 0,
        pausedAt: null,
      };

      await source.start(
        { onSample: (sample) => { received.push(sample); }, onError() {} },
        'ride',
      );
      await vi.advanceTimersByTimeAsync(3_000);

      // A rögzítő másodpercenként is szinkronizál, nem csak státuszváltáskor.
      // Ha ezek mindegyike újraindítaná a pumpát, a minták duplán jönnének.
      source.syncActivity(recording);
      source.syncActivity(recording);
      source.syncActivity(recording);
      await vi.advanceTimersByTimeAsync(3_000);

      expect(received).toEqual(result.samples.slice(0, received.length));
      await source.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
