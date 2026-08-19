/**
 * A futásidejű konfiguráció feloldása.
 *
 * A tét: egy elrontott `appConfig/gameplay` dokumentum NEM állíthatja meg a
 * játékot, és nem hozhat létre olyan szabályt, ami önmagában érvényes, együtt
 * viszont értelmetlen (pl. csökkenő védelmi létra).
 */

import { describe, expect, it } from 'vitest';
import { GAMEPLAY } from './gameplay';
import { resolveGameplay, tunableAt, tunableGroups, TUNABLES } from './tunables';

describe('resolveGameplay — alapeset', () => {
  it('felülírás nélkül az alapértékeket adja', () => {
    const { config, applied, rejected } = resolveGameplay(null);

    expect(config.CLAIM_GP_PER_SQRT_KM2).toBe(GAMEPLAY.CLAIM_GP_PER_SQRT_KM2);
    expect(config.BASE_GP_PER_KM.run).toBe(GAMEPLAY.BASE_GP_PER_KM.run);
    expect(applied).toEqual({});
    expect(rejected).toEqual([]);
  });

  it('nem írja felül az EREDETI konstansokat', () => {
    const before = GAMEPLAY.CLAIM_GP_PER_SQRT_KM2;
    const { config } = resolveGameplay({ CLAIM_GP_PER_SQRT_KM2: 999 });

    expect(config.CLAIM_GP_PER_SQRT_KM2).toBe(999);
    // A statikus alapérték érintetlen — különben egy felülírás átszivárogna
    // minden későbbi feloldásba, és a rendszer emlékezne rá.
    expect(GAMEPLAY.CLAIM_GP_PER_SQRT_KM2).toBe(before);
  });

  it('két feloldás nem hat egymásra', () => {
    resolveGameplay({ STEAL_BONUS: 2 });
    const { config } = resolveGameplay(null);
    expect(config.STEAL_BONUS).toBe(GAMEPLAY.STEAL_BONUS);
  });
});

describe('resolveGameplay — érvényes felülírások', () => {
  it('egyszerű kulcsot átír', () => {
    const { config, applied } = resolveGameplay({ HOLD_GP_PER_KM2: 250 });
    expect(config.HOLD_GP_PER_KM2).toBe(250);
    expect(applied).toEqual({ HOLD_GP_PER_KM2: 250 });
  });

  it('pontozott útvonalat is átír', () => {
    const { config } = resolveGameplay({ 'BASE_GP_PER_KM.ride': 7 });
    expect(config.BASE_GP_PER_KM.ride).toBe(7);
    expect(config.BASE_GP_PER_KM.run).toBe(GAMEPLAY.BASE_GP_PER_KM.run);
  });

  it('tömbelemet is átír', () => {
    const { config } = resolveGameplay({ 'DEFENSE_MULTIPLIER.4': 8 });
    expect(config.DEFENSE_MULTIPLIER[4]).toBe(8);
  });

  it('logikai kapcsolót is átír', () => {
    const { config } = resolveGameplay({ TRUST_OBSERVE_ONLY: false });
    expect(config.TRUST_OBSERVE_ONLY).toBe(false);
  });
});

describe('resolveGameplay — amit eldob', () => {
  it('a nem hangolható kulcsot eldobja', () => {
    const { config, rejected } = resolveGameplay({ H3_RESOLUTION: 9 });

    expect(config.H3_RESOLUTION).toBe(GAMEPLAY.H3_RESOLUTION);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toContain('nem hangolható');
  });

  it('a szerkezeti konstansokat NEM engedi állítani', () => {
    const structural = ['H3_RESOLUTION', 'CELL_AREA_M2', 'MAX_DEFENSE', 'MIN_INTERIOR_CELLS', 'MIN_LOOP_STEPS'];
    for (const key of structural) {
      expect(tunableAt(key)).toBeUndefined();
    }
  });

  it('a rossz típust eldobja', () => {
    const { config, rejected } = resolveGameplay({ HOLD_GP_PER_KM2: 'sok' });
    expect(config.HOLD_GP_PER_KM2).toBe(GAMEPLAY.HOLD_GP_PER_KM2);
    expect(rejected[0]?.reason).toContain('számot vár');
  });

  it('a tört értéket eldobja ott, ahol egész kell', () => {
    const { rejected } = resolveGameplay({ STREAK_FREEZES_PER_WEEK: 1.5 });
    expect(rejected[0]?.reason).toContain('egész');
  });

  it('a tartományon kívüli értéket eldobja', () => {
    const { config, rejected } = resolveGameplay({ SOFT_CAP_RATE: 3 });
    expect(config.SOFT_CAP_RATE).toBe(GAMEPLAY.SOFT_CAP_RATE);
    expect(rejected[0]?.reason).toContain('nem lehet nagyobb');
  });

  it('a NaN-t és a végtelent eldobja', () => {
    const { config } = resolveGameplay({
      CLAIM_GP_PER_SQRT_KM2: Number.NaN,
      STEAL_BONUS: Number.POSITIVE_INFINITY,
    });
    expect(config.CLAIM_GP_PER_SQRT_KM2).toBe(GAMEPLAY.CLAIM_GP_PER_SQRT_KM2);
    expect(config.STEAL_BONUS).toBe(GAMEPLAY.STEAL_BONUS);
  });

  it('SOHA nem dob kivételt, akármi is van a dokumentumban', () => {
    expect(() =>
      resolveGameplay({
        'egészen.más.dolog': { mély: [1, 2, 3] },
        'BASE_GP_PER_KM.nincs_ilyen': 5,
        '': null,
      }),
    ).not.toThrow();
  });
});

