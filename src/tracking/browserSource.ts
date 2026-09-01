/**
 * Pozíció a böngésző Geolocation API-jából.
 *
 * KORLÁT, amit nem lehet megkerülni: ez a forrás csak addig mér, amíg az
 * oldal LÁTHATÓ. Ha a felhasználó lezárja a telefont vagy másik appra vált,
 * a `watchPosition` elhallgat — iOS-en azonnal, Androidon fojtottan, majd
 * szintén. Sem a Service Worker, sem a Web Worker nem segít: helymeghatározás
 * egyikből sem indítható.
 *
 * Ezért jár mellé a `wakeLock` (ébren tartott képernyő), és ezért lesz
 * egyszer natív burok. Addig a felületnek MEG KELL MONDANIA a felhasználónak,
 * hogy a képernyőt hagyja bekapcsolva — a csendben elvesző futás rosszabb,
 * mint az őszinte figyelmeztetés.
 *
 * ── ŐRKUTYA (2026-09-01) ─────────────────────────────────────────────────
 *
 * Amit a fenti korlát NEM mond ki: a `watchPosition` vissza is TÉRHET
 * némán. iOS Safariban (és Androidon energiatakarékos módban) előfordul,
 * hogy a lap előtérbe kerül, a figyelés viszont nem indul újra magától — se
 * minta, se hibaesemény. Ilyenkor a rögzítés a felületen továbbra is „fut",
 * a nyomvonal viszont egy pontból áll, és ez csak a mentésnél derül ki.
 *
 * Ezért a forrás figyeli, mikor hallott UTOLJÁRA bármit (mintát VAGY hibát),
 * és ha `SILENCE_LIMIT_MS`-nél régebben, újraindítja a figyelést. A hiba is
 * életjel: a `timeout` hibát a böngésző félpercenként küldi alagútban, és az
 * bizonyítja, hogy a figyelés él.
 */

import type { ActivityType } from '@/types';
import {
  TrackingError,
  type PositionActivityState,
  type PositionHandlers,
  type PositionSample,
  type PositionSource,
} from './types';

const OPTIONS: PositionOptions = {
  // Nélküle a böngésző hálózat-alapú, több száz méteres becslést is adhat,
  // ami a hexagonrácson használhatatlan.
  enableHighAccuracy: true,
  // Ne adjon vissza gyorsítótárazott fixet: minden mintának frissnek kell
  // lennie, különben álló pontokból „mozgás" lesz.
  maximumAge: 0,
  // Ennyi után hibát jelez, de a figyelés folytatódik. Alagútban, mélygarázsban
  // ez normális — a felület jelezze, de ne állítsa le a rögzítést.
  timeout: 30_000,
};

/**
 * Ennyi teljes csend után indítjuk újra a figyelést.
 *
 * Magasabb, mint az `OPTIONS.timeout` (30 s), és magasabb, mint a
 * `FILTER.MAX_GAP_MS`: egy élő, de jelet nem találó figyelés félpercenként
 * hibát küld, tehát sosem hallgat 45 másodpercig. Aki mégis, az halott.
 */
export const SILENCE_LIMIT_MS = 45_000;

/** Ilyen sűrűn nézzük meg, hallottunk-e valamit. */
const WATCHDOG_TICK_MS = 10_000;

/**
 * Újra kell-e indítani a figyelést? TISZTA FÜGGVÉNY — az időzítéstől külön,
 * hogy tesztelhető legyen az a viselkedés, amit valós terepen napokig
 * tartana reprodukálni.
 *
 * @param lastSignalAt az utolsó minta VAGY hiba ideje (0 = még semmi)
 * @param startedAt    mikor indult a jelenlegi figyelés
 * @param visible      látható-e a lap (rejtett lapon a csend természetes)
 */
export function shouldRestartWatch(
  lastSignalAt: number,
  startedAt: number,
  now: number,
  visible: boolean,
): boolean {
  // Rejtett lapon a böngésző SZÁNDÉKOSAN hallgat. Újraindítani értelmetlen
  // (ugyanúgy fojtaná), és csak az akkumulátort enné.
  if (!visible) return false;
  // Amíg egyetlen jel sem jött, az indítás óta eltelt idő számít — enélkül a
  // legelső, jel nélküli indulás azonnal újraindítást kérne.
  const since = lastSignalAt > 0 ? lastSignalAt : startedAt;
  return now - since >= SILENCE_LIMIT_MS;
}

