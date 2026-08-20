/**
 * FCM háttér-üzenetkezelő — a böngésző service workerként tölti be.
 *
 * EZ A FÁJL NEM MEGY ÁT A VITE ÉPÍTÉSEN. A `public/` mappa tartalma
 * változatlanul kerül a kiszolgált gyökérbe, tehát ez a fájl mindig
 * `/firebase-messaging-sw.js` címen érhető el — a Firebase SDK ezt a
 * pontos elérési utat várja.
 *
 * A konfiguráció SZÁNDÉKOSAN itt van beégetve, nem `import.meta.env`-ből
 * jön: a service worker a Vite modulrendszerén KÍVÜL fut, tehát nincs
 * build-idejű változó-behelyettesítés. Az itt szereplő értékek egyike sem
 * titok — ugyanezek a `VITE_FIREBASE_*` változók a kiszolgált JS-bundle-be
 * is belekerülnek (lásd .env.example fejléce).
 */

importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCKa86mPUV1AXDRnSc_duZoOYlnFxGcT6w',
  authDomain: 'grundo.firebaseapp.com',
  projectId: 'grundo',
  storageBucket: 'grundo.firebasestorage.app',
  messagingSenderId: '65689674957',
  appId: '1:65689674957:web:1e5550ab3562d31aa13584',
});

const messaging = firebase.messaging();

/**
 * Csak akkor mutatunk rendszerértesítést, ha az app épp NINCS nyitva
 * látható lapon — ha nyitva van, a `NotificationPanel` élő feliratkozása
 * (`onSnapshot`) úgyis frissül, egy plusz rendszerértesítés csak zajongana.
 */
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title ?? payload.data?.title ?? 'GRUNDO';
  const body = payload.notification?.body ?? payload.data?.body ?? '';

  self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    data: payload.data ?? {},
  });
});

/** Koppintásra a megfelelő képernyőre navigál, ha van már nyitott lap. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    }),
  );
});
