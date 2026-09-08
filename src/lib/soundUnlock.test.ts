/**
 * A HANGZÁR FELOLDÁSA — regressziós teszt.
 *
 * ⚠️ EZ A TESZT EGY ÉLES NÉMULÁS EMLÉKE. 2026-09-03-án natívban kihagytuk a
 * feloldást (a Capacitor forrása szerint ott nincs gesztus-követelmény) — a
 * következő iOS buildben MINDEN hang elnémult. A feloldásnak MINDEN platformon
 * le kell futnia; a részletes indoklás a `sound.ts` `unlockSounds()` fejlécében
 * van.
 *
 * ⚠️ A MÁSODIK NÉMULÁS (2026-09-04) ennek a tesztnek a korábbi változatát is
 * érinti: az a SZINKRON `pause()`-t követelte meg — épp azt, ami iOS-en
 * megszakítja a lejátszást, mielőtt elindulna, és ezzel másodszor is elnémítja
 * az appot. A feloldáshoz VALÓDI, végigfutó lejátszás kell; a hallható zavart
 * a hang legvégére ugrás kerüli el.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = { native: false, ios: false };

vi.mock('./platform', () => ({
  isNativeApp: () => platform.native,
  isNativeIos: () => platform.ios,
  isNativeAndroid: () => false,
}));

beforeEach(() => {
  platform.native = false;
  platform.ios = false;
});

/** Ismert időtartam — feloldáskor ide, a hang legvégére kell ugrani. */
const CLIP_SECONDS = 2;

class FakeAudio {
  static instances: FakeAudio[] = [];
  /** `NaN`, ha a metaadat még nincs betöltve — a példányok ezt kapják. */
  static duration = CLIP_SECONDS;

  currentTime = 0;
  paused = true;
  preload = '';
  volume = 1;
  playCount = 0;
  readonly duration = FakeAudio.duration;
  /** Igaz, ha a `pause()` már azelőtt lefutott, hogy a promise beérkezett. */
  pausedSynchronously = false;
  /** Ahol a lejátszás ténylegesen elindult. */
  startedAt: number | null = null;
  /** A hangerő a lejátszás PILLANATÁBAN — iOS-en ez dönti el, hallható-e. */
  volumeAtPlay: number | null = null;
  private settled = false;

  constructor(readonly src: string) {
    FakeAudio.instances.push(this);
  }

  setAttribute(): void {}

