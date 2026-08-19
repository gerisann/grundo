/**
 * Birtoklási szabályok — cellánként.
 *
 * Nincs külön "kiharapás" és "bekebelezés" szabály: mindkettő ugyanennek a
 * cellánkénti eljárásnak a következménye.
 *
 * docs/03-jatekszabalyok.md → Birtoklási szabályok
 */

import { DEFAULT_GAMEPLAY, type GameplayConfig } from '@/config/gameplay';
import { gridDisk } from 'h3-js';
import type { CellFate, CellId, CellOwnership, ClaimResult, OwnershipMap } from '@/types';
export type { ClaimResult };

/**
 * @param claimed   a bezárásokból megszerzett cellák (fal + belső)
 * @param current   a claim által érintett cellák JELENLEGI tulajdonviszonya
 *                  (a hívó tölti fel — a szerveren a `grid` blokkokból)
 * @param actorId   aki a foglalást végzi
 * @param cfg       a futásidejű játékkonfiguráció pillanatképe. Alapértelmezésben
 *                  a statikus alapérték — a szerver az `appConfig/gameplay`-ből
 *                  feloldott változatot adja át, és EGY aktivitáson belül végig
 *                  ugyanazt.
 */
export function resolveClaim(
  claimed: ReadonlySet<CellId>,
  current: OwnershipMap,
  actorId: string,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): ClaimResult {
  const updates = new Map<CellId, CellOwnership>();
  const fates = new Map<CellId, CellFate>();
  const counts: Record<CellFate, number> = {
    free: 0, reclaimed: 0, stolen: 0, breakthrough: 0,
  };
  const stolenFrom: Record<string, number> = {};
  let weightedCells = 0;
  let gainedCells = 0;

  for (const cell of claimed) {
    const held = current.get(cell);

    // ── Szabad cella ──────────────────────────────────────────────────────
    if (held === undefined) {
      updates.set(cell, { owner: actorId, defense: 1 });
      fates.set(cell, 'free');
      counts.free++;
      weightedCells += multiplierFor(1, cfg);
      gainedCells++;
      continue;
    }

    // ── Saját cella: a védelem nő ─────────────────────────────────────────
    if (held.owner === actorId) {
      const defense = Math.min(held.defense + 1, cfg.MAX_DEFENSE);
      updates.set(cell, { owner: actorId, defense });
      fates.set(cell, 'reclaimed');
      counts.reclaimed++;
      // A szorzó az ÚJ védelmi szint szerint jár — ez a körbe-körbe futás jutalma.
      weightedCells += multiplierFor(defense, cfg);
      continue;
    }

    // ── Idegen cella, védelem nélkül: elvesszük ───────────────────────────
    if (held.defense <= 1) {
      updates.set(cell, { owner: actorId, defense: 1 });
      fates.set(cell, 'stolen');
      counts.stolen++;
      stolenFrom[held.owner] = (stolenFrom[held.owner] ?? 0) + 1;
      weightedCells += multiplierFor(1, cfg);
      gainedCells++;
      continue;
    }

    // ── Idegen cella, védve: nem cserél gazdát, de a védelem csökken ──────
    updates.set(cell, { owner: held.owner, defense: held.defense - 1 });
    fates.set(cell, 'breakthrough');
    counts.breakthrough++;
    stolenFrom[held.owner] = stolenFrom[held.owner] ?? 0; // a károsult értesül
  }

  return {
    updates,
    fates,
    counts,
    stolenFrom,
    weightedClaimM2: weightedCells * cfg.CELL_AREA_M2,
    gainedM2: gainedCells * cfg.CELL_AREA_M2,
  };
}

/** Védelmi szorzó az adott (új) védelmi szinthez. */
export function multiplierFor(defense: number, cfg: GameplayConfig = DEFAULT_GAMEPLAY): number {
  const index = Math.min(Math.max(defense, 1), cfg.MAX_DEFENSE) - 1;
  return cfg.DEFENSE_MULTIPLIER[index] ?? 1;
}

