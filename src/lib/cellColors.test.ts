import { describe, expect, it } from 'vitest';
import {
  CELL_COLORS,
  DEFAULT_CELL_COLOR,
  FREE_CELL_COLORS,
  FREE_CELL_COLOR_KEYS,
  PRO_CELL_COLORS,
  PRO_CELL_COLOR_KEYS,
  availableCellColors,
  cellColorHex,
  isCellColor,
  isProCellColor,
} from './cellColors';

describe('cellaszín-paletta', () => {
  it('16 alap és 8 prémium színt tartalmaz', () => {
    expect(FREE_CELL_COLOR_KEYS).toHaveLength(16);
    expect(PRO_CELL_COLOR_KEYS).toHaveLength(8);
  });

  it('nincs átfedés a két csoport között', () => {
    for (const key of PRO_CELL_COLOR_KEYS) {
      expect(key in FREE_CELL_COLORS).toBe(false);
    }
    expect(Object.keys(CELL_COLORS)).toHaveLength(24);
  });

  it('minden színnek van érvényes hexkódja és magyar címkéje', () => {
    for (const [key, { hex, label }] of Object.entries(CELL_COLORS)) {
      expect(hex, key).toMatch(/^#[0-9A-F]{6}$/);
      expect(label.length, key).toBeGreaterThan(2);
    }
  });

  it('nincs két azonos hexkód — különben két szín megkülönböztethetetlen', () => {
    const hexes = Object.values(CELL_COLORS).map(({ hex }) => hex);
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it('⚠️ az alapértelmezés a korábbi területszín, hogy senki térképe ne változzon', () => {
    // A `--territory-own` token értéke a bevezetés előtt #7c3aed volt.
    expect(DEFAULT_CELL_COLOR).toBe('purple');
    expect(CELL_COLORS[DEFAULT_CELL_COLOR].hex.toLowerCase()).toBe('#7c3aed');
  });
});

describe('cellColorHex', () => {
  it('feloldja az ismert kulcsot', () => {
    expect(cellColorHex('teal')).toBe(FREE_CELL_COLORS.teal.hex);
    expect(cellColorHex('gold')).toBe(PRO_CELL_COLORS.gold.hex);
  });

  it('ismeretlen, hiányzó vagy sérült értéknél az alapértelmezettet adja', () => {
    const alap = CELL_COLORS[DEFAULT_CELL_COLOR].hex;
    expect(cellColorHex(undefined)).toBe(alap);
    expect(cellColorHex(null)).toBe(alap);
    expect(cellColorHex('nincs-ilyen')).toBe(alap);
    expect(cellColorHex(42)).toBe(alap);
    // A hexkód SEM érvényes bemenet: a kulcs tárolódik, nem a szín.
    expect(cellColorHex('#FF0000')).toBe(alap);
  });
});

describe('elérhetőség előfizetés szerint', () => {
  it('Pro nélkül csak az alapszínek', () => {
    const colors = availableCellColors(false);
    expect(colors).toHaveLength(16);
    expect(colors.some(isProCellColor)).toBe(false);
  });

  it('Próval mind a 24', () => {
    expect(availableCellColors(true)).toHaveLength(24);
  });
});

describe('isCellColor', () => {
  it('csak a palettában szereplő kulcsokat fogadja el', () => {
    expect(isCellColor('purple')).toBe(true);
    expect(isCellColor('hot-pink')).toBe(true);
    expect(isCellColor('PURPLE')).toBe(false);
    expect(isCellColor('')).toBe(false);
    expect(isCellColor(undefined)).toBe(false);
    // Prototípus-mezőkre ne üljön fel.
    expect(isCellColor('toString')).toBe(false);
    expect(isCellColor('constructor')).toBe(false);
  });
});