  play(): Promise<void> {
    this.paused = false;
    this.playCount += 1;
    this.startedAt = this.currentTime;
    this.volumeAtPlay = this.volume;
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

  /**
   * ⚠️ NATÍV iOS-EN EGYETLEN, HALLHATÓ LEJÁTSZÁS — MÉRT EREDMÉNY.
   *
   * A négy mérés (Geri, iPhone) EGYETLEN mechanizmussal magyarázható:
   *
   *   51 elem, frissen létrehozva  → `volume = 0` no-op → hangos → AKTIVÁL
   *    1 elem, frissen létrehozva  → `volume = 0` no-op → hangos → AKTIVÁL
   *    2 elem, előtöltve (b49)     → `volume = 0` HAT     → néma  → NEM aktivál
   *    1 elem, előtöltve (b50)     → `volume = 0` HAT     → néma  → NEM aktivál
   *
   * iOS-en a `volume` írása csak addig hatástalan, amíg az elem nincs betöltve.
   * Amint a `primeSounds()` előrébb került, a némítás érvényre jutott — és egy
   * néma lejátszás nem aktiválja az AVAudioSessiont.
   */
  it('natív iOS-en PONTOSAN EGY elemet old fel', async () => {
    platform.native = true;
    platform.ios = true;
    vi.stubGlobal('Audio', FakeAudio);
    const { unlockSounds } = await import('./sound');

    unlockSounds();

    const played = FakeAudio.instances.filter((element) => element.playCount > 0);
    expect(played).toHaveLength(1);
  });

  /**
   * ⚠️ EZ A TESZT A HARMADIK ÉS NEGYEDIK NÉMULÁS EMLÉKE (build 49 és 50).
   *
   * iOS-en a feloldás NEM lehet néma és nem ugorhat a hang végére: mindkettő
   * ugyanoda vezet — nincs valódi hang, tehát a rendszer hangútvonala nem
   * aktiválódik, és az app MINDEN hangja néma marad. A feloldás ára egyetlen
   * rövid, HALLHATÓ koppanás — a némaság sosem opció.
   */
  it('natív iOS-en HALLHATÓAN és a hang elejéről szól, ismert hossz mellett is', async () => {
    platform.native = true;
    platform.ios = true;
    vi.stubGlobal('Audio', FakeAudio);
    const { unlockSounds } = await import('./sound');

    unlockSounds();

    const played = FakeAudio.instances.filter((element) => element.playCount > 0);
    expect(played).toHaveLength(1);
    // A hang ELEJÉRŐL — nem a lecsengés csendes végéről.
    expect(played[0]!.startedAt).toBe(0);
    // ÉS NEM NÉMÍTVA — ez a b50 némulásának közvetlen oka volt.
    expect(played[0]!.volumeAtPlay).toBeGreaterThan(0);
  });

  /**
   * ⚠️ WEBEN NEM SZABAD SZŰKÍTENI. Ott nincs Capacitor, tehát a gesztus-kapu
   * ÉL és elemenként érvényes — egyetlen elem feloldása a webes appot
   * elnémítaná. iPhone Safari is ide tartozik, nem a natív ághoz.
   */
  it('weben MINDEN elemet felold, akkor is, ha iOS-en fut a böngésző', async () => {
    platform.native = false;
    platform.ios = false;
    vi.stubGlobal('Audio', FakeAudio);
    const { unlockSounds } = await import('./sound');

    unlockSounds();

    const played = FakeAudio.instances.filter((element) => element.playCount > 0);
    expect(played).toHaveLength(FakeAudio.instances.length);
    expect(played.length).toBeGreaterThan(2);
  });

  /**
   * ⚠️ EZ A TESZT EGY MÁSODIK ÉLES NÉMULÁS EMLÉKE. A szinkron `pause()`
   * megszakítja a `play()`-t, mielőtt az elindulna — iOS-en emiatt a rendszer
   * hangútvonala nem aktiválódik, és minden hang néma marad.
   */
  it('a lejátszást hagyja elindulni, nem szakítja meg szinkron módon', async () => {
    platform.native = true;
    vi.stubGlobal('Audio', FakeAudio);
    const { unlockSounds } = await import('./sound');

    unlockSounds();

    for (const element of FakeAudio.instances) {
      expect(element.pausedSynchronously).toBe(false);
    }
  });

  it('a hang legvégére ugrik, hogy a feloldás ne legyen hallható', async () => {
    platform.native = true;
    vi.stubGlobal('Audio', FakeAudio);
    const { unlockSounds } = await import('./sound');

    unlockSounds();

    for (const element of FakeAudio.instances) {
      expect(element.startedAt).toBeGreaterThan(CLIP_SECONDS - 0.2);
      expect(element.startedAt).toBeLessThan(CLIP_SECONDS);
    }
  });

  /**
   * Ismeretlen időtartamnál (a metaadat még nem töltődött be) a teljes hang
   * szólal meg. Hangosabb, de MŰKÖDIK — a némaság sosem opció.
   */
  it('ismeretlen hosszúságnál elölről játszik, de akkor is felold', async () => {
    platform.native = true;
    FakeAudio.duration = Number.NaN;
    vi.stubGlobal('Audio', FakeAudio);
    const { unlockSounds } = await import('./sound');

    unlockSounds();

    for (const element of FakeAudio.instances) {
      expect(element.playCount).toBe(1);
      expect(element.startedAt).toBe(0);
    }
    FakeAudio.duration = CLIP_SECONDS;
  });

  it('a feloldás után minden elem meg van állítva és nullázva', async () => {
    platform.native = true;
    vi.stubGlobal('Audio', FakeAudio);
    const { unlockSounds } = await import('./sound');

    unlockSounds();
    await Promise.resolve();
    await Promise.resolve();

    for (const element of FakeAudio.instances) {
      expect(element.paused).toBe(true);
      expect(element.currentTime).toBe(0);
    }
  });
});
