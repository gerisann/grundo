import { describe, expect, it } from 'vitest';
import { formatCellCount } from './format';

describe('formatCellCount', () => {
  it('ezer alatt pontos szám', () => {
    expect(formatCellCount(0)).toBe('0');
    expect(formatCellCount(7)).toBe('7');
    expect(formatCellCount(999)).toBe('999');
  });

  it('ezertől K, egy tizedessel', () => {
    expect(formatCellCount(1000)).toBe('1,0K');
    expect(formatCellCount(2200)).toBe('2,2K');
    expect(formatCellCount(9949)).toBe('9,9K');
  });

  it('tízezertől a tizedes elmarad', () => {
    // Ott a tizedes már zaj: a 14,3K és a 14K ugyanazt mondja.
    expect(formatCellCount(14_000)).toBe('14K');
    expect(formatCellCount(999_000)).toBe('999K');
  });

  it('milliótól M — a Balaton-méretű grund miatt', () => {
    // 1950K olvashatatlan; 1,9M egy pillantás.
    expect(formatCellCount(1_950_000)).toBe('2,0M');
    expect(formatCellCount(1_120_000)).toBe('1,1M');
  });

  it('a negatív és a törtszám nem borítja fel', () => {
    expect(formatCellCount(-5)).toBe('0');
    expect(formatCellCount(12.7)).toBe('13');
  });
});
