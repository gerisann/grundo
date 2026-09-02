import { describe, expect, it } from 'vitest';
import { shouldAutoUpload } from './recorder';

/**
 * A befejezett rögzítés automatikus feltöltésének feltétele.
 *
 * ⚠️ EZ EGY ÉLES ADATVESZTÉST RÖGZÍT (2026-08-26). A feltétel korábban a
 * `TrackingScreen` egyik hatásában élt, a Befejezés gomb viszont a `Dock`-ban
 * van — az pedig MINDEN képernyőn ott van. Aki rögzítés közben a böngésző
 * „vissza" gombjával elhagyta a rögzítés képernyőjét, majd onnan fejezte be a
 * mérést, annál a feltöltés SOHA nem indult el: a képernyő nem volt
 * felcsatolva, tehát a hatása sem futott.
 *
 * Éles adaton visszaigazolva (`nagz` felhasználó): nulla aktivitás, nulla
 * trust-dokumentum, nulla GP-tétel — a kérés el sem jutott a szerverig.
 *
 * A `MIN_DISTANCE_M` szándékosan PARAMÉTER, nem import: a játékkonstansokat a
 * motor is paraméterként kapja (AGENTS.md 10. szabály), és így a küszöb
 * viselkedése önmagában is mérhető.
 */

const KUSZOB = 100;
const futas = (status: 'idle' | 'recording' | 'paused' | 'finished', distanceM: number) =>
  ({ status, distanceM }) as const;

describe('shouldAutoUpload', () => {
  it('befejezett, elég hosszú rögzítést magától feltölt', () => {
    expect(shouldAutoUpload(futas('finished', 850), 'idle', KUSZOB)).toBe(true);
  });

  it('a küszöböt épp elérő rögzítés is megy', () => {
    expect(shouldAutoUpload(futas('finished', KUSZOB), 'idle', KUSZOB)).toBe(true);
  });

  it('a küszöb alatti mozgást nem küldi el', () => {
    expect(shouldAutoUpload(futas('finished', 99), 'idle', KUSZOB)).toBe(false);
  });

  it('futó vagy szüneteltetett mérést nem tölt fel', () => {
    expect(shouldAutoUpload(futas('recording', 850), 'idle', KUSZOB)).toBe(false);
    expect(shouldAutoUpload(futas('paused', 850), 'idle', KUSZOB)).toBe(false);
    expect(shouldAutoUpload(futas('idle', 0), 'idle', KUSZOB)).toBe(false);
  });

  /**
   * A lassú mentés alatt a hatás többször is lefuthat. Ha nem csak `idle`-ből
   * indulna, ugyanaz az aktivitás kétszer menne fel — a szerver idempotens, de
   * a fölösleges kérés akkor is hiba.
   */
  it('csak `idle` feltöltési állapotból indul', () => {
    for (const status of ['sending', 'processing', 'done', 'error'] as const) {
      expect(shouldAutoUpload(futas('finished', 850), status, KUSZOB)).toBe(false);
    }
  });
});
