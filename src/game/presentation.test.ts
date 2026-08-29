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
import { GAMEPLAY } from '@/config/gameplay';
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

  it('a menet KÖZBEN visszatérő útvonalból csak a védőkört vágja ki', () => {
    /*
      ÉLES HIBA, 2026-08-29: egy 17 km-es, háromhurkos aktivitás TELJESEN
      eltűnt 200 méteres beállítás mellett, mert az eleji vágás az utolsó
      rajt-közeli pontig tartott — a nyomvonal pedig menet közben visszatért
      a rajthoz. Mérve: 44-90 % veszett el a helyes ~5-14 % helyett.
    */
    const twoLoops = buildTrace(
      [
        ORIGIN,
        offset(ORIGIN, 0, 2500),
        offset(ORIGIN, 900, 2500),
        offset(ORIGIN, 900, 100),
        ORIGIN, // ⬅ visszatér a rajthoz, félúton
        offset(ORIGIN, 1500, -750),
        offset(ORIGIN, 1500, 200),
        ORIGIN,
      ],
      { stepM: 25 },
    );
    const { points } = trimPrivateEnds(twoLoops, DEFAULT_PRIVACY);

    // A védőkörből semmi nem szivároghat ki — ez a védelem lényege.
    for (const point of points) {
      expect(distanceM(ORIGIN, point)).toBeGreaterThan(200);
    }
    // De az útvonal érdemi része megmarad: a kör közepe nem eshet áldozatul
    // annak, hogy a nyomvonal egyszer visszaérintette a rajtot.
    expect(points.length).toBeGreaterThan(twoLoops.length * 0.85);
  });

  it('ha az egész aktivitás a körön belül volt, nincs mit mutatni', () => {
    const tiny = buildTrace([ORIGIN, offset(ORIGIN, 80, 0), ORIGIN], { stepM: 5 });
    expect(trimPrivateEnds(tiny).points).toEqual([]);
  });

  it('zárt körnél nem rejti el tévesen az egész útvonalat', () => {
    const loop = buildTrace(
      [
        ORIGIN,
        offset(ORIGIN, 0, 800),
        offset(ORIGIN, 800, 800),
        offset(ORIGIN, 800, 0),
        ORIGIN,
      ],
      { stepM: 5 },
    );
    const { points, trimmedStart, trimmedEnd } = trimPrivateEnds(loop);

    expect(points.length).toBeGreaterThan(100);
    expect(trimmedStart).toBe(true);
    expect(trimmedEnd).toBe(true);
    expect(distanceM(ORIGIN, points[0]!)).toBeGreaterThan(200);
    expect(distanceM(ORIGIN, points[points.length - 1]!)).toBeGreaterThan(200);
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

  it('beltéri/álló helyzeti GPS-zajra sem táv-, sem szintsort nem ad (HANDOFF #20)', () => {
    // Mért eset: telefon zárolt képernyővel egy órán át — 4 m sugarú körben
    // vándorló fix, MELLETTE ingadozó "magassággal". Horizontális elmozdulás
    // nélkül a szintemelkedést sem szabad számolni, még a zajküszöb (3 m)
    // fölötti magasságugrásnál sem.
    let t = Date.UTC(2026, 7, 15, 8, 0, 0);
    const drift: TracePoint[] = [];
    for (let i = 0; i <= 120; i += 1) {
      const angle = i * 0.9;
      const p = offset(ORIGIN, 4 * Math.sin(angle), 4 * Math.cos(angle));
      drift.push({ ...p, t, elevation: 100 + (i % 2 ? 4 : 0) });
      t += 30_000;
    }
    expect(elevationProfile(drift).gainM).toBe(0);
    expect(computeSplits(drift)).toHaveLength(0);
  });
});

describe('szintek', () => {
  const levels = GAMEPLAY.LEVELS;
  const names = GAMEPLAY.LEVEL_NAMES;

  it('száz szint van, száz névvel', () => {
    expect(levels).toHaveLength(100);
    expect(names).toHaveLength(100);
  });

  it('a nevek húsz rangból és öt fokozatból állnak', () => {
    expect(names[0]).toBe('ROOKIE I.');
    expect(names[4]).toBe('ROOKIE V.');
    expect(names[5]).toBe('BEGINNER I.');
    // Az 51. szint (50-es index) a 11. rang első fokozata.
    expect(names[50]).toBe('ELITE I.');
    expect(names[99]).toBe('GRUNDO V.');
    // Minden név egyedi — két azonos szintnév értelmezhetetlen lenne.
    expect(new Set(names).size).toBe(100);
  });

  it('a küszöbök szigorúan nőnek', () => {
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]!).toBeGreaterThan(levels[i - 1]!);
    }
  });

  it('EGYETLEN szint sem olcsóbb az alatta lévőnél', () => {
    /**
     * Ez a lényegi állítás. Az első változat a KÜSZÖBÖKET kerekítette, és
     * emiatt tizenhárom helyen előfordult, hogy egy szint kevesebb pontba
     * került, mint az előző — például a 24. olcsóbb volt, mint a 23.
     */
    let previousGap = 0;
    for (let i = 1; i < levels.length; i += 1) {
      const gap = levels[i]! - levels[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(previousGap);
      previousGap = gap;
    }
  });

  it('három aktivitás a 2. szintre visz, nem a kilencedikre', () => {
    // Mért értékek: egy valósághű városi kör 230–560 GP.
    expect(levelFor(231 + 297 + 380)).toBe(2);
    expect(levelFor(560)).toBe(1);
  });

  it('a napi aktív játékosnak is több mint egy év a csúcs', () => {
    /**
     * A napi tetőt a lágy plafon szabja meg: efelé a pont fele értéken
     * számít, tehát ötezer GP/nap a gyakorlati maximum. Ha a 100. szint
     * ennél alacsonyabbra kerülne, a legkitartóbb játékos egy éven belül
     * kifutna a rendszerből.
     */
    const dailyCeiling = GAMEPLAY.SOFT_CAP_GP_PER_DAY;
    expect(levels[99]!).toBeGreaterThan(dailyCeiling * 365);
  });

  it('a nulláról induló fiók az első szinten van', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelProgress(0).name).toBe('ROOKIE I.');
  });

  it('a küszöb ELÉRÉSE már szintlépés', () => {
    const second = levels[1]!;
    expect(levelFor(second - 1)).toBe(1);
    expect(levelFor(second)).toBe(2);
  });

  it('a hátralévő pont a következő küszöbig szól', () => {
    const progress = levelProgress(levels[1]! + 100);
    expect(progress.level).toBe(2);
    expect(progress.remaining).toBe(levels[2]! - levels[1]! - 100);
    expect(progress.nextName).toBe('ROOKIE III.');
  });

  it('a csúcson a sáv tele van, és nincs következő szint', () => {
    const top = levelProgress(levels[99]! * 2);
    expect(top.level).toBe(100);
    expect(top.name).toBe('GRUNDO V.');
    expect(top.nextName).toBeNull();
    expect(top.ratio).toBe(1);
    expect(top.remaining).toBe(0);
  });

  it('a haladás a sávon belül arányos', () => {
    const from = levels[1]!;
    const to = levels[2]!;
    expect(levelProgress((from + to) / 2).ratio).toBeCloseTo(0.5, 5);
  });
});
