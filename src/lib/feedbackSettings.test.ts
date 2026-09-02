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
import { isSequenceStepStale, shouldPlaySound } from './sound';

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
    expect(result.soundActivity).toBe(DEFAULT_FEEDBACK_SETTINGS.soundActivity);
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
    expect(shouldPlaySound('pause-activity', cellsOff)).toBe(true);
  });

  it('a visszaszámlálás két hangja egy kapcsolón lóg', () => {
    const countdownOff = { ...on, soundCountdown: false };
    expect(shouldPlaySound('count-down-beep', countdownOff)).toBe(false);
    expect(shouldPlaySound('count-down-start', countdownOff)).toBe(false);
  });

  it('az aktivitásvezérlés hangjai egy külön kapcsolón lógnak', () => {
    const activityOff = { ...on, soundActivity: false };
    expect(shouldPlaySound('pause-activity', activityOff)).toBe(false);
    expect(shouldPlaySound('pressing-finish-activity', activityOff)).toBe(false);
    expect(shouldPlaySound('activity-saved', activityOff)).toBe(false);
    expect(shouldPlaySound('loop-closed', activityOff)).toBe(true);
  });

  /**
   * ⚠️ REJTETT LAPON EGYETLEN HANG SEM SZÓLHAT.
   *
   * Nem azért, mert zavarna — hanem mert a böngésző nem utasítja vissza a
   * lejátszást, hanem VÁR vele, és előtérbe visszatéréskor mindet egyszerre
   * indítja el. Mért eset (2026-09-01, iOS terepteszt): a menet közben néma
   * cellahangok az app újranyitása után tömegesen lejátszódtak.
   */
  it('rejtett lapon minden csatorna néma, a beállításoktól függetlenül', () => {
    for (const name of ['count-down-beep', 'cell-captured', 'loop-closed'] as const) {
      expect(shouldPlaySound(name, on, 'hidden')).toBe(false);
      expect(shouldPlaySound(name, on, 'visible')).toBe(true);
    }
  });

  /**
   * DOM NÉLKÜL (teszt, szerveroldali renderelés) a láthatóság ISMERETLEN — és
   * az nem jelenthet némaságot, különben egy hiányzó `document` csendben
   * érvénytelenítené az összes fenti szabályt.
   */
  it('ismeretlen láthatóság nem némít', () => {
    expect(shouldPlaySound('loop-closed', on, undefined)).toBe(true);
  });
});

/**
 * A KÉSLELTETETT KOPPANÁS ELDOBJA MAGÁT, HA ELKÉSETT.
 *
 * MÉRT ESET (2026-09-02): asztali böngészőben a hangok rendben, natív
 * iOS/Android alatt „egyszerre szól az összes". A `playSoundSequence`
 * 190-220 ms-onként lépteti a koppanásokat, de a WebView felfüggesztésekor a
 * beütemezett `setTimeout`-ok megállnak, és előtérbe visszatéréskor a
 * böngésző MIND elsüti őket egymás után — a sorból egyetlen dörrenés lesz.
 */
describe('isSequenceStepStale', () => {
  it('a pontosan időben lefutó lépés nem elkésett', () => {
    expect(isSequenceStepStale(190, 190)).toBe(false);
  });

  it('a főszál apró csúszása belefér', () => {
    expect(isSequenceStepStale(190 + 500, 190)).toBe(false);
  });

  it('a másodperces késés viszont már eldobja a hangot', () => {
    expect(isSequenceStepStale(190 + 1_500, 190)).toBe(true);
  });

  it('a sor KÉSŐBBI lépéseit a saját idejükhöz méri, nem a sor elejéhez', () => {
    // A harmadik koppanás 380 ms-ra esedékes: 800 ms-nál még időben van,
    // 1 200 ms-nál viszont már nem.
    expect(isSequenceStepStale(800, 380)).toBe(false);
    expect(isSequenceStepStale(1_200, 380)).toBe(true);
  });
});
