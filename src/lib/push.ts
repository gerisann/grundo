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

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

let messagingInstance: Messaging | null | undefined;

/** `undefined` = még nem próbáltuk; `null` = nem támogatott ezen a böngészőn/eszközön. */
async function getMessagingIfSupported(): Promise<Messaging | null> {
  if (messagingInstance !== undefined) return messagingInstance;
  if (!app || !VAPID_KEY || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    messagingInstance = null;
    return null;
  }
  messagingInstance = (await isSupported()) ? getMessaging(app) : null;
  return messagingInstance;
}

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
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/**
 * Felhasználói gesztusra hívd (pl. egy kapcsoló bekapcsolásakor).
 *
 * @returns `true`, ha a token sikeresen regisztrálódott.
 */
export async function requestPermissionAndSubscribe(uid: string): Promise<boolean> {
  const messaging = await getMessagingIfSupported();
  if (!messaging) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const registration = await registerServiceWorker();
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  }).catch(() => null);
  if (!token) return false;

  await saveToken(uid, token);
  return true;
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
