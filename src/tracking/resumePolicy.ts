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
 * Ennyi ideig hallgathat el a JS-kontextus úgy, hogy azt még ÁRTALMATLAN
 * natív WebView-újraindulásnak vesszük, nem tényleges megszakításnak.
 *
 * A Core Location/foreground service a háttérben zökkenőmentesen tovább
 * mérhet, amíg maga a WebView memóriaszűke miatt újratöltődik — ez a
 * felhasználó szemszögéből SOSEM történt meg, tehát a folytatásnak is
 * kérdés nélkül, azonnal kell történnie.
 *
 * Ennél hosszabb kihagyásnál viszont már nem tartható, hogy csak egy ilyen
 * ártalmatlan reload volt: valószínűbb, hogy a felhasználó ténylegesen
 * háttérbe tette vagy be is zárta az appot (esetleg véletlen force-quit),
 * és erről MEG KELL KÉRDEZNI — lásd GRUNDO #42: a natív oldal korábban
 * minden ilyen esetben kérdés nélkül, láthatatlanul folytatta a rögzítést.
 */
export const NATIVE_SILENT_RESUME_WINDOW_MS = 2 * 60 * 1000;

export function isWithinSilentNativeResumeWindow(savedAt: number, now: number): boolean {
  return Number.isFinite(savedAt) && savedAt > 0 && now - savedAt <= NATIVE_SILENT_RESUME_WINDOW_MS;
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
