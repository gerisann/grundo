/**
 * A HANGZÁR FELOLDÁSA — a natív hangzavar regressziós tesztje.
 *
 * Háttér: iOS-en a `HTMLMediaElement.volume` írása nem hat, ezért a `volume =
 * 0`-ra épülő „néma feloldás" ott TELJES HANGERŐN szólalt meg, elemenként.
 * A részletes indoklás és a mérés a `sound.ts` `unlockSounds()` fejlécében van.
 *
 * A teszt MINDKÉT irányt őrzi, mert a javítás könnyen átbillenhet a másik
 * hibába: natívban ne szóljon semmi, weben viszont MINDEN elem oldódjon fel —
 * különben a 3-2-1 visszaszámlálás első sípja maradna néma.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = { native: false };

vi.mock('./platform', () => ({
  isNativeApp: () => platform.native,
  isNativeIos: () => false,
  isNativeAndroid: () => false,
}));

/**
 * iOS-szerű elem: a `volume` értékadása CSENDBEN elszáll (a hangerő a fizikai
 * gombok alatt van), az olvasás mindig 1-et ad. A `play()` ezért hallhatóan
 * indul akkor is, ha a hívó nullára állította volna.
 */
class IosAudio {
  static instances: IosAudio[] = [];
  /** Minden hallhatóan elindult lejátszás — EZ a mérés tárgya. */
  static audibleStarts: string[] = [];

  currentTime = 0;
  paused = true;
  preload = '';
  muted = false;
  private readonly actualVolume = 1;

  constructor(readonly src: string) {
    IosAudio.instances.push(this);
  }

  get volume(): number {
    return this.actualVolume;
  }

  set volume(_value: number) {
    /* iOS: az értékadás nem hat */
  }

  setAttribute(): void {}

  play(): Promise<void> {
    this.paused = false;
    if (!this.muted && this.actualVolume > 0) IosAudio.audibleStarts.push(this.src);
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }
}

/** Böngészős elem: a `volume` írása HAT, tehát a feloldás valóban néma. */
class WebAudio {
  static instances: WebAudio[] = [];

  currentTime = 0;
  paused = true;
  preload = '';
  volume = 1;
  playCount = 0;
  /** A `volume` értéke a `play()` pillanatában — a némaság bizonyítéka. */
  volumeAtPlay: number[] = [];

  constructor(readonly src: string) {
    WebAudio.instances.push(this);
  }

  setAttribute(): void {}

  play(): Promise<void> {
    this.paused = false;
    this.playCount += 1;
    this.volumeAtPlay.push(this.volume);
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }
}

beforeEach(() => {
  platform.native = false;
  IosAudio.instances = [];
  IosAudio.audibleStarts = [];
  WebAudio.instances = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('unlockSounds', () => {
  it('natív appban EGYETLEN hangot sem indít el', async () => {
    platform.native = true;
    vi.stubGlobal('Audio', IosAudio);
    const { unlockSounds } = await import('./sound');

    unlockSounds();

    /**
     * A javítás nélkül itt 51 hallható indítás van (32 cellahang négyféle
     * hangból, plusz visszaszámlálás, hurok, aktivitás-hangok) — pontosan az
     * a hangzavar, amit Geri iOS-en hallott.
     */
    expect(IosAudio.audibleStarts).toEqual([]);
    // Az elemek ettől még LÉTREJÖNNEK: a `primeSounds()` előtöltése kell,
    // hogy a visszaszámlálás első sípja ne késsen.
    expect(IosAudio.instances.length).toBeGreaterThan(0);
  });

  it('weben MINDEN elemet feloldja, némán', async () => {
    platform.native = false;
    vi.stubGlobal('Audio', WebAudio);
    const { unlockSounds } = await import('./sound');

    unlockSounds();

    // A gesztus-követelmény weben valódi: minden elemnek meg kell szólalnia
    // egyszer, különben a későbbi `play()` blokkolva marad.
    expect(WebAudio.instances.length).toBeGreaterThan(0);
    for (const element of WebAudio.instances) {
      expect(element.playCount).toBe(1);
      expect(element.volumeAtPlay).toEqual([0]);
    }
  });
});
