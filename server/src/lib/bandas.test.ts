import { describe, expect, it } from 'vitest';
import {
  BANDA_NAME_MAX,
  BANDA_NAME_MIN,
  INVITE_CODE_LENGTH,
  generateInviteCode,
  normalizeBandaName,
  sumBandaTotals,
  validateBandaDescription,
  validateBandaName,
} from './bandas';

describe('validateBandaName', () => {
  it('elfogadja az érvényes nevet', () => {
    expect(validateBandaName('Gazdagréti Grundozók')).toBeNull();
  });

  it('elutasítja az üres nevet', () => {
    expect(validateBandaName('   ')).not.toBeNull();
  });

  it(`elutasítja a ${BANDA_NAME_MIN} karakternél rövidebbet`, () => {
    expect(validateBandaName('ab')).not.toBeNull();
  });

  it(`elutasítja a ${BANDA_NAME_MAX} karakternél hosszabbat`, () => {
    expect(validateBandaName('a'.repeat(BANDA_NAME_MAX + 1))).not.toBeNull();
  });
});

describe('validateBandaDescription', () => {
  it('a hiányzó leírás rendben van', () => {
    expect(validateBandaDescription(undefined)).toBeNull();
  });

  it('a 300 karakternél hosszabb leírást elutasítja', () => {
    expect(validateBandaDescription('a'.repeat(301))).not.toBeNull();
  });
});

describe('normalizeBandaName', () => {
  it('kisbetűsít és trimmel a kereséshez', () => {
    expect(normalizeBandaName('  Gazdagréti Grundozók  ')).toBe('gazdagréti grundozók');
  });
});

describe('generateInviteCode', () => {
  it(`${INVITE_CODE_LENGTH} karaktert ad, összetéveszthető karakterek nélkül`, () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode();
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      expect(code).not.toMatch(/[IO01]/);
    }
  });
});

describe('sumBandaTotals', () => {
  it('nulla tagnál csupa nulla', () => {
    const totals = sumBandaTotals([]);
    expect(totals).toEqual({
      areaM2: { foot: 0, bike: 0 },
      areaDayM2: { foot: 0, bike: 0 },
      areaWeekM2: { foot: 0, bike: 0 },
      areaMonthM2: { foot: 0, bike: 0 },
      gpTotal: 0,
      gpWeek: 0,
      gpMonth: 0,
    });
  });

  it('összeadja a tagok mezőit', () => {
    const totals = sumBandaTotals([
      {
        territoryM2: { foot: 1000, bike: 500 },
        areaDay: { foot: 10, bike: 0 },
        areaWeek: { foot: 50, bike: 0 },
        areaMonth: { foot: 200, bike: 0 },
        gpTotal: 100,
        gpWeek: 20,
        gpMonth: 60,
      },
      {
        territoryM2: { foot: 2000, bike: 0 },
        areaDay: { foot: 5, bike: 5 },
        areaWeek: { foot: 25, bike: 0 },
        areaMonth: { foot: 100, bike: 0 },
        gpTotal: 300,
        gpWeek: 40,
        gpMonth: 90,
      },
    ]);

    expect(totals.areaM2).toEqual({ foot: 3000, bike: 500 });
    expect(totals.areaDayM2).toEqual({ foot: 15, bike: 5 });
    expect(totals.areaWeekM2).toEqual({ foot: 75, bike: 0 });
    expect(totals.areaMonthM2).toEqual({ foot: 300, bike: 0 });
    expect(totals.gpTotal).toBe(400);
    expect(totals.gpWeek).toBe(60);
    expect(totals.gpMonth).toBe(150);
  });

  it('hiányzó mezőket nullaként kezel, nem dob hibát', () => {
    expect(() => sumBandaTotals([{}])).not.toThrow();
    expect(sumBandaTotals([{}]).areaM2).toEqual({ foot: 0, bike: 0 });
  });
});
