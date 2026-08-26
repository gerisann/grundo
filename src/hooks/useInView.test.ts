import { describe, expect, it } from 'vitest';
import { shouldActivate, type VisibilitySample } from './useInView';

/**
 * A belépő animációk indítási feltétele.
 *
 * ⚠️ MIÉRT KELL EZ TESZTBEN? Mert böngészőben NEM ellenőrizhető: a fejlesztői
 * böngészőpanel rejtett állapotában az `IntersectionObserver` egyetlen
 * visszahívást sem kézbesít, tehát ott minden feltétel „működni látszik" —
 * pontosan úgy, ahogy a hibás is. A projekt visszatérő mérési csapdája.
 *
 * Amit rögzít: a rivális-sávok animációja CSAK teljesen látható kártyán
 * induljon el. Geri konkrét panasza (2026-08-26): előretöltődtek, ezért mire
 * odagörgetett, már lefutottak, és csak kész, mozdulatlan sávokat talált.
 */

const minta = (over: Partial<VisibilitySample> = {}): VisibilitySample => ({
  isIntersecting: true,
  intersectionRatio: 1,
  boundingClientRect: { height: 400 },
  rootBounds: { height: 800 },
  ...over,
});

describe('shouldActivate', () => {
  it('nem indul, amíg egyáltalán nem látszik', () => {
    expect(shouldActivate(minta({ isIntersecting: false, intersectionRatio: 0 }), true)).toBe(false);
  });

  /**
   * A LÉNYEGI eset. Az `isIntersecting` egyetlen átfedő képpontra is igaz,
   * tehát önmagában pont azt a korai indulást engedné, amit meg akarunk
   * szüntetni. Ha valaki visszaírja `isIntersecting`-re, ez a teszt bukik.
   */
  it('nem indul részleges láthatóságnál, hiába „metsz"', () => {
    expect(shouldActivate(minta({ intersectionRatio: 0.85 }), true)).toBe(false);
    expect(shouldActivate(minta({ intersectionRatio: 0.5 }), true)).toBe(false);
  });

  it('elindul, amikor a kártya teljesen látszik', () => {
    expect(shouldActivate(minta({ intersectionRatio: 1 }), true)).toBe(true);
  });

  /** A törtpixeles elrendezés miatt a „teljes" sem mindig pontosan 1. */
  it('a törtpixeles majdnem-egészet is elfogadja', () => {
    expect(shouldActivate(minta({ intersectionRatio: 0.995 }), true)).toBe(true);
  });

  /**
   * Enélkül egy a képernyőnél magasabb kártya animációja SOHA nem indulna el:
   * az aránya definíció szerint nem érheti el az 1-et. A felhasználó örökre
   * üres sávot látna — rosszabbat, mint a korai indulás.
   */
  it('a képernyőnél magasabb kártyán részleges láthatóságnál is elindul', () => {
    const magas = minta({
      intersectionRatio: 0.6,
      boundingClientRect: { height: 1200 },
      rootBounds: { height: 800 },
    });
    expect(shouldActivate(magas, true)).toBe(true);
  });

  it('`whole` nélkül a régi, megengedő viselkedés marad', () => {
    expect(shouldActivate(minta({ intersectionRatio: 0.01 }), false)).toBe(true);
  });
});
