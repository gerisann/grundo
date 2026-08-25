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

const FREE_HEXES = [
  '#DDC3A1', '#E1A344', '#D1712F', '#BD505C',
  '#E06E70', '#CB5043', '#8F3A40', '#76462D',
  '#566F49', '#418D7A', '#315F89', '#5B4A69',
  '#2D5653', '#709EAA', '#7F7F7F', '#2E2E2E',
];

const PRO_HEXES = [
  '#2879FD', '#00E4FE', '#01FEA9', '#FF6000',
  '#FFD502', '#E3FF00', '#01FF1F', '#FD012F',
  '#FF00A8', '#027501', '#0D034D', '#7C00FF',
];

describe('cellaszín-paletta', () => {
  it('16 alap és 12 prémium színt tartalmaz', () => {
    expect(FREE_CELL_COLOR_KEYS).toHaveLength(16);
    expect(PRO_CELL_COLOR_KEYS).toHaveLength(12);
  });

  it('a rögzített sorrendben tartalmazza a megadott színeket', () => {
    expect(FREE_CELL_COLOR_KEYS.map((key) => CELL_COLORS[key].hex)).toEqual(FREE_HEXES);
    expect(PRO_CELL_COLOR_KEYS.map((key) => CELL_COLORS[key].hex)).toEqual(PRO_HEXES);
  });

  it('nincs átfedés a két csoport között', () => {
    for (const key of PRO_CELL_COLOR_KEYS) {
      expect(key in FREE_CELL_COLORS).toBe(false);
    }
    expect(Object.keys(CELL_COLORS)).toHaveLength(28);
  });

  it('minden színnek van érvényes hexkódja és magyar címkéje', () => {
    for (const [key, { hex, label }] of Object.entries(CELL_COLORS)) {
      expect(hex, key).toMatch(/^#[0-9A-F]{6}$/);
      expect(label.length, key).toBeGreaterThan(2);
    }
  });

  it('nincs két azonos hexkód', () => {
    const hexes = Object.values(CELL_COLORS).map(({ hex }) => hex);
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it('az alapértelmezés a normál paletta első színe', () => {
    expect(DEFAULT_CELL_COLOR).toBe('purple');
    expect(CELL_COLORS[DEFAULT_CELL_COLOR].hex).toBe('#DDC3A1');
  });
});

describe('cellColorHex', () => {
  it('feloldja az ismert kulcsot', () => {
    expect(cellColorHex('teal')).toBe(FREE_CELL_COLORS.teal.hex);
    expect(cellColorHex('gold')).toBe(PRO_CELL_COLORS.gold.hex);
    expect(cellColorHex('neon-green')).toBe(PRO_CELL_COLORS['neon-green'].hex);
  });

  it('ismeretlen, hiányzó vagy sérült értéknél az alapértelmezettet adja', () => {
    const alap = CELL_COLORS[DEFAULT_CELL_COLOR].hex;
    expect(cellColorHex(undefined)).toBe(alap);
    expect(cellColorHex(null)).toBe(alap);
    expect(cellColorHex('nincs-ilyen')).toBe(alap);
    expect(cellColorHex(42)).toBe(alap);
    expect(cellColorHex('#FF0000')).toBe(alap);
  });
});

describe('elérhetőség előfizetés szerint', () => {
  it('Pro nélkül csak az alapszínek', () => {
    const colors = availableCellColors(false);
    expect(colors).toHaveLength(16);
    expect(colors.some(isProCellColor)).toBe(false);
  });

  it('Próval mind a 28', () => {
    expect(availableCellColors(true)).toHaveLength(28);
  });
});

describe('isCellColor', () => {
  it('csak a palettában szereplő kulcsokat fogadja el', () => {
    expect(isCellColor('purple')).toBe(true);
    expect(isCellColor('hot-pink')).toBe(true);
    expect(isCellColor('deep-indigo')).toBe(true);
    expect(isCellColor('PURPLE')).toBe(false);
    expect(isCellColor('')).toBe(false);
    expect(isCellColor(undefined)).toBe(false);
    expect(isCellColor('toString')).toBe(false);
    expect(isCellColor('constructor')).toBe(false);
  });
});
