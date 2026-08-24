import { useEffect, useState } from 'react';

/**
 * Számok felpörgetése 0-ról a végleges értékre.
 *
 * ⚠️ EGY IDŐZÍTŐ, TÖBB SZÁM. A hook nem egy értéket ad vissza, hanem egy
 * SKÁLÁZÓ FÜGGVÉNYT: `countUp(12)`. Így egy sorban a három szám (összecsapás,
 * szerzett, vesztett) egyetlen `requestAnimationFrame` ciklusból és egyetlen
 * állapotfrissítésből él. Számonkénti hookkal egy tizenöt soros lista
 * negyvenöt párhuzamos ciklust és képkockánként negyvenöt újrarajzolást
 * jelentene — pont a görgetés közben, amikor a legkevésbé fér bele.
 *
 * ⚠️ AZ `enabled` KAPCSOLÓ, NEM INDÍTÓ. Amíg hamis, a skálázó a valódi értéket
 * adja vissza — a szám tehát mindig helyes, akkor is, ha animáció sosem indul.
 * A hívó akkor billenti át, amikor az elem a képernyőre ér.
 *
 * Csökkentett mozgásigény esetén nincs pörgetés: a végleges szám áll ott.
 */
export function useCountUp({
  enabled = true,
  duration = 720,
  delay = 0,
}: { enabled?: boolean; duration?: number; delay?: number } = {}) {
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    if (!enabled) {
      setProgress(1);
      return;
    }
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || duration <= 0) {
      setProgress(1);
      return;
    }

    setProgress(0);
    let frame = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now;
      const elapsed = now - start - delay;
      if (elapsed < 0) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const ratio = Math.min(1, elapsed / duration);
      // easeOutCubic: gyors indulás, lágy megállás — a pörgés így „lefékez”
      // a végleges számnál ahelyett, hogy egyszerűen elvágódna.
      setProgress(1 - (1 - ratio) ** 3);
      if (ratio < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled, duration, delay]);

  return (value: number) => Math.round(value * progress);
}
