import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ native: false, ios: false, android: false }));
const messaging = vi.hoisted(() => ({
  isSupported: vi.fn(async () => ({ isSupported: true })),
  checkPermissions: vi.fn(async () => ({ receive: 'prompt' })),
  requestPermissions: vi.fn(async () => ({ receive: 'granted' })),
  getToken: vi.fn(async () => ({ token: 'native-fcm-token' })),
  deleteToken: vi.fn(async () => {}),
  addListener: vi.fn(async () => ({ remove: vi.fn(async () => {}) })),
}));
const firestore = vi.hoisted(() => ({
  setDoc: vi.fn(async () => {}),
  deleteDoc: vi.fn(async () => {}),
}));

// A Codemagicben valódi Firebase environment változók vannak. A unit teszt
// ettől még nem írhat hálózatra: a Firestore-határt teljesen leválasztjuk.
vi.mock('./firebase', () => ({ app: {}, db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((...segments: unknown[]) => segments.join('/')),
  serverTimestamp: vi.fn(() => 'server-timestamp'),
  setDoc: firestore.setDoc,
  deleteDoc: firestore.deleteDoc,
}));

vi.mock('./platform', () => ({
  isNativeApp: () => platform.native,
  isNativeIos: () => platform.ios,
  isNativeAndroid: () => platform.android,
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
  platform.android = false;
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
    expect(pathFromPushData({ screen: 'banda', bandaId: 'b1' })).toBe('/bandak/b1');
    expect(pathFromPushData({ screen: 'bandas', type: 'banda_invited' })).toBe('/kozosseg/bandak');
  });

  it('natív iOS-en FCM tokent kér és a leiratkozást tartósan megőrzi', async () => {
    platform.native = true;
    platform.ios = true;
    messaging.checkPermissions.mockResolvedValue({ receive: 'granted' });

    await expect(requestPermissionAndSubscribe('geri')).resolves.toEqual({ ok: true });
    expect(messaging.requestPermissions).toHaveBeenCalledOnce();
    expect(messaging.getToken).toHaveBeenCalledOnce();
    expect(firestore.setDoc).toHaveBeenCalledOnce();
    expect(values.get('grundo.pushEnabled')).toBe('1');
    await expect(readPushPermission()).resolves.toBe('granted');

    await unsubscribe('geri');
    expect(firestore.deleteDoc).toHaveBeenCalledOnce();
    expect(messaging.deleteToken).toHaveBeenCalledOnce();
    expect(values.has('grundo.pushEnabled')).toBe(false);
    await expect(readPushPermission()).resolves.toBe('default');
  });

  it('natív Androidon android platformjelöléssel menti az FCM tokent', async () => {
    platform.native = true;
    platform.android = true;
    messaging.checkPermissions.mockResolvedValue({ receive: 'granted' });

    await expect(requestPermissionAndSubscribe('geri')).resolves.toEqual({ ok: true });
    expect(firestore.setDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ platform: 'android' }),
      { merge: true },
    );
    await expect(readPushPermission()).resolves.toBe('granted');
  });
});
