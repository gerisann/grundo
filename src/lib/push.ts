/**
 * Push-értesítés (FCM) — engedélykérés, eszköz-token regisztráció.
 *
 * A TOKEN A FIRESTORE-BA KÖZVETLENÜL a klienstől kerül, nem a szerveren
 * keresztül — a `firestore.rules` a `devices/{uid}/tokens/{token}` alatt
 * kifejezetten ezért engedi a kliens írását
 * (`match /devices/{uid}/tokens/{token} { allow write: if isSelf(uid); }`,
 * a docs/05 megjegyzése is ezt mondja: „FCM token regisztráció"). A
 * KÜLDÉS viszont a szerveren van (`server/src/lib/notifications.ts`), mert
 * ahhoz a Firebase Admin SDK kell.
 *
 * ⚠️ NEM KÉR ENGEDÉLYT MAGÁTÓL. Csak felhasználói gesztusra hívd
 * (`requestPermissionAndSubscribe`) — egy váratlan böngésző-engedélykérés
 * ugyanolyan bizalomvesztést okozna, mint a helyzet-engedély a
 * WeatherWidgetnél (lásd ott a fejlécet). A `initIfAlreadyGranted` a
 * passzív út: csak akkor frissíti a tokent, ha MÁR engedélyezve van.
 */

import { doc, serverTimestamp, setDoc, deleteDoc } from 'firebase/firestore';
import { getMessaging, getToken, isSupported, type Messaging } from 'firebase/messaging';
import { app, db } from './firebase';
import { isNativeApp } from './platform';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

let messagingInstance: Messaging | null | undefined;

/** `undefined` = még nem próbáltuk; `null` = nem támogatott ezen a böngészőn/eszközön. */
async function getMessagingIfSupported(): Promise<Messaging | null> {
  if (messagingInstance !== undefined) return messagingInstance;
  // A jelenlegi FCM implementáció webes service workerre épül. A natív push
  // külön APNs + Capacitor plugin bevezetést igényel; addig ne kérjen hibásan
  // böngészős értesítési engedélyt a WKWebView.
  if (
    isNativeApp() ||
    !app ||
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    messagingInstance = null;
    return null;
  }
  messagingInstance = (await isSupported()) ? getMessaging(app) : null;
  return messagingInstance;
}

/**
 * A regisztráció hibája NEM némán vész el.
 *
 * Mérve, éles használatban: a push bekapcsolása egyetlen általános
 * „nem sikerült" üzenettel hasalt el, amiből semmi nem derült ki. A leggyakoribb
 * ok az, hogy a `VITE_FIREBASE_VAPID_KEY` hiányzik a TELEPÍTETT buildből (a
 * helyi `.env.local`-ban ott van, a Cloud Shell-másolatban nem) — ezt a
 * felhasználó sosem találná ki. Innentől minden ág saját, megnevezett okot ad.
 */
export type PushFailure =
  | 'no_vapid_key'
  | 'unsupported'
  | 'permission_denied'
  | 'sw_failed'
  | 'token_failed';

export type PushResult = { ok: true } | { ok: false; reason: PushFailure };

async function registerServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  try {
    return await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  } catch {
    return undefined;
  }
}

async function saveToken(uid: string, token: string): Promise<void> {
  if (!db) return;
  await setDoc(
    doc(db, 'devices', uid, 'tokens', token),
    { platform: 'web', updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export function currentPushPermission(): PushPermission {
  if (isNativeApp() || typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/**
 * Felhasználói gesztusra hívd (pl. egy kapcsoló bekapcsolásakor).
 *
 * MINDEN sikertelen ág MEGNEVEZETT okot ad vissza — lásd a `PushFailure`
 * fölötti magyarázatot arról, miért nem elég egy `false`.
 */
export async function requestPermissionAndSubscribe(uid: string): Promise<PushResult> {
  /**
   * A VAPID-kulcs hiánya KÜLÖN ág, és ez az ELSŐ ellenőrzés.
   *
   * Ez a build konfigurációjának hibája, nem a felhasználóé vagy a böngészőé
   * — összemosva a „nem támogatott" ággal a hibakeresés a rossz irányba
   * indulna (böngésző/eszköz helyett a telepítést kell megnézni).
   */
  if (!VAPID_KEY) return { ok: false, reason: 'no_vapid_key' };

  const messaging = await getMessagingIfSupported();
  if (!messaging) return { ok: false, reason: 'unsupported' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'permission_denied' };

  const registration = await registerServiceWorker();
  if (!registration) return { ok: false, reason: 'sw_failed' };

  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  }).catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[GRUNDO] FCM token kérése elhasalt', error);
    return null;
  });
  if (!token) return { ok: false, reason: 'token_failed' };

  await saveToken(uid, token);
  return { ok: true };
}

/** Passzív út: csak akkor frissít, ha az engedély MÁR megvan — app-indításkor hívható. */
export async function initIfAlreadyGranted(uid: string): Promise<void> {
  if (currentPushPermission() !== 'granted') return;
  await requestPermissionAndSubscribe(uid);
}

/** Leiratkozás — a tokent TÖRÖLJÜK, nem csak inaktívra állítjuk. */
export async function unsubscribe(uid: string): Promise<void> {
  const messaging = await getMessagingIfSupported();
  if (!messaging || !db) return;
  const registration = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration ?? undefined,
  }).catch(() => null);
  if (token) await deleteDoc(doc(db, 'devices', uid, 'tokens', token)).catch(() => {});
}
