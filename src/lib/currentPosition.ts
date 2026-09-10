/**
 * Egyszeri helyzetlekérdezés — EGY belépési pont az egész alkalmazásnak.
 *
 * ⚠️ NATÍV APPBAN A `navigator.geolocation` TILOS. Mérve (iPhone,
 * 2026-09-09): a WebView geolocation API-ja KÉT rendszerablakot hoz fel
 * egymás után.
 *
 * 1. a CoreLocation kérdése, a rendszer folyamatából, a készülék nyelvén —
 *    ez a rendes, várt engedélykérés;
 * 2. a WebKit SAJÁT, oldal-szintű engedélykérése, amit a WebKit a mi
 *    processzünkben rajzol. Ezért ANGOL (az app bundle-ben nincs magyar
 *    lokalizáció, a `CFBundleDevelopmentRegion` `en`), és ezért hivatkozik
 *    a `localhost` névre (`capacitor.config.ts` → `server.hostname`).
 *
 * A második kérdés a felhasználónak érthetetlen és gyanús — Geri
 * visszajelzése szerint pont az a pillanat, amikor a „Don't Allow"-ra
 * nyomna. A natív plugin egyszeri fixe ugyanazt adja weboldal nélkül, tehát
 * második kérdés nélkül is.
 *
 * ⚠️ Aki új helyzetlekérdezést ír, EZT hívja. Egyetlen közvetlen
 * `navigator.geolocation` hívás visszahozza az angol ablakot az egész
 * appban.
 *
 * ⚠️ Ez NEM a mérés útja. A rögzítés a `src/tracking/` forrásain megy
 * (natívan folyamatos, sorba tett pontokkal) — ez itt egyszeri fix a
 * térkép középre igazításához, a helyi hírfolyamhoz és az időjáráshoz.
 */

import { isNativeApp } from '@/lib/platform';
import { nativeCurrentPosition } from '@/tracking/nativeSource';

export interface CurrentFix {
  lat: number;
  lng: number;
  /** Vízszintes pontosság méterben. Kisebb = jobb. */
  accuracyM: number;
  /** Unix ms. */
  at: number;
}

export interface CurrentPositionOptions {
  /** Bekapcsolja a GPS-t. Városnyi pontossághoz (időjárás, helyi feed) nem kell. */
  highAccuracy?: boolean;
  timeoutMs?: number;
  /** Ennél frissebb, gyorsítótárazott fix elfogadható. */
  maxAgeMs?: number;
}

export class PositionUnavailableError extends Error {}

async function nativePositionWithTimeout(timeoutMs: number): Promise<CurrentFix> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      nativeCurrentPosition(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new PositionUnavailableError('Nem érkezett helyadat. Ellenőrizd, hogy a helymeghatározás be van-e kapcsolva.')),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof PositionUnavailableError) throw error;
    throw new PositionUnavailableError(
      error instanceof Error && error.message ? error.message : 'Nem sikerült helyzetet mérni.',
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * A jelenlegi helyzet, vagy hiba.
 *
 * A hívó dolga eldönteni, mit jelent a hiba a felületén — van, ahol
 * „nem engedélyezted", van, ahol egyszerűen nincs helyi tartalom.
 */
export async function currentPosition(options: CurrentPositionOptions = {}): Promise<CurrentFix> {
  /*
   * A Capacitor plugin ígérete platformhibánál nyitva maradhat. Böngészőben
   * maga a Geolocation API kezeli a timeoutot, natívban nekünk kell ugyanazt
   * a szerződést garantálnunk, különben a hívó felülete örökké tölt.
   */
  if (isNativeApp()) return nativePositionWithTimeout(options.timeoutMs ?? 10_000);

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new PositionUnavailableError('Ez a böngésző nem tud helyet meghatározni.');
  }

  return new Promise<CurrentFix>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (fix) =>
        resolve({
          lat: fix.coords.latitude,
          lng: fix.coords.longitude,
          accuracyM: Number.isFinite(fix.coords.accuracy) ? fix.coords.accuracy : 99_999,
          at: fix.timestamp || Date.now(),
        }),
      (error) => reject(new PositionUnavailableError(error.message || 'Nincs helyzet.')),
      {
        enableHighAccuracy: options.highAccuracy ?? false,
        timeout: options.timeoutMs ?? 10_000,
        maximumAge: options.maxAgeMs ?? 300_000,
      },
    );
  });
}
