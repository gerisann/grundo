/**
 * A NYOMVA TARTÓS BEFEJEZÉS lezárási szabályai.
 *
 * ⚠️ EZ A TESZT EGY ÉLES HIBA EMLÉKE (Geri, iPhone, 2026-09-08): a befejezés
 * gombot nyomva tartva a piros sáv elindult, majd „random" megszakadt. A gomb
 * NÉGY eseményre hívott `cancel()`-t, és ebből három olyankor is elsülhetett,
 * amikor a felhasználó még nyomta: `pointerleave` (az ujj lecsúszik a kis
 * gombról), `blur` (iOS-en a fókusz elmozdulhat), és egy MÁSIK ujj mutatójának
 * eseménye.
 *
 * A gomb azóta elfogja a mutatót (`setPointerCapture`), ahogy a `SwipeFinish`
 * is teszi ugyanabban a fájlban — ezek a függvények a döntés tesztelhető fele.
 */

import { describe, expect, it } from 'vitest';
import { cancelsOnBlur, endsHold } from './FinishGestureButtons';

describe('endsHold', () => {
  it('a nyomást indító mutató eseménye lezár', () => {
    expect(endsHold(7, 7)).toBe(true);
  });

  /**
   * ⚠️ A MÁSODIK UJJ. Nyomva tartás közben a kijelző bármely pontján történő
   * érintés mutató-eseményt kelt; ha az a gombra érkezik, korábban megszakította
   * a töltést.
   */
  it('IDEGEN mutató eseménye nem zár le', () => {
    expect(endsHold(7, 8)).toBe(false);
  });

  it('billentyűs nyomásnál (nincs aktív mutató) semmilyen mutató nem zár le', () => {
    expect(endsHold(null, 0)).toBe(false);
    expect(endsHold(null, 7)).toBe(false);
  });
});

describe('cancelsOnBlur', () => {
  /**
   * ⚠️ EZ VOLT AZ EGYIK MEGSZAKÍTÓ. Ujjal nyomva a fókuszvesztés nem a
   * felhasználó szándéka — a nyomás végét a mutató saját eseményei jelzik.
   */
  it('futó MUTATÓS nyomást a fókuszvesztés NEM szakít meg', () => {
    expect(cancelsOnBlur(7)).toBe(false);
    expect(cancelsOnBlur(0)).toBe(false);
  });

  /**
   * Billentyűről indítva viszont ez az egyetlen jelzés, hogy a gomb már nem
   * aktív — enélkül a sáv beragadna.
   */
  it('billentyűs nyomást megszakít', () => {
    expect(cancelsOnBlur(null)).toBe(true);
  });
});
