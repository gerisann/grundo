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
 */

import {
  TrackingError,
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

export class BrowserPositionSource implements PositionSource {
  readonly name = 'browser';
  readonly supportsBackground = false;
  readonly ordered = true;

  private watchId: number | null = null;

  async start(handlers: PositionHandlers): Promise<void> {
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

    this.watchId = navigator.geolocation.watchPosition(
      (position) => handlers.onSample(toSample(position)),
      (error) => handlers.onError(toTrackingError(error)),
      OPTIONS,
    );
  }

  stop(): void {
    if (this.watchId === null) return;
    navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
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
