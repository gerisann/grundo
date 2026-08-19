/**
 * Az időszakos szorzók betöltése Firestore-ból.
 *
 * A kiértékelés a `src/game/modifiers.ts`-ben van (tiszta függvények); ez a
 * fájl csak beolvassa és normalizálja a dokumentumokat.
 *
 * docs/05-adatmodell.md → `modifiers/{id}`
 */

import { Timestamp } from 'firebase-admin/firestore';
import type { Modifier, ModifierKind, ModifierScope, ModifierSource } from '../../../src/game/modifiers';
import { COLLECTIONS, db } from './firebase';

const CACHE_TTL_MS = 60_000;

const KINDS: ReadonlySet<string> = new Set<ModifierKind>([
  'gp_multiplier',
  'claim_multiplier',
  'hold_multiplier',
]);
const SCOPES: ReadonlySet<string> = new Set<ModifierScope>(['global', 'area', 'segment']);

let cache: { modifiers: Modifier[]; loadedAt: number } | null = null;
let inFlight: Promise<Modifier[]> | null = null;

/** Csak teszthez. */
export function resetModifierCache(): void {
  cache = null;
  inFlight = null;
}

/**
 * A még le nem járt modifierek.
 *
 * A lejártakat a lekérdezés szűri, a még el nem kezdődötteket viszont
 * SZÁNDÉKOSAN behozzuk: a kiértékelés `isActive()`-je úgyis eldobja őket, a
 * gyorsítótár viszont így nem évül el menet közben egy most induló akció miatt.
 *
 * SOHA nem dob. Ha az olvasás elhasal, üres listát ad — a modifier extra,
 * nem alapszolgáltatás: egy elmaradt bónusz kellemetlen, egy elmaradt mentés
 * sokkal rosszabb.
 */
export async function getModifiers(now: Date = new Date()): Promise<Modifier[]> {
  if (cache && now.getTime() - cache.loadedAt < CACHE_TTL_MS) return cache.modifiers;
  if (inFlight) return inFlight;

  inFlight = loadModifiers(now)
    .then((modifiers) => {
      cache = { modifiers, loadedAt: Date.now() };
      return modifiers;
    })
    .catch((error: unknown) => {
      console.error('[modifiers] a modifierek olvasása nem sikerült', error);
      const fallback = cache?.modifiers ?? [];
      cache = { modifiers: fallback, loadedAt: Date.now() };
      return fallback;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

async function loadModifiers(now: Date): Promise<Modifier[]> {
  const snapshot = await db
    .collection(COLLECTIONS.modifiers)
    .where('to', '>', Timestamp.fromDate(now))
    .get();

  const modifiers: Modifier[] = [];
  for (const doc of snapshot.docs) {
    const parsed = parseModifier(doc.id, doc.data());
    if (parsed) modifiers.push(parsed);
  }
  return modifiers;
}

/**
 * Dokumentum → modifier, védekező olvasással.
 *
 * A `to` hiánya vagy érvénytelensége itt kiesés, nem alapértelmezés. A véges
 * élettartam nem konvenció, hanem az a tulajdonság, amire az automatikus
 * generálás biztonsága épül — egy „örökre szóló" modifier pont azt a garanciát
 * venné el.
 */
function parseModifier(id: string, data: Record<string, unknown>): Modifier | null {
  if (data.cancelledAt) return null;

  const kind = String(data.kind ?? '');
  const scope = String(data.scope ?? '');
  if (!KINDS.has(kind) || !SCOPES.has(scope)) return null;

  const from = toMillis(data.from);
  const to = toMillis(data.to);
  if (from === null || to === null || to <= from) return null;

  const value = Number(data.value);
  if (!Number.isFinite(value) || value < 0) return null;

  const areaCells = Array.isArray(data.areaCells)
    ? data.areaCells.filter((cell): cell is string => typeof cell === 'string')
    : undefined;
  if (scope === 'area' && (!areaCells || areaCells.length === 0)) return null;

  const inactiveDays = Number((data.segment as { inactiveDays?: unknown } | undefined)?.inactiveDays);

  return {
    id,
    kind: kind as ModifierKind,
    scope: scope as ModifierScope,
    areaCells,
    segment: Number.isFinite(inactiveDays) ? { inactiveDays } : undefined,
    value,
    from,
    to,
    reason: typeof data.reason === 'string' ? data.reason : '',
    source: data.source === 'auto' ? ('auto' as ModifierSource) : ('manual' as ModifierSource),
  };
}

function toMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}
