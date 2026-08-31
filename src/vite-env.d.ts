/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  /** Dedikált Firestore adatbázis. Ha üres, a kód a 'grundo-db' értékre esik vissza. */
  readonly VITE_FIRESTORE_DATABASE_ID: string;
  readonly VITE_MAPBOX_TOKEN: string;
  readonly VITE_MAPBOX_STYLE_LIGHT?: string;
  readonly VITE_MAPBOX_STYLE_DARK?: string;
  /** Cloud Run backend. Amíg nincs deployolva, üresen hagyható. */
  readonly VITE_API_BASE_URL?: string;
  /** Web App Check reCAPTCHA Enterprise Key ID. Nyilvános klienskonfiguráció. */
  readonly VITE_RECAPTCHA_SITE_KEY?: string;
  readonly VITE_USE_EMULATORS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
