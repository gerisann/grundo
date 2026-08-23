/**
 * Félbehagyott rögzítések életciklusa.
 *
 * Az ingyenes/alap helyreállítás ugyanazon az eszközön, IndexedDB-ből működik.
 * Egy későbbi Pro „folytatás bármikor, másik eszközön is” külön, tartós
 * felhős formátum lesz; nem ennek az időablaknak a kitágítása. A mostani
 * felhős tracking dokumentum ritkított kijelzési snapshot, nem hiteles mentés.
 */

/** Az alapcsomagban eddig folytatható egy megszakadt helyi rögzítés. */
export const BASIC_RESUME_WINDOW_MS = 60 * 60 * 1000;

export function isInsideBasicResumeWindow(savedAt: number, now: number): boolean {
  return Number.isFinite(savedAt)
    && savedAt > 0
    && now - savedAt <= BASIC_RESUME_WINDOW_MS;
}

/**
 * Másik eszköz pillanatképe csak élő/szünetelő állapotban és legfeljebb egy
 * órán át jelenhet meg. A `finished` nem félbehagyott út, azonnal eltűnik.
 */
export function isRemoteTrackingVisible(
  status: string,
  updatedAt: number,
  now: number,
): boolean {
  return (status === 'recording' || status === 'paused')
    && isInsideBasicResumeWindow(updatedAt, now);
}