export class BrowserPositionSource implements PositionSource {
  readonly name = 'browser';
  readonly supportsBackground = false;
  readonly ordered = true;

  private watchId: number | null = null;
  private handlers: PositionHandlers | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private visibilityListener: (() => void) | null = null;
  private lastSignalAt = 0;
  private watchStartedAt = 0;

  async start(
    handlers: PositionHandlers,
    _activityType?: ActivityType,
    _activityState?: PositionActivityState,
  ): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      throw new TrackingError('unsupported', 'Ez a böngésző nem tud helymeghatározást.');
    }

    // A böngészők csak biztonságos eredeten adnak helyet. Ezt előre
    // megmondjuk, mert a natív hibaüzenet ilyenkor „permission denied", ami
    // félrevisz: a felhasználó hiába engedélyezi újra.
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      throw new TrackingError(
        'insecure_context',
        'A helymeghatározáshoz biztonságos kapcsolat (https) kell.',
      );
    }

    this.stop();
    this.handlers = handlers;
    this.beginWatch();

    this.watchdog = setInterval(() => this.checkWatch(), WATCHDOG_TICK_MS);

    /**
     * Előtérbe visszatéréskor AZONNAL ellenőrzünk, nem várunk a következő
     * ütemre. Pont ez a pillanat a kockázatos: a lap most kapja vissza a
     * jogot a mérésre, és ha a figyelés közben elhalt, minden itt töltött
     * másodperc valódi lyuk a nyomvonalban.
     */
    this.visibilityListener = () => {
      if (document.visibilityState !== 'visible') return;
      this.checkWatch();
    };
    document.addEventListener('visibilitychange', this.visibilityListener);
  }

  stop(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.watchdog !== null) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    if (this.visibilityListener !== null) {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }
    this.handlers = null;
    this.lastSignalAt = 0;
    this.watchStartedAt = 0;
  }

  private beginWatch(): void {
    const handlers = this.handlers;
    if (handlers === null) return;

    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchStartedAt = Date.now();

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        this.lastSignalAt = Date.now();
        handlers.onSample(toSample(position));
      },
      (error) => {
        // A HIBA IS ÉLETJEL: azt bizonyítja, hogy a figyelés fut. Csak a
        // teljes csend gyanús.
        this.lastSignalAt = Date.now();
        handlers.onError(toTrackingError(error));
      },
      OPTIONS,
    );
  }

  private checkWatch(): void {
    if (this.handlers === null || this.watchId === null) return;
    const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
    if (!shouldRestartWatch(this.lastSignalAt, this.watchStartedAt, Date.now(), visible)) return;
    this.beginWatch();
  }
}

function toSample(position: GeolocationPosition): PositionSample {
  const c = position.coords;
  return {
    lat: c.latitude,
    lng: c.longitude,
    // A `position.timestamp` az eszköz órája. Nem javítjuk: a nyomvonalon
    // belüli KÜLÖNBSÉGEK számítanak, azokat pedig az óra eltolása nem érinti.
    t: position.timestamp,
    // Az `accuracy` a szabvány szerint mindig van, de a valóságban láttunk
    // már null-t adó megvalósítást. Ilyenkor a szűrő elutasítja — helyesen,
    // mert nem tudjuk megítélni a fix minőségét.
    accuracy: c.accuracy,
    ...(c.altitude !== null ? { elevation: c.altitude } : {}),
    ...(c.speed !== null ? { speed: c.speed } : {}),
  };
}

function toTrackingError(error: GeolocationPositionError): TrackingError {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return new TrackingError(
        'permission_denied',
        'Nincs helyhozzáférés. Engedélyezd a böngésző beállításaiban.',
      );
    case error.POSITION_UNAVAILABLE:
      return new TrackingError(
        'unavailable',
        'Most nincs GPS-jel. Menj szabad ég alá, és próbáld újra.',
      );
    case error.TIMEOUT:
      return new TrackingError('timeout', 'Nem érkezett helyadat. Keressük a jelet…');
    default:
      return new TrackingError('unavailable', 'A helymeghatározás nem sikerült.');
  }
}
