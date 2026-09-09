/** Native Crashlytics context used to match Firebase crashes to bug reports. */

import { FirebaseCrashlytics } from '@capacitor-firebase/crashlytics';
import { isNativeApp } from '@/lib/platform';

export async function bindCrashlyticsSession(sessionId: string, uid: string): Promise<void> {
  if (!isNativeApp() || !sessionId) return;
  await Promise.all([
    FirebaseCrashlytics.setCustomKey({
      key: 'grundo.sessionId',
      value: sessionId,
      type: 'string',
    }),
    FirebaseCrashlytics.setUserId({ userId: uid }),
  ]);
}

export async function didNativeCrashPreviously(): Promise<boolean> {
  if (!isNativeApp()) return false;
  const result = await FirebaseCrashlytics.didCrashOnPreviousExecution();
  return result.crashed;
}
