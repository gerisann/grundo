/**
 * A FELOLDÁS HATÓKÖRE — a mérőkapcsoló tiszta függvényei.
 *
 * ⚠️ A LEGFONTOSABB ÁLLÍTÁS AZ ALAPÉRTELMEZÉS. Amíg nincs készüléken mért
 * bizonyíték arra, hogy kevesebb elem is elég, egy ismeretlen vagy sérült
 * tárolt érték NEM szűkítheti a hatókört — az iOS-en néma appot jelentene,
 * ami 2026-09-03-án és 09-04-én is élesben megtörtént.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOUND_UNLOCK_MODE,
  normalizeSoundUnlockMode,
  unlockCountFor,
  unlockResumable,
  type SoundUnlockMode,
} from './soundUnlockMode';

describe('normalizeSoundUnlockMode', () => {
  it('az ismert módokat megtartja', () => {
    for (const mode of ['all', 'per-sound', 'one', 'none'] as SoundUnlockMode[]) {
      expect(normalizeSoundUnlockMode(mode)).toBe(mode);
    }
  });

  it.each([[null], [undefined], ['ize'], [42], [{}]])(
    'ismeretlen értéknél (%s) a MAI viselkedésre esik vissza, nem szűkít',
    (raw) => {
      expect(normalizeSoundUnlockMode(raw)).toBe('all');
    },
  );

  it('az alapértelmezés a teljes hatókör', () => {
    expect(DEFAULT_SOUND_UNLOCK_MODE).toBe('all');
  });
});

describe('unlockCountFor', () => {
  it('"all": a teljes pool', () => {
    expect(unlockCountFor('all', 0, 8)).toBe(8);
    expect(unlockCountFor('all', 5, 2)).toBe(2);
  });

  it('"per-sound": hangonként pontosan egy', () => {
    expect(unlockCountFor('per-sound', 0, 8)).toBe(1);
    expect(unlockCountFor('per-sound', 5, 2)).toBe(1);
  });

  it('"one": CSAK a legelső hang legelső eleme', () => {
    expect(unlockCountFor('one', 0, 8)).toBe(1);
    expect(unlockCountFor('one', 1, 8)).toBe(0);
    expect(unlockCountFor('one', 12, 2)).toBe(0);
  });

  it('"none": semmi — ez a kontroll, a néma állapotot kell reprodukálnia', () => {
    expect(unlockCountFor('none', 0, 8)).toBe(0);
  });

  it('üres poolnál sosem kér többet, mint amennyi van', () => {
    for (const mode of ['all', 'per-sound', 'one', 'none'] as SoundUnlockMode[]) {
      expect(unlockCountFor(mode, 0, 0)).toBe(0);
    }
  });
});

describe('unlockResumable', () => {
  /**
   * A szűk módokban SZÁNDÉKOSAN kimarad: pont az a mérés tárgya, hogy a fel
   * nem oldott elemek megszólalnak-e később.
   */
  it('csak a széles hatókörű módokban oldja fel', () => {
    expect(unlockResumable('all')).toBe(true);
    expect(unlockResumable('per-sound')).toBe(true);
    expect(unlockResumable('one')).toBe(false);
    expect(unlockResumable('none')).toBe(false);
  });
});
