import type { CapacitorConfig } from '@capacitor/cli';
import type {} from '@capacitor-firebase/authentication';
import type {} from '@capacitor-firebase/messaging';

const config: CapacitorConfig = {
  // Az Android natív projekt applicationId-ja szándékosan
  // `app.grundo.android`; az iOS bundle ID miatt a közös alapérték itt marad.
  appId: 'app.grundo.ios',
  appName: 'GRUNDO',
  webDir: 'dist',
  loggingBehavior: 'debug',
  ios: {
    scheme: 'App',
    contentInset: 'never',
    preferredContentMode: 'mobile',
    allowsLinkPreview: false,
  },
  /**
   * ⚠️ IDEIGLENES, TELJESÍTMÉNYMÉRÉSHEZ (GRUNDO #21): a WebView remote
   * debugging release buildben is bekapcsolva, hogy `chrome://inspect`-tel
   * élő Play Console-os teszt-buildet lehessen profilozni.
   *
   * NE Java/Swift kódból próbáld beállítani — a `Bridge` MINDEN esetben
   * saját maga hívja meg a `WebView.setWebContentsDebuggingEnabled(...)`-t
   * (Android: `Bridge.java` a `CapConfig`-ból, alapból
   * `BuildConfig.DEBUG`-ra; iOS: hasonlóan a `WKWebView`
   * `isInspectable`-jét), és ez a hívás MINDIG KÉSŐBB fut le, mint bármi,
   * amit egy `MainActivity`/`AppDelegate` `onCreate`-je tenne — tehát egy
   * kézzel beállított `true` itt csendben felülíródna `false`-ra. Ez a
   * konfigurációs kapcsoló viszont KÖZVETLENÜL ezt az alapértéket írja
   * felül, mindkét platformon egységesen.
   *
   * TEENDŐ A MÉRÉS UTÁN: ezt a két sort törölni kell, mielőtt a GRUNDO
   * nyilvános kiadást kap — élesben nem maradhat bekapcsolva a távoli
   * hibakeresés.
   */
  android: {
    webContentsDebuggingEnabled: true,
  },
  server: {
    hostname: 'localhost',
    iosScheme: 'capacitor',
    androidScheme: 'https',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
    },
    FirebaseMessaging: {
      presentationOptions: ['alert', 'badge', 'sound'],
    },
    FirebaseAuthentication: {
      // A GRUNDO továbbra is a Firebase JS SDK auth-állapotát használja.
      // A natív réteg csak a Google ID tokent szerzi meg.
      skipNativeAuth: true,
      providers: ['google.com'],
    },
  },
  experimental: {
    ios: {
      spm: {
        packageOptions: {
          '@capacitor-firebase/authentication': {
            symlink: true,
          },
          '@capacitor-firebase/messaging': {
            symlink: true,
          },
        },
      },
    },
  },
};

export default config;
