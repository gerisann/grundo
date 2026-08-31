import { FirebaseAppCheck } from '@capacitor-firebase/app-check';
import {
  CustomProvider,
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check';
import type { FirebaseApp } from 'firebase/app';
import { isNativeApp } from './platform';

let instance: AppCheck | null = null;
let tokenFailureLogged = false;

/**
 * Initializes App Check before Auth, Firestore, or Storage are created.
 *
 * The packaged apps use native Play Integrity / App Attest tokens. A custom
 * Web SDK provider bridges that native token into the JavaScript Firebase SDK,
 * so direct Firestore and Storage calls can use the same attestation as the
 * custom Cloud Run API. The browser uses reCAPTCHA Enterprise directly.
 */
export function initializeGrundoAppCheck(app: FirebaseApp): AppCheck | null {
  if (import.meta.env.VITE_USE_EMULATORS === '1') return null;

  if (isNativeApp()) {
    const nativeReady = FirebaseAppCheck.initialize({
      isTokenAutoRefreshEnabled: true,
    });
    const provider = new CustomProvider({
      getToken: async () => {
        await nativeReady;
        const result = await FirebaseAppCheck.getToken({ forceRefresh: false });
        const expiresAt = result.expireTimeMillis;
        if (!Number.isFinite(expiresAt) || expiresAt === undefined || expiresAt <= Date.now()) {
          throw new Error('A natív App Check-token lejárata hiányzik vagy érvénytelen.');
        }
        return { token: result.token, expireTimeMillis: expiresAt };
      },
    });
    instance = initializeAppCheck(app, {
      provider,
      isTokenAutoRefreshEnabled: true,
    });
    return instance;
  }

  const siteKey = (import.meta.env.VITE_RECAPTCHA_SITE_KEY ?? '').trim();
  if (!siteKey) return null;

  instance = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
  return instance;
}

/** Header for the custom Cloud Run backend. Missing setup stays rollout-safe. */
export async function appCheckHeader(): Promise<Record<string, string>> {
  if (!instance) return {};
  try {
    const result = await getToken(instance, false);
    tokenFailureLogged = false;
    return { 'X-Firebase-AppCheck': result.token };
  } catch (error) {
    if (!tokenFailureLogged) {
      tokenFailureLogged = true;
      // eslint-disable-next-line no-console
      console.warn('[GRUNDO] Az App Check-token nem kérhető le.', error);
    }
    return {};
  }
}
