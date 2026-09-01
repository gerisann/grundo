/**
 * A visszajelzés-beállítások és a hangkapuk tesztjei.
 *
 * A tárolóból bármi jöhet (régi séma, kézzel szerkesztett `localStorage`,
 * sérült JSON) — a normalizálásnak mindig használható beállítást kell adnia,
 * mert ez a modul a rögzítés útjában van.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FEEDBACK_SETTINGS,
  normalizeFeedbackSettings,
  type FeedbackSettings,
} from './feedbackSettings';
import { shouldPlaySound } from './sound';

describe('normalizeFeedbackSettings', () => {
  it('nem objektumból az alapértelmezettet adja', () => {
    expect(normalizeFeedbackSettings(null)).toEqual(DEFAULT_FEEDBACK_SETTINGS);
    expect(normalizeFeedbackSettings('igen')).toEqual(DEFAULT_FEEDBACK_SETTINGS);
  });

  it('MEZŐNKÉNT esik vissza — egy új mező nem dobja el a régi kapcsolókat', () => {
    const result = normalizeFeedbackSettings({ soundEnabled: false, soundCells: false });

    expect(result.soundEnabled).toBe(false);
    expect(result.soundCells).toBe(false);
    expect(result.soundCountdown).toBe(DEFAULT_FEEDBACK_SETTINGS.soundCountdown);
    expect(result.soundVolume).toBe(DEFAULT_FEEDBACK_SETTINGS.soundVolume);
  });

  it('a hangerőt 0 és 1 közé vágja, a szemetet eldobja', () => {
    expect(normalizeFeedbackSettings({ soundVolume: 4 }).soundVolume).toBe(1);
    expect(normalizeFeedbackSettings({ soundVolume: -2 }).soundVolume).toBe(0);
    expect(normalizeFeedbackSettings({ soundVolume: Number.NaN }).soundVolume).toBe(
      DEFAULT_FEEDBACK_SETTINGS.soundVolume,
    );
    expect(normalizeFeedbackSettings({ soundVolume: 'hangos' }).soundVolume).toBe(
      DEFAULT_FEEDBACK_SETTINGS.soundVolume,
    );
  });
});

describe('shouldPlaySound', () => {
  const on: FeedbackSettings = { ...DEFAULT_FEEDBACK_SETTINGS };

  it('a fő kapcsoló mindent némít', () => {
    const off = { ...on, soundEnabled: false };
    expect(shouldPlaySound('count-down-beep', off)).toBe(false);
    expect(shouldPlaySound('loop-closed', off)).toBe(false);
  });

  it('a nulla hangerő ugyanúgy némít, mint a kikapcsolás', () => {
    expect(shouldPlaySound('loop-closed', { ...on, soundVolume: 0 })).toBe(false);
  });

  it('a csatornák egymástól függetlenek', () => {
    const cellsOff = { ...on, soundCells: false };
    expect(shouldPlaySound('cell-captured', cellsOff)).toBe(false);
    expect(shouldPlaySound('cell-max', cellsOff)).toBe(false);
    expect(shouldPlaySound('loop-closed', cellsOff)).toBe(true);
    expect(shouldPlaySound('count-down-start', cellsOff)).toBe(true);
  });

  it('a visszaszámlálás két hangja egy kapcsolón lóg', () => {
    const countdownOff = { ...on, soundCountdown: false };
    expect(shouldPlaySound('count-down-beep', countdownOff)).toBe(false);
    expect(shouldPlaySound('count-down-start', countdownOff)).toBe(false);
  });
});
