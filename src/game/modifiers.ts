/**
 * Időszakos szorzók (modifierek) — tiszta kiértékelés.
 *
 * A modifier egy időben korlátozott szorzó: „ezen a héten a XI. kerületben 2×
 * GP". Nem az `appConfig` átírásával készül, hanem külön dokumentumként —
 * mert a modifier élettartama KÖTELEZŐEN véges, tehát magától lejár. Erre épül
 * a későbbi automatikus esemény-generálás biztonsága: egy elszálló automatika
 * legrosszabb esetben is csak a lejáratig tud kárt okozni.
 *
 * Ez a fájl nem tud Firestore-ról. Megkapja a modifiereket és a kiértékeléshez
 * szükséges mintát, és visszaad egy szorzót — ugyanúgy, ahogy a motor többi
 * része.
 *
 * docs/06-architektura-es-admin.md → Modifierek — időszakos szorzók
 */

import { cellToParent } from 'h3-js';
import { DEFAULT_GAMEPLAY, type GameplayConfig } from '@/config/gameplay';
import type { CellId } from '@/types';

export type ModifierKind = 'gp_multiplier' | 'claim_multiplier' | 'hold_multiplier';
export type ModifierScope = 'global' | 'area' | 'segment';
export type ModifierSource = 'manual' | 'auto';

export interface Modifier {
  id: string;
  kind: ModifierKind;
  scope: ModifierScope;
  /** H3 cellák `MODIFIER_AREA_RES` felbontáson — csak `scope: 'area'` esetén. */
  areaCells?: readonly CellId[];
  /** Csak `scope: 'segment'` esetén. */
  segment?: { inactiveDays?: number };
  value: number;
  /** epoch ms — mindkettő kötelező */
  from: number;
  to: number;
  reason: string;
  source: ModifierSource;
}

/**
 * Egy minta a kiértékeléshez: egy H3 cella és az általa képviselt súly.
 *
 * Miért nem egyszerűen cellalista? Mert a két fogyasztónak más a szemcséje. Egy
 * aktivitásnál a res 12 cellák jönnek, egyenként 1 súllyal. A napi tartás-
 * bónusznál viszont a felhasználó teljes birodalma kellene — egy Balaton-kör
 * után kétmillió cella, naponta, minden felhasználóra. Ott a res 9 blokkok
 * mennek be, súlyként a bennük lévő cellák számával. Mivel a modifier-
 * felbontás durvább a blokkokénál, egy blokk pontosan egy modifier-cellába
 * esik, tehát az arány pontos marad.
 */
export interface AreaSample {
  cell: CellId;
  weight: number;
}

export interface ModifierContext {
  /** Területi modifierhez. Üres vagy hiányzó minta → a területi modifier nem hat. */
  samples?: readonly AreaSample[];
  /** Szegmens-modifierhez: hány napja nem volt aktivitás. */
  inactiveDays?: number;
}

export interface AppliedModifier {
  id: string;
  kind: ModifierKind;
  reason: string;
  /** a modifier névleges szorzója */
  value: number;
  /** mekkora arányban érintett (globálisnál 1) */
  share: number;
  /** a ténylegesen érvényesülő szorzó ezen a kiértékelésen */
  effective: number;
}

export interface ModifierResult {
  /** A kindre vonatkozó eredő szorzó, plafonozva. 1 = nincs hatás. */
  factor: number;
  applied: AppliedModifier[];
}

const NEUTRAL: ModifierResult = { factor: 1, applied: [] };

/** Érvényes-e a modifier alakilag? A hibás dokumentum nem hat, de nem is dob. */
export function isWellFormed(modifier: Modifier): boolean {
  return (
    typeof modifier.value === 'number' &&
    Number.isFinite(modifier.value) &&
    modifier.value >= 0 &&
    Number.isFinite(modifier.from) &&
    Number.isFinite(modifier.to) &&
    modifier.to > modifier.from
  );
}

/** Fut-e a modifier az adott pillanatban? A `from` beleértve, a `to` nem. */
export function isActive(modifier: Modifier, atMs: number): boolean {
  return isWellFormed(modifier) && atMs >= modifier.from && atMs < modifier.to;
}

export function activeModifiers(
  all: readonly Modifier[],
  atMs: number,
  kind?: ModifierKind,
): Modifier[] {
  return all.filter((m) => isActive(m, atMs) && (kind === undefined || m.kind === kind));
}

/**
 * Mekkora hányada esik a mintának a modifier területére?
 *
 * A minta cellái a modifier felbontására emelve hasonlítódnak össze. Ha a minta
 * cellája már eleve durvább a modifier felbontásánál, azt kihagyjuk: abból nem
 * lehet megmondani, a területen belül van-e, és a találgatás itt hamis
 * jóváírást jelentene.
 */
export function areaShare(
  modifier: Modifier,
  samples: readonly AreaSample[],
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): number {
  const area = modifier.areaCells;
  if (!area || area.length === 0 || samples.length === 0) return 0;

  const target = new Set(area);
  let inside = 0;
  let total = 0;

  for (const sample of samples) {
    const weight = Number.isFinite(sample.weight) ? Math.max(0, sample.weight) : 0;
    if (weight === 0) continue;
    total += weight;

    let parent: string;
    try {
      parent = cellToParent(sample.cell, cfg.MODIFIER_AREA_RES);
    } catch {
      // A minta durvább a modifier felbontásánál, vagy nem érvényes cella.
      continue;
    }
    if (target.has(parent)) inside += weight;
  }

  return total > 0 ? inside / total : 0;
}

/**
 * A modifierek eredője egy fajtára.
 *
 * A TERÜLETI MODIFIER ARÁNYOSAN HAT: ha a bezárt terület negyede esik a
 * bónuszterületre, a 2× szorzóból 1,25× lesz. Egy szabály, minden fajtára
 * ugyanaz, és a játékosnak elmondható — az „egészen belül vagy egészen kívül"
 * változat a határon futóknál önkényes lenne, és pont a határ mentén tolná a
 * viselkedést.
 *
 * Több modifier szorzói összeszorzódnak, az eredő a `MODIFIER_MAX_FACTOR`-ra
 * plafonozva.
 */
export function modifierFactor(
  modifiers: readonly Modifier[],
  kind: ModifierKind,
  context: ModifierContext = {},
  atMs: number = Date.now(),
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): ModifierResult {
  const candidates = activeModifiers(modifiers, atMs, kind);
  if (candidates.length === 0) return NEUTRAL;

  const applied: AppliedModifier[] = [];
  let factor = 1;

  for (const modifier of candidates) {
    let share: number;

    if (modifier.scope === 'global') {
      share = 1;
    } else if (modifier.scope === 'area') {
      share = areaShare(modifier, context.samples ?? [], cfg);
    } else {
      const needed = modifier.segment?.inactiveDays;
      const actual = context.inactiveDays;
      share =
        needed === undefined || (typeof actual === 'number' && actual >= needed) ? 1 : 0;
    }

    if (share <= 0) continue;

    // Arányos hatás: a szorzó a részesedés mértékében érvényesül.
    const effective = 1 + (modifier.value - 1) * share;
    factor *= effective;
    applied.push({
      id: modifier.id,
      kind: modifier.kind,
      reason: modifier.reason,
      value: modifier.value,
      share: round3(share),
      effective: round3(effective),
    });
  }

  if (applied.length === 0) return NEUTRAL;
  return { factor: Math.min(factor, cfg.MODIFIER_MAX_FACTOR), applied };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
