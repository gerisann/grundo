import { useEffect, useRef, useState } from 'react';

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
export function useInView<T extends Element>({ rootMargin = '0px', threshold = 0 } = {}) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setInView(true);
        observer.disconnect();
      },
      { rootMargin, threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin, threshold]);

  return { ref, inView };
}
