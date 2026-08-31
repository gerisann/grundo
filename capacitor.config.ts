import type { CapacitorConfig } from '@capacitor/cli';
import type {} from '@capacitor-firebase/app-check';
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
          '@capacitor-firebase/app-check': {
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
