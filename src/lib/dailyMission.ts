/**
 * A mai küldetés — a Home kártyájához.
 *
 * ⚠️ A HOME NEM GENERÁL KÜLDETÉST. Ez a modul csak ELTESZI azt, amit a
 * felhasználó a Küldetések képernyőn már legeneráltatott, és a Home
 * visszaolvassa.
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

import type { Mission } from './api';

const KEY = 'grundo.dailyMission';

interface StoredMission {
  /** Helyi dátum `YYYY-MM-DD` alakban — ettől „mai" a küldetés. */
  day: string;
  mission: Mission;
}

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${date}`;
}

/** A legjobb ajánlat eltétele a Home számára. */
export function rememberDailyMission(mission: Mission | undefined): void {
  if (!mission) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ day: today(), mission } satisfies StoredMission));
  } catch {
    /* privát böngészés — a Home ilyenkor a felhívást mutatja */
  }
}

/**
 * A ma eltett küldetés, vagy `null`.
 *
 * A TEGNAPI SOSEM JÖN VISSZA. Egy küldetés a jelenlegi birtokviszonyra épül,
 * és az egy nap alatt megváltozhat — egy elavult ajánlat olyan területet
 * ígérne, ami már nem szabad.
 */
export function readDailyMission(): Mission | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredMission>;
    if (stored.day !== today() || !stored.mission) return null;
    return stored.mission;
  } catch {
    return null;
  }
}
