import { useEffect, useRef, useState } from 'react';

/** Amit a döntéshez az `IntersectionObserverEntry`-ből egyáltalán használunk. */
export interface VisibilitySample {
  isIntersecting: boolean;
  intersectionRatio: number;
  boundingClientRect: { height: number };
  rootBounds: { height: number } | null;
}

/**
 * Elindulhat-e az animáció ettől a jelzéstől?
 *
 * KÜLÖN, TISZTA FÜGGVÉNY, mert a hívó környezetben NEM ellenőrizhető: a
 * böngészőpanel rejtett állapotában az `IntersectionObserver` egyetlen
 * visszahívást sem kézbesít (nincs rajzolási ciklus), tehát a viselkedés csak
 * így mérhető. Ez a projekt visszatérő mérési csapdája — lásd a `HANDOFF.md`
 * vonatkozó szakaszát.
 */
export function shouldActivate(entry: VisibilitySample, whole: boolean): boolean {
  if (!entry.isIntersecting) return false;
  if (!whole) return true;

  /*
    A KÉPERNYŐNÉL MAGASABB elem aránya sosem érheti el az 1-et, tehát a
    szigorú feltétel örökre üres sávot hagyna. Ilyenkor beérjük annyival,
    hogy egyáltalán látszik.
  */
  if (entry.rootBounds !== null && entry.boundingClientRect.height > entry.rootBounds.height) {
    return true;
  }
  // A törtpixeles elrendezés miatt a teljes láthatóság sem mindig pontosan 1.
  return entry.intersectionRatio >= 0.99;
}

/**
 * Igazra billen, amikor az elem először a képernyőre ér — és ott is marad.
 *
 * MIÉRT EGYSZER? Mert belépő animációhoz kell: a sor egyszer úszik be, nem
 * minden görgetésnél újra. Az első találat után a megfigyelő leáll, tehát
 * hosszú listán sem marad futó figyelő minden sorra.
 *
 * ⚠️ HA NINCS `IntersectionObserver`, AZONNAL IGAZ. A hívó oldalon a tartalom
 * jellemzően átlátszóan indul, és ez a jelzés teszi láthatóvá — ha a
 * megfigyelő hiányzik, a tartalomnak akkor is meg kell jelennie, animáció
 * nélkül. Néma eltűnés soha ne legyen a visszaesés.
 */
export function useInView<T extends Element>({
  rootMargin = '0px',
  threshold = 0,
  /**
   * Teljes láthatóságot várunk-e.
   *
   * ⚠️ EZ NEM UGYANAZ, MINT A `threshold: 1`. A `threshold` csak azt szabja
   * meg, MIKOR SZÓL a megfigyelő; az `entry.isIntersecting` viszont már egyetlen
   * átfedő képpontra is igaz. A kettőt összekeverve az animáció akkor indulna,
   * amikor az elem ALJA épp felbukkan a képernyő szélén — pontosan az a hiba,
   * ami miatt a rivális-sávok lefutottak, mire a felhasználó odagörgetett.
   */
  whole = false,
  /**
   * Melyik elemet figyeljük a ref-elt helyett. Egy kártya belsejében ülő
   * animációnál a KÁRTYA láthatósága a kérdés, nem a benne lévő sávé.
   */
  resolveTarget,
}: {
  rootMargin?: string;
  threshold?: number | number[];
  whole?: boolean;
  resolveTarget?: (node: T) => Element;
} = {}) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const target = resolveTarget ? resolveTarget(node) : node;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => shouldActivate(entry, whole))) return;
        setInView(true);
        observer.disconnect();
      },
      { rootMargin, threshold },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [rootMargin, threshold, whole, resolveTarget]);

  return { ref, inView };
}