/**
 * Az aktivitás után magára maradt, egyetlen 1-es rivális mező felszívása.
 *
 * A GPS-hiba miatt előfordulhat, hogy egy nagyobb, frissen megszerzett folt
 * szélén egyetlen rivális hex marad úgy, hogy a saját tulajdonosának egyetlen
 * másik mezőjéhez sem kapcsolódik. Csak ezt az egycellás maradványt vesszük
 * át; a 2–5-ös védelem továbbra is a normál áttörési szabályt követi.
 *
 * `scope`-nak a geometriai claim KÉTGYŰRŰS környezetét kell tartalmaznia.
 * Így minden vizsgált szomszéd teljes egygyűrűs környezete ismert, és egy
 * hiányzó adatot nem tévesztünk össze szabad mezővel.
 */
export function absorbIsolatedRivalCells(
  claim: ClaimResult | null,
  before: OwnershipMap,
  actorId: string,
  scope: ReadonlySet<CellId>,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): { claim: ClaimResult | null; absorbed: Set<CellId> } {
  const absorbed = new Set<CellId>();
  if (!claim) return { claim, absorbed };

  const state: OwnershipMap = new Map(before);
  for (const [cell, ownership] of claim.updates) state.set(cell, ownership);

  const newlyAcquired = [...claim.fates]
    .filter(([, fate]) => fate === 'free' || fate === 'stolen')
    .map(([cell]) => cell);
  if (newlyAcquired.length === 0) return { claim, absorbed };
  const newlyAcquiredSet = new Set(newlyAcquired);

  const candidates = new Set<CellId>();
  for (const acquired of newlyAcquired) {
    for (const near of gridDisk(acquired, 1)) {
      if (near !== acquired) candidates.add(near);
    }
  }

  for (const candidate of candidates) {
    if (!scope.has(candidate) || claim.updates.has(candidate)) continue;
    const held = state.get(candidate);
    if (!held || held.owner === actorId || held.defense !== 1) continue;

    const neighbours = gridDisk(candidate, 1).filter((cell) => cell !== candidate);
    if (!neighbours.every((cell) => scope.has(cell))) continue;
    if (neighbours.some((cell) => state.get(cell)?.owner === held.owner)) continue;
    if (!neighbours.some((cell) => newlyAcquiredSet.has(cell))) continue;

    absorbed.add(candidate);
  }

  if (absorbed.size === 0) return { claim, absorbed };

  const updates = new Map(claim.updates);
  const fates = new Map(claim.fates);
  const counts = { ...claim.counts };
  const stolenFrom = { ...claim.stolenFrom };

  for (const cell of absorbed) {
    const previous = state.get(cell)!;
    updates.set(cell, { owner: actorId, defense: 1 });
    fates.set(cell, 'stolen');
    counts.stolen += 1;
    stolenFrom[previous.owner] = (stolenFrom[previous.owner] ?? 0) + 1;
  }

  return {
    absorbed,
    claim: {
      updates,
      fates,
      counts,
      stolenFrom,
      weightedClaimM2:
        claim.weightedClaimM2 + absorbed.size * multiplierFor(1, cfg) * cfg.CELL_AREA_M2,
      gainedM2: claim.gainedM2 + absorbed.size * cfg.CELL_AREA_M2,
    },
  };
}

/**
 * Több bezárás eredményének összefésülése egyetlen aktivitásra.
 *
 * FONTOS: a bezárásokat SORBAN kell feldolgozni, mindegyiket az előző által
 * frissített állapot ellen — nem egyetlen egyesített cellahalmazként.
 * Különben ugyanaz a kör négyszer megfutva csak egyszer számítana, és a
 * védelemépítés (1× → 4×) sosem történne meg.
 *
 * A számlálók összeadódnak: ha egy cella az első körben szabad volt, a
 * másodikban pedig már a sajátod, akkor mindkét körben megkapja a maga
 * pontját — pontosan ezt írja le a 04. fejezet C) példája.
 */
