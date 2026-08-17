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

export async function requestWakeLock(): Promise<WakeLock> {
  if (!wakeLockSupported()) {
    return { active: false, async release() {} };
  }

  let sentinel: WakeLockSentinel | null = null;
  let released = false;

  const acquire = async () => {
    if (released) return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
    } catch {
      // Megtagadható: alacsony töltöttség, energiatakarékos mód, vagy a lap
      // épp nem látható. Nem hiba — a rögzítés fut tovább, csak a képernyő
      // elalhat. A felület ezt külön jelzi.
      sentinel = null;
    }
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
      try {
        await sentinel?.release();
      } catch {
        /* már elengedve — nincs teendő */
      }
      sentinel = null;
    },
  };
}
