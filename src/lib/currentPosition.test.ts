/**
 * ⚠️ EZ A TESZT EGY MÉRT HIBA EMLÉKE (iPhone, 2026-09-09).
 *
 * A natív appban a `navigator.geolocation` hívása KÉT rendszerablakot hozott
 * fel egymás után: a CoreLocation magyar kérdését, majd a WebKit saját,
 * oldal-szintű kérdését — angolul, „localhost would like to use your current
 * location" szöveggel. A második érthetetlen és gyanús, épp abban a
 * pillanatban, amikor a felhasználó igent mondana.
 *
 * A javítás az, hogy natívban a SAJÁT pluginünk adja az egyszeri fixet. Ez a
 * teszt azt őrzi, hogy natív platformon a böngésző API-ját tényleg SENKI nem
 * hívja — mert ha visszakerül, a hiba is visszajön, és csak készüléken
 * derülne ki.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const platform = { native: false };
const nativeFix = {
  lat: 47.5,
  lng: 19.05,
  accuracyM: 12,
  at: 1_700_000_000_000,
};

vi.mock('./platform', () => ({
  isNativeApp: () => platform.native,
  isNativeIos: () => platform.native,
  isNativeAndroid: () => false,
}));

const nativeCurrentPosition = vi.fn(async () => nativeFix);
vi.mock('@/tracking/nativeSource', () => ({
  nativeCurrentPosition: () => nativeCurrentPosition(),
}));

/** Minden böngészős helymeghatározás ezen megy át — natívban egyszer sem. */
const browserGetCurrentPosition = vi.fn();

beforeEach(() => {
  platform.native = false;
  nativeCurrentPosition.mockClear();
  browserGetCurrentPosition.mockReset();
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: browserGetCurrentPosition } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function load() {
  return import('./currentPosition');
}

describe('currentPosition', () => {
  it('iOS-en a helyi plugineket regisztráló bridge controller indul', () => {
    const storyboard = readFileSync(
      new URL('../../ios/App/App/Base.lproj/Main.storyboard', import.meta.url),
      'utf8',
    );
    const bridgeController = readFileSync(
      new URL('../../ios/App/App/GRUNDOBridgeViewController.swift', import.meta.url),
      'utf8',
    );

    expect(storyboard).toContain('customClass="GRUNDOBridgeViewController"');
    expect(storyboard).not.toContain('customClass="CAPBridgeViewController"');
    expect(bridgeController).toContain('registerPluginInstance(BackgroundLocationPlugin())');
  });

  it('natívban a plugint hívja, a böngésző API-ját SOHA', async () => {
    platform.native = true;
    const { currentPosition } = await load();

    await expect(currentPosition()).resolves.toEqual(nativeFix);

    expect(nativeCurrentPosition).toHaveBeenCalledTimes(1);
    // ⚠️ EZ A LÉNYEG: egyetlen böngészős hívás is visszahozza az angol,
    // „localhost" nevű rendszerablakot.
    expect(browserGetCurrentPosition).not.toHaveBeenCalled();
  });

  it('natívban is lezárja a hívást a kért időkorlátnál', async () => {
    vi.useFakeTimers();
    platform.native = true;
    nativeCurrentPosition.mockImplementationOnce(() => new Promise(() => undefined));
    const { currentPosition, PositionUnavailableError } = await load();

    const pending = currentPosition({ timeoutMs: 1_500 });
    const assertion = expect(pending).rejects.toBeInstanceOf(PositionUnavailableError);
    await vi.advanceTimersByTimeAsync(1_500);
    await assertion;

    expect(browserGetCurrentPosition).not.toHaveBeenCalled();
  });

  it('böngészőben a böngésző API-ját hívja', async () => {
    browserGetCurrentPosition.mockImplementation((success: (fix: unknown) => void) => {
      success({ coords: { latitude: 47.1, longitude: 19.2, accuracy: 30 }, timestamp: 42 });
    });
    const { currentPosition } = await load();

    await expect(currentPosition()).resolves.toEqual({
      lat: 47.1,
      lng: 19.2,
      accuracyM: 30,
      at: 42,
    });
    expect(nativeCurrentPosition).not.toHaveBeenCalled();
  });

  it('a böngésző hibájából kezelhető hiba lesz', async () => {
    browserGetCurrentPosition.mockImplementation(
      (_success: unknown, failure: (error: { message: string }) => void) => {
        failure({ message: 'User denied Geolocation' });
      },
    );
    const { currentPosition, PositionUnavailableError } = await load();

    await expect(currentPosition()).rejects.toBeInstanceOf(PositionUnavailableError);
  });

  it('helymeghatározás nélküli böngészőben sem dob nyers hibát', async () => {
    vi.stubGlobal('navigator', {});
    const { currentPosition, PositionUnavailableError } = await load();

    await expect(currentPosition()).rejects.toBeInstanceOf(PositionUnavailableError);
  });

  it('a pontosság hiánya nem lesz NaN', async () => {
    browserGetCurrentPosition.mockImplementation((success: (fix: unknown) => void) => {
      success({ coords: { latitude: 1, longitude: 2, accuracy: Number.NaN }, timestamp: 0 });
    });
    const { currentPosition } = await load();

    const fix = await currentPosition();
    expect(fix.accuracyM).toBe(99_999);
    // A hiányzó időbélyeg helyére a mostani idő kerül, nem nulla.
    expect(fix.at).toBeGreaterThan(0);
  });
});