/**
 * Több bezárás eredményének összefésülése — CELLÁNKÉNT EGYSZER.
 *
 * Ez a függvény korábban hurkonként ÖSSZEGEZTE a súlyozott területet. Tiszta,
 * ismételt körnél ez helyes eredményt adott (minden kör külön hurok, alig
 * fedik egymást), egy valódi városi útvonalon viszont a hurkok erősen
 * átfedik egymást: ugyanaz a cella tíz-húsz hurok falában és belsejében is
 * benne van, és mindannyiszor fizetett.
 *
 * Élesben ez 149 666 GP-t adott egy 11 km-es bringaútra — nagyjából
 * hatvanötszörösét a valóságnak.
 *
 * Mostantól a végső állapotból számolunk: minden cella EGYSZER számít, azon a
 * védelmi szinten, ahová az aktivitás végén került. A körbe-körbe futás
 * jutalma megmarad — a védelem 5-ig nő, és az 5× szorzót hozza —, de a
 * jutalom a védelmi szintből jön, nem a hurkok darabszámából. Így felülről
 * korlátos, és el is magyarázható a felhasználónak.
 */
export function mergeClaims(
  results: readonly ClaimResult[],
  /** Az aktivitás ELŐTTI birtokviszony. */
  before: OwnershipMap,
  actorId: string,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): ClaimResult {
  const updates = new Map<CellId, CellOwnership>();
  const fates = new Map<CellId, CellFate>();
  const stolenFrom: Record<string, number> = {};

  // A későbbi hurok felülírja a korábbit: a cella VÉGSŐ állapota számít.
  for (const result of results) {
    for (const [cell, ownership] of result.updates) updates.set(cell, ownership);
  }

  const counts: Record<CellFate, number> = {
    free: 0, reclaimed: 0, stolen: 0, breakthrough: 0,
  };
  let weightedClaimM2 = 0;
  let gainedM2 = 0;

  for (const [cell, after] of updates) {
    const previousOwner = before.get(cell)?.owner;

    /**
     * A cella sorsát az ELŐTTE és UTÁNA állapotból határozzuk meg, nem abból,
     * mi történt vele az utolsó hurokban.
     *
     * Miért? Mert egy négy körös futásnál a cella az első körben szabadként
     * kerül hozzánk, a többiben pedig már „újrafoglalás" — a végső sors
     * szerint tehát semmit nem szereztünk, pedig dehogynem. A kérdés nem az,
     * mi történt utoljára, hanem hogy kié volt az aktivitás előtt és kié utána.
     */
    const fate: CellFate =
      after.owner !== actorId
        ? 'breakthrough'
        : previousOwner === undefined
          ? 'free'
          : previousOwner === actorId
            ? 'reclaimed'
            : 'stolen';

    fates.set(cell, fate);
    counts[fate] += 1;

    if (fate === 'breakthrough') {
      // Nem a miénk: igénypont nem jár rá, de a károsult értesül róla.
      if (previousOwner !== undefined) stolenFrom[previousOwner] ??= 0;
      continue;
    }

    // CELLÁNKÉNT EGYSZER, a végső védelmi szinten. Korábban hurkonként
    // összegeztünk, és egy valódi útvonalon az erősen átfedő hurkok miatt
    // ugyanaz a cella tízszer is fizetett — élesben 149 666 GP jött ki egy
    // 11 km-es bringaútra.
    weightedClaimM2 += multiplierFor(after.defense, cfg) * cfg.CELL_AREA_M2;

    if (fate === 'free' || fate === 'stolen') gainedM2 += cfg.CELL_AREA_M2;
    if (fate === 'stolen' && previousOwner !== undefined) {
      stolenFrom[previousOwner] = (stolenFrom[previousOwner] ?? 0) + 1;
    }
  }

  return { updates, fates, counts, stolenFrom, weightedClaimM2, gainedM2 };
}
