import type { CapacitorConfig } from '@capacitor/cli';
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
  },
  experimental: {
    ios: {
      spm: {
        packageOptions: {
          '@capacitor-firebase/messaging': {
            symlink: true,
          },
        },
      },
    },
  },
};

export default config;
