/**
 * Képernyő ébren tartása rögzítés közben.
 *
 * Ez nem kényelmi funkció, hanem a webes rögzítés működésének FELTÉTELE: ha a
 * képernyő elalszik, az oldal nem látható, és a `watchPosition` elhallgat.
 *
 * Amit NEM old meg: ha a felhasználó másik appra vált (pl. zenét indít), a
 * rögzítés akkor is megszakad. Erre a webnek nincs eszköze.
 *
 * A zárat a böngésző magától elengedi, amikor a lap háttérbe kerül, és NEM
 * adja vissza magától, amikor visszatér. Ezért figyeljük a láthatóságot és
 * kérjük újra — enélkül egy pillanatnyi appváltás után a képernyő a következő
 * időzítéskor elaludna.
 */

export interface WakeLock {
  /** Igaz, ha a zárat sikerült megszerezni. */
  readonly active: boolean;
  release(): Promise<void>;
}

export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

/**
 * @param onChange értesítés MINDEN állapotváltozásról.
 *
 * ⚠️ EZ NEM KÉNYELMI VISSZAHÍVÁS. A `active` mező menet közben változik: a
 * böngésző háttérbe kerüléskor magától elengedi a zárat, visszatéréskor
 * pedig mi kérjük újra. A hívó (`useRecorder`) korábban EGYSZER, a
 * megszerzés pillanatában olvasta ki az értéket egy React-állapotba — így a
 * rögzítés képernyője a futás végéig azt állította, amit az első
 * másodpercben látott. Egy elvesztett zárnál („a képernyőt ébren tartjuk")
 * ez pont a legrosszabbkor hazudik: a felhasználó nem tudja meg, hogy a
 * mérése bármelyik pillanatban megszakadhat.
 */
export async function requestWakeLock(
  onChange?: (active: boolean) => void,
): Promise<WakeLock> {
  if (!wakeLockSupported()) {
    onChange?.(false);
    return { active: false, async release() {} };
  }

  let sentinel: WakeLockSentinel | null = null;
  let released = false;

  const notify = () => onChange?.(sentinel !== null);

  const acquire = async () => {
    if (released || sentinel !== null) return;
    try {
      const next = await navigator.wakeLock.request('screen');
      if (released) {
        // A megszerzés alatt elengedték a zárat — nem hagyhatjuk bent.
        await next.release().catch(() => undefined);
        return;
      }
      sentinel = next;
      /**
       * A böngésző MAGÁTÓL is elengedheti (háttérbe kerülés, alacsony
       * töltöttség). Enélkül az `active` továbbra is igazat mondana egy
       * olyan zárra, ami már nem létezik.
       */
      next.addEventListener('release', () => {
        if (sentinel === next) sentinel = null;
        notify();
      });
    } catch {
      // Megtagadható: alacsony töltöttség, energiatakarékos mód, vagy a lap
      // épp nem látható. Nem hiba — a rögzítés fut tovább, csak a képernyő
      // elalhat. A felület ezt külön jelzi.
      sentinel = null;
    }
    notify();
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void acquire();
  };

  await acquire();
  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    get active() {
      return sentinel !== null;
    },
    async release() {
      released = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      const held = sentinel;
      sentinel = null;
      try {
        await held?.release();
      } catch {
        /* már elengedve — nincs teendő */
      }
      notify();
    },
  };
}
