import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEEDBACK_SETTINGS } from './feedbackSettings';
import { holdPlaybackFor } from './sound';

/** A befejezés gomb feltöltődési ideje — `FinishGestureButtons.FINISH_HOLD_MS`. */
const HOLD_MS = 1000;
/** A `pressing-finish-activity.mp3` MÉRT hossza (ffprobe, 2026-09-03). */
const SOUND_SEC = 2.04;

class FakeAudio {
  static instances: FakeAudio[] = [];

  currentTime = 0;
  paused = true;
  preload = '';
  volume = 1;
  playbackRate = 1;
  playCount = 0;
  /** A hangfájl hossza; a valódi elemnél a betöltött metaadatból jön. */
  duration = SOUND_SEC;

  constructor(readonly src: string) {
    FakeAudio.instances.push(this);
  }

  setAttribute(): void {}

  play(): Promise<void> {
    this.paused = false;
    this.playCount += 1;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  FakeAudio.instances = [];
});

/**
 * A NYOMVA TARTÁS HANGJA A GOMB TÖLTÖTTSÉGÉHEZ IGAZÍTVA.
 *
 * A korábbi viselkedés — „folytasd ott, ahol abbahagytuk" — HIBÁS volt: a sáv
 * elengedéskor visszafolyik, a hang viszont nem folyt vissza vele. A teljes
 * indoklás a `sound.ts` `holdPlaybackFor()` fejlécében van.
 */
describe('holdPlaybackFor', () => {
  it('a teljes hangot a gomb töltési ablakába préseli', () => {
    const plan = holdPlaybackFor(SOUND_SEC, 0, HOLD_MS);
    // 2,04 mp hang 1,0 mp alatt → 2,04-szeres sebesség.
    expect(plan?.rate).toBeCloseTo(2.04, 5);
  });

  it('a sáv töltöttségének megfelelő pontra ugrik', () => {
    // Geri példája: 25%-os töltöttségnél a hangnak is a 25%-ánál kell tartania.
    expect(holdPlaybackFor(SOUND_SEC, 0.25, HOLD_MS)?.currentTime).toBeCloseTo(0.51, 5);
    expect(holdPlaybackFor(SOUND_SEC, 0, HOLD_MS)?.currentTime).toBe(0);
    expect(holdPlaybackFor(SOUND_SEC, 1, HOLD_MS)?.currentTime).toBeCloseTo(SOUND_SEC, 5);
  });

  it('a hang hátralévő része pontosan a sáv hátralévő idejét tölti ki', () => {
    for (const progress of [0, 0.25, 0.5, 0.9]) {
      const plan = holdPlaybackFor(SOUND_SEC, progress, HOLD_MS)!;
      const remainingAudioSec = SOUND_SEC - plan.currentTime;
      const remainingRealMs = (remainingAudioSec / plan.rate) * 1000;
      expect(remainingRealMs).toBeCloseTo((1 - progress) * HOLD_MS, 5);
    }
  });

  it('a tartományon kívüli értékeket beszorítja', () => {
    expect(holdPlaybackFor(SOUND_SEC, -1, HOLD_MS)?.currentTime).toBe(0);
    expect(holdPlaybackFor(SOUND_SEC, 5, HOLD_MS)?.currentTime).toBeCloseTo(SOUND_SEC, 5);
    // Némítást okozó sebesség helyett inkább a szinkronból engedünk.
    expect(holdPlaybackFor(60, 0, HOLD_MS)?.rate).toBe(4);
  });

  it('ismeretlen hosszúságnál nem tervez — a hang akkor is szólal', () => {
    // A metaadat még nem töltődött be: `duration` NaN.
    expect(holdPlaybackFor(Number.NaN, 0.5, HOLD_MS)).toBeNull();
    expect(holdPlaybackFor(0, 0.5, HOLD_MS)).toBeNull();
  });
});

describe('playHoldSound', () => {
  it('a sáv állásához igazítja a hangot, és elindítja', async () => {
    vi.stubGlobal('Audio', FakeAudio);
    const { playHoldSound } = await import('./sound');

    playHoldSound('pressing-finish-activity', 0.25, HOLD_MS, DEFAULT_FEEDBACK_SETTINGS);

    const audio = FakeAudio.instances[0]!;
    expect(audio.currentTime).toBeCloseTo(0.51, 5);
    expect(audio.playbackRate).toBeCloseTo(2.04, 5);
    expect(audio.paused).toBe(false);
  });

  it('újranyomáskor a KORÁBBI pozíciót eldobja, a sávét veszi át', async () => {
    vi.stubGlobal('Audio', FakeAudio);
    const { playHoldSound, pauseSoundPlayback } = await import('./sound');

    playHoldSound('pressing-finish-activity', 0.6, HOLD_MS, DEFAULT_FEEDBACK_SETTINGS);
    const audio = FakeAudio.instances[0]!;
    audio.currentTime = 1.3;
    pauseSoundPlayback('pressing-finish-activity');
    expect(audio.paused).toBe(true);

    /**
     * ⚠️ EZ A JAVÍTÁS LÉNYEGE. A sáv közben visszafolyt 25%-ra; a hang NEM
     * folytathatja 1,3 mp-nél, hanem a 25%-nak megfelelő 0,51 mp-re ugrik.
     */
    playHoldSound('pressing-finish-activity', 0.25, HOLD_MS, DEFAULT_FEEDBACK_SETTINGS);
    expect(audio.currentTime).toBeCloseTo(0.51, 5);
    expect(audio.paused).toBe(false);
    expect(audio.playCount).toBe(2);
  });

  it('sikeres befejezéskor nullára tekeri a hangot', async () => {
    vi.stubGlobal('Audio', FakeAudio);
    const { playHoldSound, pauseSoundPlayback } = await import('./sound');

    playHoldSound('pressing-finish-activity', 0, HOLD_MS, DEFAULT_FEEDBACK_SETTINGS);
    const audio = FakeAudio.instances[0]!;
    audio.currentTime = 1;

    pauseSoundPlayback('pressing-finish-activity', true);
    expect(audio.paused).toBe(true);
    expect(audio.currentTime).toBe(0);
  });
});
