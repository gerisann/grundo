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
import { isNativeAndroid, isNativeApp, isNativeIos } from './platform';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

let messagingInstance: Messaging | null | undefined;
let nativeTokenListener: { remove: () => Promise<void> } | null = null;
let nativeTokenListenerUid: string | null = null;

const NATIVE_TOKEN_STORAGE_KEY = 'grundo.nativeFcmToken';
const PUSH_ENABLED_STORAGE_KEY = 'grundo.pushEnabled';

/** `undefined` = még nem próbáltuk; `null` = nem támogatott ezen a böngészőn/eszközön. */
async function getMessagingIfSupported(): Promise<Messaging | null> {
  if (messagingInstance !== undefined) return messagingInstance;
  // A webes FCM service workerre épül, a natív push pedig a Capacitor
  // Firebase Messaging pluginre. Natív WebView-ban ezért soha ne próbáljunk
  // böngészős service workert vagy Notification API-t használni.
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

type PushPlatform = 'web' | 'ios' | 'android';

function nativePushPlatform(): Exclude<PushPlatform, 'web'> | null {
  if (isNativeIos()) return 'ios';
  if (isNativeAndroid()) return 'android';
  return null;
}

async function saveToken(uid: string, token: string, platform: PushPlatform): Promise<void> {
  if (!db) return;
  await setDoc(
    doc(db, 'devices', uid, 'tokens', token),
    { platform, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

function storedNativeToken(): string | null {
  try {
    return localStorage.getItem(NATIVE_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeNativeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(NATIVE_TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(NATIVE_TOKEN_STORAGE_KEY);
  } catch {
    // A Firestore-be írt token marad a hiteles forrás; a localStorage csak a
    // régi token takarítását segítő gyorsítótár.
  }
}

function pushEnabledOnThisDevice(): boolean {
  try {
    return localStorage.getItem(PUSH_ENABLED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function setPushEnabledOnThisDevice(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(PUSH_ENABLED_STORAGE_KEY, '1');
    else localStorage.removeItem(PUSH_ENABLED_STORAGE_KEY);
  } catch {
    // Az engedély ettől még működhet az aktuális futásban. A tartós kapcsoló
    // csak azt akadályozza meg, hogy egy tudatos leiratkozást indításkor
    // véletlenül visszakapcsoljunk.
  }
}

async function replaceNativeToken(uid: string, token: string): Promise<void> {
  const platform = nativePushPlatform();
  if (!platform) return;
  const previous = storedNativeToken();
  if (previous && previous !== token && db) {
    await deleteDoc(doc(db, 'devices', uid, 'tokens', previous)).catch(() => {});
  }
  await saveToken(uid, token, platform);
  storeNativeToken(token);
}

async function ensureNativeTokenListener(uid: string): Promise<void> {
  if (!nativePushPlatform()) return;
  if (nativeTokenListener && nativeTokenListenerUid === uid) return;
  await nativeTokenListener?.remove().catch(() => {});

  const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
  nativeTokenListenerUid = uid;
  nativeTokenListener = await FirebaseMessaging.addListener('tokenReceived', ({ token }) => {
    void replaceNativeToken(uid, token).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[GRUNDO] az új natív FCM token mentése elhasalt', error);
    });
  });
}

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export function currentPushPermission(): PushPermission {
  // A natív engedély aszinkron kérdezhető le. Az első renderen ezért nem
  // tiltjuk le a kapcsolót; a `readPushPermission` rögtön pontosítja.
  if (nativePushPlatform()) return 'default';
  if (isNativeApp() || typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted' && !pushEnabledOnThisDevice()) return 'default';
  return Notification.permission;
}

export async function readPushPermission(): Promise<PushPermission> {
  if (!nativePushPlatform()) return currentPushPermission();
  try {
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    const support = await FirebaseMessaging.isSupported();
    if (!support.isSupported) return 'unsupported';
    const permission = await FirebaseMessaging.checkPermissions();
    if (permission.receive === 'granted') {
      return pushEnabledOnThisDevice() ? 'granted' : 'default';
    }
    if (permission.receive === 'denied') return 'denied';
    return 'default';
  } catch {
    return 'unsupported';
  }
}

/**
 * Felhasználói gesztusra hívd (pl. egy kapcsoló bekapcsolásakor).
 *
 * MINDEN sikertelen ág MEGNEVEZETT okot ad vissza — lásd a `PushFailure`
 * fölötti magyarázatot arról, miért nem elég egy `false`.
 */
export async function requestPermissionAndSubscribe(uid: string): Promise<PushResult> {
  if (nativePushPlatform()) {
    try {
      const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
      const support = await FirebaseMessaging.isSupported();
      if (!support.isSupported) return { ok: false, reason: 'unsupported' };

      const permission = await FirebaseMessaging.requestPermissions();
      if (permission.receive !== 'granted') {
        return { ok: false, reason: 'permission_denied' };
      }

      await ensureNativeTokenListener(uid);
      const { token } = await FirebaseMessaging.getToken();
      if (!token) return { ok: false, reason: 'token_failed' };
      await replaceNativeToken(uid, token);
      setPushEnabledOnThisDevice(true);
      return { ok: true };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[GRUNDO] natív FCM regisztráció elhasalt', error);
      return { ok: false, reason: 'token_failed' };
    }
  }

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

  await saveToken(uid, token, 'web');
  setPushEnabledOnThisDevice(true);
  return { ok: true };
}

/** Passzív út: csak akkor frissít, ha az engedély MÁR megvan — app-indításkor hívható. */
export async function initIfAlreadyGranted(uid: string): Promise<void> {
  if ((await readPushPermission()) !== 'granted') return;
  await requestPermissionAndSubscribe(uid);
}

/** Leiratkozás — a tokent TÖRÖLJÜK, nem csak inaktívra állítjuk. */
export async function unsubscribe(uid: string): Promise<void> {
  if (nativePushPlatform()) {
    const token = storedNativeToken();
    if (token && db) {
      await deleteDoc(doc(db, 'devices', uid, 'tokens', token)).catch(() => {});
    }
    storeNativeToken(null);
    setPushEnabledOnThisDevice(false);
    await nativeTokenListener?.remove().catch(() => {});
    nativeTokenListener = null;
    nativeTokenListenerUid = null;
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    await FirebaseMessaging.deleteToken().catch(() => {});
    return;
  }

  const messaging = await getMessagingIfSupported();
  if (!messaging || !db) return;
  const registration = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration ?? undefined,
  }).catch(() => null);
  if (token) await deleteDoc(doc(db, 'devices', uid, 'tokens', token)).catch(() => {});
  setPushEnabledOnThisDevice(false);
}

/** A natív értesítés adatmezőiből belső GRUNDO útvonalat képez. */
export function pathFromPushData(data: Record<string, unknown>): string {
  const activityId = typeof data.activityId === 'string' ? data.activityId : '';
  const username = typeof data.username === 'string' ? data.username : '';
  const bandaId = typeof data.bandaId === 'string' ? data.bandaId : '';
  const screen = typeof data.screen === 'string' ? data.screen : '';
  const type = typeof data.type === 'string' ? data.type : '';

  if (activityId) return `/aktivitas/${encodeURIComponent(activityId)}`;
  if (username) return `/felhasznalo/${encodeURIComponent(username)}`;
  if (bandaId) return `/bandak/${encodeURIComponent(bandaId)}`;

  const byScreen: Record<string, string> = {
    activity: '/',
    profile: '/profil',
    territory: '/grund',
    rules: '/beallitasok/szabalyok',
    missions: '/kuldetesek',
    community: '/kozosseg',
  };
  if (byScreen[screen]) return byScreen[screen]!;
  if (type === 'territory_stolen' || type === 'territory_defended') return '/grund';
  return '/';
}

/**
 * Natív értesítésre koppintva a React Routerhez adja át a célútvonalat.
 * Weben nincs teendő: ott a service worker `link` mezője nyitja meg az oldalt.
 */
export async function addNativePushActionListener(
  navigate: (path: string) => void,
): Promise<() => void> {
  if (!nativePushPlatform()) return () => {};
  const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
  const listener = await FirebaseMessaging.addListener(
    'notificationActionPerformed',
    ({ notification }) => navigate(
      pathFromPushData((notification.data ?? {}) as Record<string, unknown>),
    ),
  );
  return () => {
    void listener.remove();
  };
}
