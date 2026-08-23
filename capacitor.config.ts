import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
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
  },
  plugins: {
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
    },
  },
};

export default config;
