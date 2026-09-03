/**
 * A HANGZÁR FELOLDÁSA — regressziós teszt.
 *
 * ⚠️ EZ A TESZT EGY ÉLES NÉMULÁS EMLÉKE. 2026-09-03-án natívban kihagytuk a
 * feloldást (a Capacitor forrása szerint ott nincs gesztus-követelmény) — a
 * következő iOS buildben MINDEN hang elnémult. A feloldásnak MINDEN platformon
 * le kell futnia; a részletes indoklás a `sound.ts` `unlockSounds()` fejlécében
 * van.
 *
 * A második eset a hallható farok: iOS-en a `volume = 0` hatástalan, ezért a
 * `pause()`-nak SZINKRON módon kell lefutnia a `play()` után, nem csak a
 * promise beérkezésekor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = { native: false };

vi.mock('./platform', () => ({
  isNativeApp: () => platform.native,
  isNativeIos: () => false,
  isNativeAndroid: () => false,
}));

class FakeAudio {
  static instances: FakeAudio[] = [];

  currentTime = 0;
  paused = true;
  preload = '';
  volume = 1;
  playCount = 0;
  /** Igaz, ha a `pause()` már azelőtt lefutott, hogy a promise beérkezett. */
  pausedSynchronously = false;
  private settled = false;

  constructor(readonly src: string) {
    FakeAudio.instances.push(this);
  }

  setAttribute(): void {}

  play(): Promise<void> {
    this.paused = false;
    this.playCount += 1;
    return Promise.resolve().then(() => {
      this.settled = true;
    });
  }

  pause(): void {
    if (!this.settled) this.pausedSynchronously = true;
    this.paused = true;
  }
}

beforeEach(() => {
  FakeAudio.instances = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('unlockSounds', () => {
  it.each([
    ['weben', false],
    ['natív appban', true],
  ])('%s MINDEN elemet felold', async (_label, native) => {
    platform.native = native;
    vi.stubGlobal('Audio', FakeAudio);
    const { unlockSounds } = await import('./sound');

    unlockSounds();

    /**
     * ⚠️ NATÍVBAN IS. A kihagyása néma appot eredményezett iOS-en — a
     * gesztus-kapu feloldása nem elég, a rendszer hangútvonalát is egy valódi,
     * gesztusból indított lejátszás nyitja meg.
     */
    expect(FakeAudio.instances.length).toBeGreaterThan(0);
    for (const element of FakeAudio.instances) {
      expect(element.playCount).toBe(1);
    }
  });

  it('azonnal, szinkron módon megállítja az elemeket', async () => {
    platform.native = true;
    vi.stubGlobal('Audio', FakeAudio);
    const { unlockSounds } = await import('./sound');

    unlockSounds();

    /**
     * iOS-en a `volume = 0` hatástalan, ezért a hallható farok hosszát KIZÁRÓLAG
     * az dönti el, milyen gyorsan jön a `pause()`. A promise-ra várva egy teljes
     * hangeffekt szólalna meg — elemenként, egyszerre 51-szer.
     */
    for (const element of FakeAudio.instances) {
      expect(element.pausedSynchronously).toBe(true);
      expect(element.paused).toBe(true);
    }
  });
});
