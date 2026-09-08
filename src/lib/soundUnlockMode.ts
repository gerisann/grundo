/**
 * A HANGZÁR FELOLDÁSÁNAK HATÓKÖRE — IDEIGLENES MÉRŐKAPCSOLÓ.
 *
 * ⚠️ EZ NEM VÉGLEGES FUNKCIÓ. Egyetlen kérdés eldöntésére készült, és a válasz
 * megérkezése után ki kell venni (a győztes hatókör marad beégetve).
 *
 * A KÉRDÉS. Az `unlockSounds()` ma MINDEN `<audio>` elemet megszólaltat —
 * jelenleg 51-et (13 hang, a cellahangok 8-as poollal). Ez azon a feltevésen
 * áll, hogy a WebKit gesztus-kapuja ELEMENKÉNT érvényes. A feltevés SOSEM LETT
 * MEGMÉRVE:
 *
 *   - 2026-09-03: a feloldást TELJESEN kivettük → iOS-en minden elnémult.
 *     Ez azt bizonyítja, hogy LEGALÁBB EGY valódi lejátszás kell (a rendszer
 *     hangútvonala, az AVAudioSession attól aktiválódik) — azt NEM, hogy 51.
 *   - A Capacitor iOS-en kikapcsolja a WebKit gesztus-kapuját
 *     (`mediaTypesRequiringUserActionForPlayback = []`). Ha ez tényleg hat,
 *     akkor EGYETLEN feloldó lejátszás is elég.
 *
 * MIÉRT SZÁMÍT. iOS-en a `volume = 0` hatástalan, a hallható zavart csak a
 * hang legvégére ugrás kerüli el — az viszont csendben kiesik, ha a `duration`
 * még `NaN` (a metaadat nincs betöltve). Ilyenkor mind az 51 hang teljes
 * hosszban megszólal: ez Geri „összevissza hangok a Play gombnál" jelensége.
 * 51 helyett 1 elemnél a hiba nem javul, hanem MEGSZŰNIK.
 *
 * MIÉRT localStorage ÉS NEM BUILD-KAPCSOLÓ. Mert az `unlocked` jelző
 * modul-szintű: egy WebView-életciklusban PONTOSAN EGYSZER fut le a feloldás.
 * Minden variáns méréséhez tehát friss appindítás kell — a beállítást viszont
 * túl kell élnie. Egyetlen buildből így mind a négy állás végigmérhető.
 */

export type SoundUnlockMode =
  /** Minden elem — a jelenlegi, mérés előtti viselkedés (51 elem). */
  | 'all'
  /** Hangonként egy elem (13 elem) — a poolon belüli kapu tesztje. */
  | 'per-sound'
  /** Összesen egyetlen elem — a „csak az AVAudioSession kell" tesztje. */
  | 'one'
  /** Semmi — kontroll: a 2026-09-03-i néma állapotot kell reprodukálnia. */
  | 'none';

const STORAGE_KEY = 'grundo.soundUnlockMode';

/**
 * Alapértelmezés: a MAI viselkedés.
 *
 * Szándékosan nem a feltételezett győztes: amíg nincs készüléken mért
 * bizonyíték, egy elrontott/ismeretlen tárolt érték nem némíthatja el az appot.
 */
export const DEFAULT_SOUND_UNLOCK_MODE: SoundUnlockMode = 'all';

export const SOUND_UNLOCK_MODES: readonly SoundUnlockMode[] = [
  'all',
  'per-sound',
  'one',
  'none',
];

/** Magyar címke a mérőpanelhez. */
export const SOUND_UNLOCK_MODE_LABEL: Record<SoundUnlockMode, string> = {
  all: 'Mind (51)',
  'per-sound': 'Hangonként 1 (13)',
  one: 'Összesen 1',
  none: 'Semmi',
};

export function normalizeSoundUnlockMode(raw: unknown): SoundUnlockMode {
  return SOUND_UNLOCK_MODES.includes(raw as SoundUnlockMode)
    ? (raw as SoundUnlockMode)
    : DEFAULT_SOUND_UNLOCK_MODE;
}

/** A `localStorage` privát módban dobhat — a hang sosem múlhat ezen. */
export function soundUnlockMode(): SoundUnlockMode {
  try {
    return normalizeSoundUnlockMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SOUND_UNLOCK_MODE;
  }
}

export function setSoundUnlockMode(mode: SoundUnlockMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* A mérés kedvéért nem érdemes hibát dobni; a következő indítás az alapra esik. */
  }
}

/**
 * Hány elemet oldunk fel EBBŐL a hangból? TISZTA FÜGGVÉNY — a döntést a
 * lejátszástól külön tartjuk, mert ez az, ami tesztelhető.
 *
 * @param soundIndex a hang sorszáma a `SOUND_NAMES`-ben — az `'one'` módban
 *                   csak a legelső hang legelső eleme szólal meg
 * @param poolSize   hány elem van ennek a hangnak a pooljában
 */
export function unlockCountFor(
  mode: SoundUnlockMode,
  soundIndex: number,
  poolSize: number,
): number {
  switch (mode) {
    case 'all':
      return poolSize;
    case 'per-sound':
      return Math.min(1, poolSize);
    case 'one':
      return soundIndex === 0 ? Math.min(1, poolSize) : 0;
    case 'none':
      return 0;
  }
}

/**
 * Feloldjuk-e a NYOMVA TARTÁS külön, folytatható elemét?
 *
 * A pooltól független elem (`resumableElements`), ezért külön döntés. A szűk
 * hatókörű módokban szándékosan kimarad: pont az a kérdés, hogy a fel nem
 * oldott elemek megszólalnak-e.
 */
export function unlockResumable(mode: SoundUnlockMode): boolean {
  return mode === 'all' || mode === 'per-sound';
}
