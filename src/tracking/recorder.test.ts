/**
 * A rögzítő állapotgépe.
 *
 * A hangsúly azokon az eseteken van, amiket valós terepen nehéz előidézni:
 * jelvesztés, ugró fix, álló helyzeti zaj, és a natív háttérszolgáltatások
 * ébredés utáni, sorrenden kívüli kötegelt szállítása.
 */

import { describe, expect, it } from 'vitest';
import {
  applySample,
  createRecorder,
  finish,
  movingMs,
  paceSecPerKm,
  pause,
  resume,
  start,
  type RecorderState,
} from './recorder';
import type { PositionSample } from './types';

const T0 = 1_800_000_000_000;
const BASE = { lat: 47.4979, lng: 19.0402 }; // Budapest, Deák tér

/** Északra tolt pont — 1 fok szélesség ≈ 111 320 m. */
function north(meters: number) {
  return { lat: BASE.lat + meters / 111_320, lng: BASE.lng };
}

function sample(offsetM: number, seconds: number, accuracy = 8): PositionSample {
  return { ...north(offsetM), t: T0 + seconds * 1000, accuracy };
}

function recording(): RecorderState {
  return start(createRecorder('run'), T0);
}

/** Több minta egymás után. */
function feed(state: RecorderState, samples: PositionSample[]): RecorderState {
  return samples.reduce(applySample, state);
}

describe('állapotátmenetek', () => {
  it('idle állapotban nem gyűjt mintát', () => {
    const state = applySample(createRecorder('run'), sample(0, 0));
    expect(state.points).toHaveLength(0);
  });

  it('szünet alatt érkező mintát eldob', () => {
    let state = feed(recording(), [sample(0, 0), sample(10, 5)]);
    state = pause(state, T0 + 6000);
    state = applySample(state, sample(20, 10));
    expect(state.points).toHaveLength(2);
  });

  it('folytatás után újra gyűjt', () => {
    let state = feed(recording(), [sample(0, 0)]);
    state = pause(state, T0 + 1000);
    state = resume(state, T0 + 61_000);
    state = applySample(state, sample(10, 62));
    expect(state.points).toHaveLength(2);
  });

  it('a szünet ideje nem számít bele a mozgásidőbe', () => {
    let state = recording();
    state = pause(state, T0 + 10_000);
    state = resume(state, T0 + 70_000); // egy perc szünet
    state = finish(state, T0 + 80_000);
    expect(movingMs(state, T0 + 80_000)).toBe(20_000);
  });

  it('szünet közbeni leállásnál is lezárja a nyitott szünetet', () => {
    let state = recording();
    state = pause(state, T0 + 10_000);
    state = finish(state, T0 + 40_000);
    expect(movingMs(state, T0 + 999_999)).toBe(10_000);
  });

  it('a leállás után érkező minta már nem számít', () => {
    let state = feed(recording(), [sample(0, 0), sample(10, 5)]);
    state = finish(state, T0 + 6000);
    state = applySample(state, sample(20, 10));
    expect(state.points).toHaveLength(2);
  });
});

describe('szűrés', () => {
  it('elutasítja a pontatlan fixet', () => {
    const state = feed(recording(), [sample(0, 0, 8), sample(10, 5, 120)]);
    expect(state.points).toHaveLength(1);
    expect(state.rejected.inaccurate).toBe(1);
  });

  it('elutasítja a fizikailag lehetetlen ugrást', () => {
    // 5 km egy másodperc alatt.
    const state = feed(recording(), [sample(0, 0), sample(5000, 1)]);
    expect(state.points).toHaveLength(1);
    expect(state.rejected.implausible_speed).toBe(1);
  });

  it('álló helyzeti zajt nem halmoz távolsággá', () => {
    // Tíz minta 2 méteres körben, másodpercenként — piros lámpánál állva.
    let state = feed(recording(), [sample(0, 0)]);
    for (let i = 1; i <= 10; i += 1) {
      state = applySample(state, sample(i % 2 === 0 ? 2 : 0, i));
    }
    expect(state.points).toHaveLength(1);
    expect(state.distanceM).toBe(0);
  });

  it('hosszú állás után mégis rögzít egy pontot', () => {
    // Enélkül a szünet nem lenne megkülönböztethető a jelvesztéstől.
    const state = feed(recording(), [sample(0, 0), sample(2, 45)]);
    expect(state.points).toHaveLength(2);
  });
});

describe('távolság', () => {
  it('egyenes mentén összegzi a szakaszokat', () => {
    const state = feed(recording(), [sample(0, 0), sample(100, 20), sample(200, 40)]);
    expect(state.points).toHaveLength(3);
    expect(state.distanceM).toBeCloseTo(200, 0);
  });

  it('a tempó másodperc/kilométerben jön', () => {
    // 200 m 60 másodperc alatt → 300 s/km (5:00/km).
    let state = feed(recording(), [sample(0, 0), sample(200, 60)]);
    state = finish(state, T0 + 60_000);
    expect(paceSecPerKm(state, T0 + 60_000)).toBeCloseTo(300, 0);
  });

  it('rövid távon nem ad tempót', () => {
    // Nulla közeli távolságnál a tempó a végtelenbe szaladna.
    const state = feed(recording(), [sample(0, 0), sample(10, 5)]);
    expect(paceSecPerKm(state, T0 + 5000)).toBeNull();
  });
});

describe('sorrenden kívüli minták — a natív háttérszolgáltatás esete', () => {
  it('időrendbe szúrja a későn érkező mintát', () => {
    // A köteg sorrendje: 0 s, 40 s, majd UTÓLAG a 20 s-os.
    const state = feed(recording(), [sample(0, 0), sample(200, 40), sample(100, 20)]);
    expect(state.points.map((p) => p.t - T0)).toEqual([0, 20_000, 40_000]);
  });

  it('beszúrás után a távolság a valós útvonalat adja', () => {
    const ordered = feed(recording(), [sample(0, 0), sample(100, 20), sample(200, 40)]);
    const shuffled = feed(recording(), [sample(0, 0), sample(200, 40), sample(100, 20)]);
    // A közbeszúrt pont ugyanazt az útvonalat írja le, tehát ugyanannyi a hossz.
    expect(shuffled.distanceM).toBeCloseTo(ordered.distanceM, 6);
  });

  it('az azonos időbélyegű ismétlést eldobja', () => {
    const state = feed(recording(), [sample(0, 0), sample(50, 10), sample(60, 10)]);
    expect(state.points).toHaveLength(2);
    expect(state.rejected.not_newer).toBe(1);
  });

  it('a beszúrt pontot is a szomszédjához méri, nem a nyomvonal végéhez', () => {
    // A 20 s-os minta ugrásnak látszana a 40 s-oshoz képest, de az ELŐZŐ
    // szomszédjához (0 s) mérve teljesen szabályos.
    const state = feed(recording(), [sample(0, 0), sample(200, 40), sample(100, 20)]);
    expect(state.rejected.implausible_speed).toBeUndefined();
    expect(state.points).toHaveLength(3);
  });
});

describe('a nyomvonal a motor bemenete', () => {
  it('a pontok a TracePoint alakot követik', () => {
    const state = feed(recording(), [sample(0, 0), sample(100, 20)]);
    for (const point of state.points) {
      expect(Object.keys(point).sort()).toEqual(['accuracy', 'lat', 'lng', 't']);
    }
  });

  it('a pontok ideje szigorúan növekvő', () => {
    const state = feed(recording(), [sample(0, 0), sample(200, 40), sample(100, 20)]);
    const times = state.points.map((p) => p.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
  });
});
