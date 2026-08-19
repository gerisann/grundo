/**
 * Időszakos szorzók kiértékelése.
 *
 * A két dolog, amit itt bizonyítani kell:
 *   1. a területi modifier ARÁNYOSAN hat (nem „mindent vagy semmit"),
 *   2. egy hibás vagy lejárt dokumentum SOHA nem hat — és nem is dob.
 */

import { describe, expect, it } from 'vitest';
import { cellToParent, latLngToCell } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import {
  activeModifiers,
  areaShare,
  isActive,
  modifierFactor,
  type Modifier,
} from './modifiers';

const NOW = Date.parse('2026-08-19T12:00:00Z');
const HOUR = 3_600_000;

/** Két egymástól távoli hely, hogy biztosan külön modifier-cellába essenek. */
const BUDA = latLngToCell(47.4979, 19.0402, GAMEPLAY.H3_RESOLUTION);
const SZEGED = latLngToCell(46.253, 20.1414, GAMEPLAY.H3_RESOLUTION);
const BUDA_AREA = cellToParent(BUDA, GAMEPLAY.MODIFIER_AREA_RES);

function modifier(overrides: Partial<Modifier> = {}): Modifier {
  return {
    id: 'm1',
    kind: 'gp_multiplier',
    scope: 'global',
    value: 2,
    from: NOW - HOUR,
    to: NOW + HOUR,
    reason: 'Teszt akció',
    source: 'manual',
    ...overrides,
  };
}

describe('isActive', () => {
  it('a futó modifier aktív', () => {
    expect(isActive(modifier(), NOW)).toBe(true);
  });

  it('a lejárt és a még el nem kezdődött nem', () => {
    expect(isActive(modifier({ to: NOW - 1 }), NOW)).toBe(false);
    expect(isActive(modifier({ from: NOW + 1 }), NOW)).toBe(false);
  });

  it('a kezdet beleértve, a vég nem — így két egymás utáni akció nem fed át', () => {
    const m = modifier({ from: NOW, to: NOW + HOUR });
    expect(isActive(m, NOW)).toBe(true);
    expect(isActive(m, NOW + HOUR)).toBe(false);
  });

  it('a végtelen élettartamú modifier ÉRVÉNYTELEN', () => {
    // Erre épül az automatikus generálás biztonsága: ami nem jár le, az nem hat.
    expect(isActive(modifier({ to: Number.NaN }), NOW)).toBe(false);
    expect(isActive(modifier({ to: modifier().from }), NOW)).toBe(false);
  });

  it('a negatív szorzó érvénytelen', () => {
    expect(isActive(modifier({ value: -1 }), NOW)).toBe(false);
  });
});

describe('activeModifiers', () => {
  it('fajta szerint szűr', () => {
    const all = [
      modifier({ id: 'gp', kind: 'gp_multiplier' }),
      modifier({ id: 'hold', kind: 'hold_multiplier' }),
      modifier({ id: 'lejart', kind: 'gp_multiplier', to: NOW - 1 }),
    ];
    expect(activeModifiers(all, NOW, 'gp_multiplier').map((m) => m.id)).toEqual(['gp']);
  });
});

describe('areaShare', () => {
  const area = modifier({ scope: 'area', areaCells: [BUDA_AREA] });

  it('teljesen belül: 1', () => {
    expect(areaShare(area, [{ cell: BUDA, weight: 1 }])).toBe(1);
  });

  it('teljesen kívül: 0', () => {
    expect(areaShare(area, [{ cell: SZEGED, weight: 1 }])).toBe(0);
  });

  it('félig belül: 0,5', () => {
    const share = areaShare(area, [
      { cell: BUDA, weight: 1 },
      { cell: SZEGED, weight: 1 },
    ]);
    expect(share).toBeCloseTo(0.5, 6);
  });

  it('a súly számít, nem a minták darabszáma', () => {
    // Egy blokk 300 cellával a területen, egy blokk 100 cellával kívül.
    const share = areaShare(area, [
      { cell: BUDA, weight: 300 },
      { cell: SZEGED, weight: 100 },
    ]);
    expect(share).toBeCloseTo(0.75, 6);
  });

  it('üres minta: 0', () => {
    expect(areaShare(area, [])).toBe(0);
  });

  it('a nem értelmezhető cellát kihagyja, nem dob', () => {
    expect(() => areaShare(area, [{ cell: 'nem-h3', weight: 1 }])).not.toThrow();
    expect(areaShare(area, [{ cell: 'nem-h3', weight: 1 }])).toBe(0);
  });
});