describe('resolveGameplay — keresztellenőrzések', () => {
  it('a csökkenő védelmi létrát visszaállítja', () => {
    const { config, rejected } = resolveGameplay({ 'DEFENSE_MULTIPLIER.3': 1.2 });

    // 1,2 önmagában érvényes (1 és 20 között), de kisebb a 3-as szintnél (2,0).
    expect(config.DEFENSE_MULTIPLIER[3]).toBe(GAMEPLAY.DEFENSE_MULTIPLIER[3]);
    expect(rejected.some((r) => r.reason.includes('nem csökkenhet'))).toBe(true);
  });

  it('az 1-es védelem szorzója nem mozdítható el 1-ről', () => {
    const { config, rejected } = resolveGameplay({ 'DEFENSE_MULTIPLIER.0': 2 });
    expect(config.DEFENSE_MULTIPLIER[0]).toBe(1);
    expect(rejected.some((r) => r.path === 'DEFENSE_MULTIPLIER.0')).toBe(true);
  });

  it('az elutasítási küszöb nem mehet az elfogadási fölé', () => {
    const { config, rejected } = resolveGameplay({ TRUST_THRESHOLD_REJECT: 95 });
    expect(config.TRUST_THRESHOLD_REJECT).toBe(GAMEPLAY.TRUST_THRESHOLD_REJECT);
    expect(rejected.some((r) => r.path === 'TRUST_THRESHOLD_REJECT')).toBe(true);
  });

  it('a visszavont felülírás nem marad az `applied` listában', () => {
    const { applied } = resolveGameplay({ 'DEFENSE_MULTIPLIER.0': 2 });
    expect(applied['DEFENSE_MULTIPLIER.0']).toBeUndefined();
  });
});

describe('a séma maga', () => {
  it('minden hangolható útvonal létező konstansra mutat', () => {
    for (const spec of TUNABLES) {
      const value = spec.path
        .split('.')
        .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], GAMEPLAY);
      expect(value, `hiányzó konstans: ${spec.path}`).not.toBeUndefined();
    }
  });

  it('az alapérték minden kulcsnál BELEFÉR a saját tartományába', () => {
    // Enélkül az admin szerkesztő olyan mezőt mutatna, aminek a jelenlegi
    // értéke érvénytelen — és az első mentés csendben elmozdítaná.
    const { config } = resolveGameplay(null);
    for (const spec of TUNABLES) {
      if (spec.kind === 'boolean') continue;
      const value = spec.path
        .split('.')
        .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], config) as number;
      if (spec.min !== undefined) expect(value, spec.path).toBeGreaterThanOrEqual(spec.min);
      if (spec.max !== undefined) expect(value, spec.path).toBeLessThanOrEqual(spec.max);
    }
  });

  it('nincs két azonos útvonal', () => {
    const paths = TUNABLES.map((spec) => spec.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('minden kulcshoz tartozik magyar címke és magyarázat', () => {
    // Ez nem kozmetika: ugyanez a szöveg megy ki a felhasználói
    // szabálymagyarázó felületre.
    for (const spec of TUNABLES) {
      expect(spec.label.length, spec.path).toBeGreaterThan(0);
      expect(spec.help.length, spec.path).toBeGreaterThan(20);
    }
  });

  it('a csoportok összefüggőek, és lefedik az összes kulcsot', () => {
    const groups = tunableGroups();
    const names = groups.map((g) => g.group);
    expect(new Set(names).size, 'egy csoport kétszer szerepel a listában').toBe(names.length);
    expect(groups.reduce((sum, g) => sum + g.items.length, 0)).toBe(TUNABLES.length);
  });
});
