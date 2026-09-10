import { describe, expect, it } from 'vitest';
import { acceptedUsageDelta } from './usage';

describe('app usage heartbeat', () => {
  it('csak a monoton számláló új részét fogadja el', () => {
    expect(acceptedUsageDelta({ totalActiveMs: 70_000, previousTotalMs: 60_000, serverElapsedMs: 60_000 })).toBe(10_000);
  });

  it('az ismételt vagy régebbi kérést nem számolja kétszer', () => {
    expect(acceptedUsageDelta({ totalActiveMs: 60_000, previousTotalMs: 60_000, serverElapsedMs: 1_000 })).toBe(0);
    expect(acceptedUsageDelta({ totalActiveMs: 50_000, previousTotalMs: 60_000, serverElapsedMs: 1_000 })).toBe(0);
  });

  it('az irreális ugrást a szerveren eltelt időhöz korlátozza', () => {
    expect(acceptedUsageDelta({ totalActiveMs: 600_000, previousTotalMs: 60_000, serverElapsedMs: 60_000 })).toBe(90_000);
  });
});