describe('modifierFactor', () => {
  it('modifier nélkül semleges', () => {
    expect(modifierFactor([], 'gp_multiplier', {}, NOW)).toEqual({ factor: 1, applied: [] });
  });

  it('globális modifier teljes súllyal hat', () => {
    const result = modifierFactor([modifier({ value: 2 })], 'gp_multiplier', {}, NOW);
    expect(result.factor).toBe(2);
    expect(result.applied[0]).toMatchObject({ id: 'm1', share: 1, effective: 2 });
  });

  it('a területi modifier ARÁNYOSAN hat', () => {
    const area = modifier({ scope: 'area', areaCells: [BUDA_AREA], value: 2 });
    const result = modifierFactor(
      [area],
      'gp_multiplier',
      { samples: [{ cell: BUDA, weight: 1 }, { cell: SZEGED, weight: 1 }] },
      NOW,
    );

    // A fele esik a bónuszterületre → 2× helyett 1,5×.
    expect(result.factor).toBeCloseTo(1.5, 6);
  });

  it('a területen kívül semmit nem ad', () => {
    const area = modifier({ scope: 'area', areaCells: [BUDA_AREA], value: 3 });
    const result = modifierFactor(
      [area],
      'gp_multiplier',
      { samples: [{ cell: SZEGED, weight: 1 }] },
      NOW,
    );

    expect(result.factor).toBe(1);
    expect(result.applied).toEqual([]);
  });

  it('minta nélkül a területi modifier NEM hat — inkább maradjon el, mint hogy rosszul járjon', () => {
    const area = modifier({ scope: 'area', areaCells: [BUDA_AREA], value: 3 });
    expect(modifierFactor([area], 'gp_multiplier', {}, NOW).factor).toBe(1);
  });

  it('a szegmens-modifier csak az érintettekre hat', () => {
    const segment = modifier({ scope: 'segment', segment: { inactiveDays: 7 }, value: 2 });

    expect(modifierFactor([segment], 'gp_multiplier', { inactiveDays: 10 }, NOW).factor).toBe(2);
    expect(modifierFactor([segment], 'gp_multiplier', { inactiveDays: 2 }, NOW).factor).toBe(1);
    expect(modifierFactor([segment], 'gp_multiplier', {}, NOW).factor).toBe(1);
  });

  it('több modifier szorzói összeszorzódnak', () => {
    const result = modifierFactor(
      [modifier({ id: 'a', value: 2 }), modifier({ id: 'b', value: 1.5 })],
      'gp_multiplier',
      {},
      NOW,
    );
    expect(result.factor).toBe(3);
    expect(result.applied).toHaveLength(2);
  });

  it('az eredőt a plafon fogja meg', () => {
    const many = [1, 2, 3, 4].map((n) => modifier({ id: `m${n}`, value: 3 }));
    const result = modifierFactor(many, 'gp_multiplier', {}, NOW);

    // 3^4 = 81 lenne — a plafon nélkül egy hibás automatika maradandó kárt tenne.
    expect(result.factor).toBe(GAMEPLAY.MODIFIER_MAX_FACTOR);
  });

  it('csak a saját fajtájára hat', () => {
    const hold = modifier({ kind: 'hold_multiplier', value: 5 });
    expect(modifierFactor([hold], 'gp_multiplier', {}, NOW).factor).toBe(1);
    expect(modifierFactor([hold], 'hold_multiplier', {}, NOW).factor).toBe(5);
  });

  it('a lejárt modifier nem hat', () => {
    const expired = modifier({ to: NOW - 1, value: 10 });
    expect(modifierFactor([expired], 'gp_multiplier', {}, NOW).factor).toBe(1);
  });

  it('a nulla szorzó érvényes — így lehet egy akciót ideiglenesen kinullázni', () => {
    const result = modifierFactor([modifier({ value: 0 })], 'gp_multiplier', {}, NOW);
    expect(result.factor).toBe(0);
  });
});
