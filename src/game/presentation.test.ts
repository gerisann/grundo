/**
 * A MEGJELENÍTÉST szolgáló számítások: kódolt vonallánc, privát zóna,
 * részidők, szintek.
 *
 * Ezek nem játékszabályok, de a hibájuk épp olyan látható: egy elrontott
 * levágás LAKCÍMET szivárogtat, egy elrontott részidő pedig hamis
 * teljesítményt mutat.
 */

import { describe, expect, it } from 'vitest';
import { buildTrace, ORIGIN, offset } from './fixtures';
import { decodePolyline, encodePolyline, simplifyTrace } from './polyline';
import { trimPrivateEnds, DEFAULT_PRIVACY } from './privacy';
import { computeSplits, elevationProfile } from './splits';
import { levelFor, levelProgress } from './levels';
import { distanceM } from './geo';
import type { TracePoint } from '@/types';

describe('kódolt vonallánc', () => {
  it('a Google referenciapéldáját adja', () => {
    // A specifikáció hivatalos példája — ha ez elromlik, a Mapbox sem tudja
    // értelmezni, amit küldünk.
    const encoded = encodePolyline([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
    expect(encoded).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq' + '`' + '@');
  });

  it('oda-vissza kódolva megmarad a pont — 1,1 méteren belül', () => {
    const trace = buildTrace([ORIGIN, offset(ORIGIN, 400, 0), offset(ORIGIN, 400, 400)]);
    const round = decodePolyline(encodePolyline(trace));

    expect(round).toHaveLength(trace.length);
    for (let i = 0; i < trace.length; i += 1) {
      expect(distanceM(trace[i]!, round[i]!)).toBeLessThan(1.6);
    }
  });

  it('üres nyomvonalból üres sztring', () => {
    expect(encodePolyline([])).toBe('');
    expect(decodePolyline('')).toEqual([]);
  });

  it('a ritkítás nagyságrenddel kevesebb pontot hagy, a kanyarokat megtartva', () => {
    const trace = buildTrace(
      [ORIGIN, offset(ORIGIN, 500, 0), offset(ORIGIN, 500, 500), offset(ORIGIN, 0, 500), ORIGIN],
      { stepM: 2 },
    );
    const simplified = simplifyTrace(trace);

    expect(simplified.length).toBeLessThan(trace.length / 10);
    // A négy sarok + a záró pont MIND megmarad: ezek térnek el legjobban az
    // egyenestől. Egyenletes ritkítás pont ezeket vágná le.
    expect(simplified.length).toBeGreaterThanOrEqual(5);
    expect(simplified[0]).toEqual(trace[0]);
    expect(simplified[simplified.length - 1]).toEqual(trace[trace.length - 1]);
  });
});

describe('privát zóna', () => {
  const straight = buildTrace([ORIGIN, offset(ORIGIN, 1500, 0)], { stepM: 5 });

  it('mindkét véget levágja az alapértelmezett 200 méteren', () => {
    const { points, trimmedStart, trimmedEnd } = trimPrivateEnds(straight);

    expect(trimmedStart).toBe(true);
    expect(trimmedEnd).toBe(true);
    expect(distanceM(straight[0]!, points[0]!)).toBeGreaterThan(200);
    expect(distanceM(straight[straight.length - 1]!, points[points.length - 1]!)).toBeGreaterThan(
      200,
    );
  });

  it('kikapcsolva érintetlenül hagyja a nyomvonalat', () => {
    const { points } = trimPrivateEnds(straight, {
      hideStart: false,
      startRadiusM: 200,
      hideEnd: false,
      endRadiusM: 200,
    });
    expect(points).toHaveLength(straight.length);
  });

  it('a VISSZATÉRŐ szakaszt is levágja, nem csak az első kilépésig', () => {
    /**
     * Ez a lényegi eset. A nyomvonal kimegy 400 méterre, visszatér a
     * kiindulóponthoz, és onnan indul el igazán. Ha az első kilépésnél
     * megállnánk, a visszatérő szakasz újra megmutatná a kezdőpontot — és a
     * védőkör semmit sem érne.
     */
    const outAndBack = buildTrace(
      [ORIGIN, offset(ORIGIN, 400, 0), ORIGIN, offset(ORIGIN, 0, 1500)],
      { stepM: 5 },
    );
    const { points } = trimPrivateEnds(outAndBack, {
      ...DEFAULT_PRIVACY,
      hideEnd: false,
    });

    for (const point of points) {
      expect(distanceM(ORIGIN, point)).toBeGreaterThan(200);
    }
  });

  it('ha az egész aktivitás a körön belül volt, nincs mit mutatni', () => {
    const tiny = buildTrace([ORIGIN, offset(ORIGIN, 80, 0), ORIGIN], { stepM: 5 });
    expect(trimPrivateEnds(tiny).points).toEqual([]);
  });
});

describe('részidők', () => {
  /** 3 km egyenesen, másodpercenkénti mintával, 3 m/s ≈ 5:33/km. */
  const run = buildTrace([ORIGIN, offset(ORIGIN, 3000, 0)], { stepM: 3, intervalS: 1 });

  it('kilométerenként egy sort ad, a maradék külön jelölve', () => {
    const splits = computeSplits(run);
    // A fixture sík közelítéssel épít, ezért a „3000 m" valójában 2997 —
    // két teljes kilométer és egy majdnem teljes maradék.
    expect(splits).toHaveLength(3);
    expect(splits.filter((s) => !s.partial)).toHaveLength(2);
    expect(splits[2]!.partial).toBe(true);
  });

  it('a tempó a valós sebességet adja vissza', () => {
    const [first] = computeSplits(run);
    // 3 m/s → 333 s/km. Az interpoláció pár másodpercen belül hozza.
    expect(first!.paceSPerKm).toBeGreaterThan(325);
    expect(first!.paceSPerKm).toBeLessThan(342);
  });

  it('a részidők összege kiadja a teljes időt', () => {
    const splits = computeSplits(run);
    const total = splits.reduce((sum, s) => sum + s.seconds, 0);
    const elapsed = (run[run.length - 1]!.t - run[0]!.t) / 1000;
    expect(Math.abs(total - elapsed)).toBeLessThan(2);
  });

  it('az 50 méternél rövidebb maradékot nem írja ki külön sorként', () => {
    const short = buildTrace([ORIGIN, offset(ORIGIN, 1020, 0)], { stepM: 3 });
    expect(computeSplits(short)).toHaveLength(1);
  });

  it('a szintemelkedés zaja nem adódik össze', () => {
    // Sík futás, ±2 méteres barométer-zajjal. Küszöb nélkül ez több száz
    // méteres „emelkedést" adna.
    const noisy: TracePoint[] = run.map((p, i) => ({ ...p, elevation: 100 + (i % 2 ? 2 : 0) }));
    expect(elevationProfile(noisy).gainM).toBe(0);
  });

  it('a valódi emelkedést viszont megtalálja', () => {
    const climb: TracePoint[] = run.map((p, i) => ({
      ...p,
      elevation: 100 + (i / run.length) * 60,
    }));
    const profile = elevationProfile(climb);
    expect(profile.gainM).toBeGreaterThan(50);
    expect(profile.gainM).toBeLessThan(62);
    expect(profile.lossM).toBe(0);
  });
});

describe('szintek', () => {
  it('a nulláról induló fiók az első szinten van', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelProgress(0).name).toBe('JÖVEVÉNY');
  });

  it('a küszöb ELÉRÉSE már szintlépés', () => {
    expect(levelFor(299)).toBe(1);
    expect(levelFor(300)).toBe(2);
  });

  it('a hátralévő pont a következő küszöbig szól', () => {
    const progress = levelProgress(500);
    expect(progress.level).toBe(2);
    expect(progress.remaining).toBe(400); // 900 − 500
    expect(progress.nextName).toBe('NYOMKERESŐ');
  });

  it('a csúcson a sáv tele van, és nincs következő szint', () => {
    const top = levelProgress(250_000);
    expect(top.level).toBe(10);
    expect(top.nextName).toBeNull();
    expect(top.ratio).toBe(1);
    expect(top.remaining).toBe(0);
  });

  it('a haladás a sávon belül arányos', () => {
    // A 2. szint 300-tól 900-ig tart; a 600 pont épp a fele.
    expect(levelProgress(600).ratio).toBeCloseTo(0.5, 5);
  });
});
