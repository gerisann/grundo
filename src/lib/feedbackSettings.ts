/**
 * A rögzítés közbeni VISSZAJELZÉS beállításai — hang és felugró üzenet.
 *
 * MIÉRT EGY MODUL KÉT KÉPERNYŐNEK? A felületen két helyen állítható
 * (Beállítások → Hangok, illetve Beállítások → Megjelenés), de ugyanaz a
 * dolog: mit érzékeljen a felhasználó abból, ami rögzítés közben történik.
 * Két külön tár két külön kulccsal ugyanazt a boilerplate-et duplikálná, és
 * a következő visszajelzés-fajta (rezgés?) megint eldöntendő kérdés lenne.
 *
 * MIÉRT `localStorage`, ÉS NEM A PROFIL? Mert ESZKÖZHÖZ tartozik, nem
 * fiókhoz — ugyanaz, mint a befejezés-gesztusnál (`useRecorder.ts`
 * `finishGesture`): a telefonon futás közben kellhet hang, az asztali
 * böngészőben ugyanannak a felhasználónak nem. Szerveroldali tárolás
 * ráadásul írást jelentene a `users` dokumentumba minden kapcsolgatásnál.
 *
 * MIÉRT SAJÁT, PICI STORE, ÉS NEM CONTEXT? Mert a `Dock` (visszaszámlálás),
 * a `TrackingScreen` (foglalás-visszajelzés) és a két beállítás-képernyő
 * mind olvassa, de közös szülőjük az app gyökere — egy újabb Provider ott a
 * teljes fát újrarenderelné minden kapcsolónál. A `useSyncExternalStore`
 * pontosan azt a komponenst frissíti, amelyik tényleg feliratkozott.
 */

const STORAGE_KEY = 'grundo.feedback';

export interface FeedbackSettings {
  /** Fő kapcsoló: e nélkül egyetlen hang sem szólal meg. */
  soundEnabled: boolean;
  /** 0–1. A lejátszó minden hangra ezt állítja be. */
  soundVolume: number;
  /** A 3-2-1 visszaszámlálás és a „RAJT!" hangja. */
  soundCountdown: boolean;
  /** Cellaesemények: szabad cella, megerősítés, lopás, maximum. */
  soundCells: boolean;
  /** A hurokbezárás („Grund megszerezve") hangja. */
  soundLoop: boolean;
  /**
   * A területszerzés FELUGRÓ ÜZENETE és a mögötte futó konfetti.
   *
   * Egy kapcsoló a kettőre — Geri kérése (2026-09-01) így szólt: „a terület
   * szerzés üzenetek (és animációk) legyenek ki-be kapcsolhatóak". A
   * `prefers-reduced-motion` ettől függetlenül is elveszi a konfettit; ez a
   * kapcsoló a teljes visszajelzést némítja.
   */
  territoryPopup: boolean;
}

export const DEFAULT_FEEDBACK_SETTINGS: FeedbackSettings = {
  soundEnabled: true,
  soundVolume: 0.7,
  soundCountdown: true,
  soundCells: true,
  soundLoop: true,
  territoryPopup: true,
};

/**
 * Ismeretlen/sérült tárolt érték esetén az alapértelmezett.
 *
 * Mezőnként esik vissza, nem egészében: egy új mező bevezetése (pl. a
 * hangerő) nem dobhatja el a felhasználó korábbi kapcsolóállásait.
 */
export function normalizeFeedbackSettings(raw: unknown): FeedbackSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_FEEDBACK_SETTINGS };
  const source = raw as Record<string, unknown>;
  const bool = (key: keyof FeedbackSettings): boolean =>
    typeof source[key] === 'boolean' ? (source[key] as boolean) : (DEFAULT_FEEDBACK_SETTINGS[key] as boolean);

  const volume = source.soundVolume;
  return {
    soundEnabled: bool('soundEnabled'),
    soundVolume:
      typeof volume === 'number' && Number.isFinite(volume)
        ? Math.min(1, Math.max(0, volume))
        : DEFAULT_FEEDBACK_SETTINGS.soundVolume,
    soundCountdown: bool('soundCountdown'),
    soundCells: bool('soundCells'),
    soundLoop: bool('soundLoop'),
    territoryPopup: bool('territoryPopup'),
  };
}

function read(): FeedbackSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ...DEFAULT_FEEDBACK_SETTINGS };
    return normalizeFeedbackSettings(JSON.parse(raw));
  } catch {
    // Privát böngészés, letiltott tárhely, sérült JSON: az alapértelmezett a
    // helyes válasz — a hang nem olyan fontos, hogy hibát érdemeljen.
    return { ...DEFAULT_FEEDBACK_SETTINGS };
  }
}

let current: FeedbackSettings | null = null;
const listeners = new Set<() => void>();

/**
 * A pillanatkép REFERENCIÁJA csak valódi változáskor cserélődik.
 *
 * A `useSyncExternalStore` `Object.is`-szel hasonlít: ha minden hívás új
 * objektumot adna, a React végtelen újrarenderelést jelentene hibaként.
 */
export function feedbackSettings(): FeedbackSettings {
  if (current === null) current = read();
  return current;
}

export function subscribeToFeedbackSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function updateFeedbackSettings(patch: Partial<FeedbackSettings>): FeedbackSettings {
  const next = normalizeFeedbackSettings({ ...feedbackSettings(), ...patch });
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* nem baj — a beállítás erre a munkamenetre él tovább */
  }
  for (const listener of listeners) listener();
  return next;
}

/** Kizárólag tesztekhez: a memóriabeli pillanatkép eldobása. */
export function resetFeedbackSettingsCache(): void {
  current = null;
}
