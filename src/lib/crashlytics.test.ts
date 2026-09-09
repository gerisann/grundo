import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = { native: false };
const setCustomKey = vi.fn();
const setUserId = vi.fn();
const didCrashOnPreviousExecution = vi.fn();

vi.mock('./platform', () => ({ isNativeApp: () => platform.native }));
vi.mock('@capacitor-firebase/crashlytics', () => ({
  FirebaseCrashlytics: { setCustomKey, setUserId, didCrashOnPreviousExecution },
}));

beforeEach(() => {
  platform.native = false;
  setCustomKey.mockReset().mockResolvedValue(undefined);
  setUserId.mockReset().mockResolvedValue(undefined);
  didCrashOnPreviousExecution.mockReset();
});

describe('Crashlytics session binding', () => {
  it('does nothing on the web', async () => {
    const crashlytics = await import('./crashlytics');
    await crashlytics.bindCrashlyticsSession('session-1', 'uid-1');
    expect(setCustomKey).not.toHaveBeenCalled();
  });

  it('sets the searchable session key and Firebase user ID natively', async () => {
    platform.native = true;
    const crashlytics = await import('./crashlytics');
    await crashlytics.bindCrashlyticsSession('session-1', 'uid-1');
    expect(setCustomKey).toHaveBeenCalledWith({
      key: 'grundo.sessionId',
      value: 'session-1',
      type: 'string',
    });
    expect(setUserId).toHaveBeenCalledWith({ userId: 'uid-1' });
  });

  it('uses the native previous-execution signal', async () => {
    platform.native = true;
    didCrashOnPreviousExecution.mockResolvedValue({ crashed: true });
    const crashlytics = await import('./crashlytics');
    await expect(crashlytics.didNativeCrashPreviously()).resolves.toBe(true);
  });
});
