import { describe, expect, it } from 'vitest';
import { areConnectedToCenter, generateColorTerritory } from './colorTerritory';

describe('generateColorTerritory', () => {
  it('creates a unique cluster connected to the selected center cell', () => {
    const cells = generateColorTerritory(() => 0.42);
    const coordinates = cells.map(({ q, r }) => `${q},${r}`);

    expect(cells.length).toBeGreaterThanOrEqual(14);
    expect(new Set(coordinates).size).toBe(cells.length);
    expect(coordinates).not.toContain('0,0');
    expect(areConnectedToCenter(cells)).toBe(true);
  });

  it('finishes every randomized fade within five seconds', () => {
    const samples = [0, 0.15, 0.5, 0.85, 0.999] as const;
    let index = 0;
    const cells = generateColorTerritory(() => samples[index++ % samples.length] ?? 0);

    for (const cell of cells) {
      expect(cell.delayMs).toBeGreaterThanOrEqual(0);
      expect(cell.durationMs).toBeGreaterThanOrEqual(1_300);
      expect(cell.delayMs + cell.durationMs).toBeLessThanOrEqual(5_000);
    }
  });
});
