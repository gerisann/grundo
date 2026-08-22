/**
 * A mai küldetés — a Home kártyájához ÉS a Küldetések képernyő visszatöltéséhez.
 *
 * ⚠️ A HOME NEM GENERÁL KÜLDETÉST. Ez a modul csak ELTESZI azt, amit a
 * felhasználó a Küldetések képernyőn már legeneráltatott, és a Home
 * visszaolvassa.
 *
 * ⚠️ A TELJES EREDMÉNYT tesszük el, nem csak a legjobb ajánlatot. Amíg csak az
 * egy küldetés volt tárolva, a Home kártyája egy konkrét ajánlatot mutatott, a
 * gombja viszont egy ÜRES Küldetések képernyőre vitt — a célképernyő nem tudott
 * arról, amit a Home kiírt. Geri jelentette (2026-08-22).
 *
 * MIÉRT NEM GENERÁL? Mert a generálás kvótás (ingyenesen heti öt) és API-t
 * fogyaszt. Ha a Home minden betöltéskor kérne egyet, az első két nap
 * elégetné az egész heti keretet — méghozzá anélkül, hogy a felhasználó
 * bármit is kért volna. A docs célja („a legjobb ajánlat megjelenjen a Home
 * tetején, egy koppintással indíthatóan") így is teljesül: ha ma volt
 * generálás, ott van; ha nem, a kártya odahív.
 *
 * A tár LOKÁLIS, nem Firestore: eszközfüggő megjelenítési adat, nem
 * játékadat — ugyanaz a megfontolás, mint a réteg-választásnál a Grund
 * képernyőn.
 */

import type { Mission, MissionResult } from './api';

const KEY = 'grundo.dailyMission';

interface StoredMission {
  /** Helyi dátum `YYYY-MM-DD` alakban — ettől „mai" a küldetés. */
  day: string;
  /**
   * A legjobb ajánlat, külön is.
   *
   * ⚠️ NEM FÖLÖSLEGES a `result` mellett: a Home csak ezt olvassa, és így a
   * korábbi bundle által eltett `{day, mission}` alak is használható marad —
   * a felhasználó nem veszíti el a mai kártyáját egy telepítés miatt.
   */
  mission: Mission;
  /** A teljes válasz — ebből tölti vissza magát a Küldetések képernyő. */
  result?: MissionResult;
}

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${date}`;
}

/** A mai generálás eltétele — a Home kártyájának és a visszatöltésnek. */
export function rememberDailyMission(result: MissionResult | undefined): void {
  const mission = result?.missions[0];
  if (!result || !mission) return;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ day: today(), mission, result } satisfies StoredMission),
    );
  } catch {
    /* privát böngészés — a Home ilyenkor a felhívást mutatja */
  }
}

/** A ma eltett generálás, ellenőrzött nappal — a két olvasó közös alapja. */
function readStored(): StoredMission | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredMission>;
    if (stored.day !== today() || !stored.mission) return null;
    return stored as StoredMission;
  } catch {
    return null;
  }
}

/**
 * A ma eltett legjobb küldetés, vagy `null`.
 *
 * A TEGNAPI SOSEM JÖN VISSZA. Egy küldetés a jelenlegi birtokviszonyra épül,
 * és az egy nap alatt megváltozhat — egy elavult ajánlat olyan területet
 * ígérne, ami már nem szabad.
 */
export function readDailyMission(): Mission | null {
  return readStored()?.mission ?? null;
}

/**
 * A ma eltett TELJES generálás — ebből tölti vissza magát a Küldetések képernyő.
 *
 * `null`-t ad a korábbi bundle által eltett `{day, mission}` alakra is: onnan
 * hiányzik a `targetKm` és a kvóta, és inkább ne írjunk ki számot, mint hogy
 * kitaláljuk. Ez legfeljebb egy napig tart, mert a tár amúgy is naponta ürül.
 */
export function readDailyMissionResult(): MissionResult | null {
  const stored = readStored();
  return stored?.result && Array.isArray(stored.result.missions) ? stored.result : null;
}

/* ════════════════════════════════════════════════════════════════════════
   A Home-kártya elrejtése
   ════════════════════════════════════════════════════════════════════════ */

const DISMISS_KEY = 'grundo.dailyMission.dismissed';

/**
 * A kártya bezárása — CSAK a Home megjelenítését érinti.
 *
 * ⚠️ A KÜLDETÉST NEM DOBJUK EL. Aki elteszi a kártyát az útból, nem azt kérte,
 * hogy a Küldetések képernyő is felejtse el a mai generálását — az kvótába
 * került. Ezért külön kulcs, nem a tár törlése.
 *
 * A jelzés NAPRA SZÓL, mint maga a küldetés: holnap az új ajánlat megint
 * megjelenik, különben egyetlen bezárás örökre elrejtené a legerősebb
 * visszahívó elemet.
 */
export function dismissDailyMissionCard(): void {
  try {
    localStorage.setItem(DISMISS_KEY, today());
  } catch {
    /* privát böngészés — a kártya a következő betöltéskor visszajön */
  }
}

export function isDailyMissionCardDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === today();
  } catch {
    return false;
  }
}
