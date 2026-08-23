import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ native: false, ios: false }));
const messaging = vi.hoisted(() => ({
  isSupported: vi.fn(async () => ({ isSupported: true })),
  checkPermissions: vi.fn(async () => ({ receive: 'prompt' })),
  requestPermissions: vi.fn(async () => ({ receive: 'granted' })),
  getToken: vi.fn(async () => ({ token: 'native-fcm-token' })),
  deleteToken: vi.fn(async () => {}),
  addListener: vi.fn(async () => ({ remove: vi.fn(async () => {}) })),
}));

vi.mock('./platform', () => ({
  isNativeApp: () => platform.native,
  isNativeIos: () => platform.ios,
}));

vi.mock('@capacitor-firebase/messaging', () => ({
  FirebaseMessaging: messaging,
}));

import {
  currentPushPermission,
  pathFromPushData,
  readPushPermission,
  requestPermissionAndSubscribe,
  unsubscribe,
} from './push';

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  platform.native = false;
  platform.ios = false;
  vi.clearAllMocks();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    value: { permission: 'granted' },
  });
});

describe('push eszközkapcsoló', () => {
  it('a rendszerengedélyt nem keveri össze az alkalmazáson belüli feliratkozással', () => {
    expect(currentPushPermission()).toBe('default');
    values.set('grundo.pushEnabled', '1');
    expect(currentPushPermission()).toBe('granted');
  });

  it('az értesítés adatából a megfelelő belső képernyőt választja', () => {
    expect(pathFromPushData({ screen: 'territory', type: 'territory_stolen' })).toBe('/grund');
    expect(pathFromPushData({ screen: 'profile', username: 'peeti77' })).toBe(
      '/felhasznalo/peeti77',
    );
    expect(pathFromPushData({ screen: 'activity', activityId: 'a/b' })).toBe(
      '/aktivitas/a%2Fb',
    );
  });

  it('natív iOS-en FCM tokent kér és a leiratkozást tartósan megőrzi', async () => {
    platform.native = true;
    platform.ios = true;
    messaging.checkPermissions.mockResolvedValue({ receive: 'granted' });

    await expect(requestPermissionAndSubscribe('geri')).resolves.toEqual({ ok: true });
    expect(messaging.requestPermissions).toHaveBeenCalledOnce();
    expect(messaging.getToken).toHaveBeenCalledOnce();
    expect(values.get('grundo.pushEnabled')).toBe('1');
    await expect(readPushPermission()).resolves.toBe('granted');

    await unsubscribe('geri');
    expect(messaging.deleteToken).toHaveBeenCalledOnce();
    expect(values.has('grundo.pushEnabled')).toBe(false);
    await expect(readPushPermission()).resolves.toBe('default');
  });
});
