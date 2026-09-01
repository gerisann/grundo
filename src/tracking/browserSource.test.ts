/**
 * A böngészős helyforrás ŐRKUTYÁJÁNAK tesztjei.
 *
 * A javított hiba: iOS Safariban (és energiatakarékos Androidon) a
 * `watchPosition` előtérbe visszatérés után némán halott maradhat — se
 * minta, se hibaesemény. A rögzítés a felületen „fut", a nyomvonal viszont
 * nem nő, és ez csak a mentésnél derül ki.
 *
 * Ezt valós készüléken órákig tartana reprodukálni, tiszta függvényként
 * viszont pontosan leírható.
 */

import { describe, expect, it } from 'vitest';
import { shouldRestartWatch, SILENCE_LIMIT_MS } from './browserSource';

const START = 1_000_000;

describe('shouldRestartWatch', () => {
  it('friss minta után nem indít újra', () => {
    expect(shouldRestartWatch(START + 5_000, START, START + 20_000, true)).toBe(false);
  });

  it('teljes csend után újraindít', () => {
    expect(
      shouldRestartWatch(START + 5_000, START, START + 5_000 + SILENCE_LIMIT_MS, true),
    ).toBe(true);
  });

  it('a HIBA is életjel — a hívó ugyanezt a mezőt frissíti', () => {
    // A `timeout` hiba félpercenként jön alagútban: a figyelés él, csak
    // nincs jel. Ilyenkor újraindítani fölösleges munka.
    const lastError = START + 40_000;
    expect(shouldRestartWatch(lastError, START, lastError + 20_000, true)).toBe(false);
  });

  it('jel nélküli indulásnál az INDÍTÁS ideje számít', () => {
    // Enélkül a legelső, még fix nélküli másodpercben azonnal újraindítanánk.
    expect(shouldRestartWatch(0, START, START + 10_000, true)).toBe(false);
    expect(shouldRestartWatch(0, START, START + SILENCE_LIMIT_MS, true)).toBe(true);
  });

  it('rejtett lapon SOHA nem indít újra', () => {
    // Ott a csend természetes: a böngésző szándékosan fojtja a figyelést.
    // Az újraindítás ugyanúgy fojtva lenne, csak az akkumulátort enné.
    expect(
      shouldRestartWatch(START, START, START + 10 * SILENCE_LIMIT_MS, false),
    ).toBe(false);
  });

  it('a küszöb magasabb, mint a böngésző saját időkorlátja', () => {
    // Ha nem így lenne, egy élő, de jel nélküli figyelést percenként
    // újraindítanánk — pont amikor a legkevésbé segít.
    expect(SILENCE_LIMIT_MS).toBeGreaterThan(30_000);
  });
});
