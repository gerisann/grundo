/**
 * AZ ÉLŐ ELŐNÉZET ELSZÁMOLÁSÁNAK ÚJRAFELHASZNÁLÁSA.
 *
 * ── A MÉRT PROBLÉMA ──────────────────────────────────────────────────────
 *
 * A `processActivityGeometry()` minden előnézet-frissítésnél a TELJES
 * hurokkészletre újraszámolja a körüljárást és a hurkonkénti foglalást, pedig
 * a korábbi bezárások eredménye nem változik. Mérve (GRUNDO #33, 24 km-es
 * városi nyomvonal, 9 hurok, 16 898 belső cella): hívásonként 40,4 ms — és a
 * hívás minden új H3 cellánál vagy 25 méterenként lefut, a főszálon.
 *
 * ── MIÉRT SZABAD ÚJRAHASZNÁLNI ───────────────────────────────────────────
 *
 * Az elszámolás bemenete NÉGY dolog: a hurkok, a birtokviszony, a
 * konfiguráció és a körüljárási térkép. Két bezárás KÖZÖTT az első három
 * változatlan, tehát ha a negyedik is az, az eredmény szükségképpen ugyanaz.
 *
 * A körüljárási térkép változatlanságát nem hisszük el, hanem ellenőrizzük,
 * és pontosan azon a három ponton, ahol egyáltalán megváltozhat:
 *
 *   1. ÚJ HUROK ZÁRT — új claim-cellák, más régiók. (A hurkok tömbje
 *      hozzáfűzéses, ezért az utolsó hurok OBJEKTUMAZONOSSÁGA elég a
 *      felismeréshez; ha a geometria újraépült, minden hurok új objektum.)
 *   2. A NYOMVONAL BELÉPETT EGY MÁR MEGSZERZETT CELLÁBA — az a cella
 *      átkerül a „régión kívüli" halmazból a falba, és a régió akár ketté is
 *      válhat.
 *   3. ÚJ KÖRT TETT MEG A JÁTÉKOS — ilyenkor a régió képviselőjén mért
 *      körüljárás nő. Ezt régiónként újraszámoljuk; ez a nyomvonal hosszával
 *      arányos, de régiónként EGY mérés (9 huroknál 12 régió ≈ 1 ms), nem a
 *      teljes elszámolás.
 *
 * Ha mindhárom feltétel áll, a foglalás eredménye bitre ugyanaz — csak a
 * GP-t számoljuk újra, mert az a megtett távolsággal együtt nő.
 *
 * ⚠️ A SZERVER NEM HASZNÁLJA. A hiteles feldolgozás továbbra is egyetlen
 * batch `processActivity()` hívás; ez az osztály kizárólag az élő előnézet
 * ISMÉTLŐDŐ hívásait olcsóbbá teszi. Cache-tévesztéskor pontosan ugyanaz a
 * `processActivityGeometry()` fut, mint eddig — az eredmény tehát sosem egy
 * párhuzamos megvalósításból származik.
 *
 * KÖZÖS MODUL: se DOM, se Firebase, se Node API.
 */

import { DEFAULT_GAMEPLAY, type GameplayConfig } from '@/config/gameplay';
import type { CellId, DetectedLoop, OwnershipMap } from '@/types';
import type { ActivityGeometry, ProcessInput, ProcessResult, ProcessTrace } from './index';
import { processActivityGeometry } from './index';
import { hasCompactInterior } from './loopInterior';
import { computeActivityGp } from './scoring';
import { encirclementsFor, type WindingRegion } from './winding';

interface ClaimCache {
  actorId: string;
  type: ProcessInput['type'];
  cfg: GameplayConfig | undefined;
  ownership: OwnershipMap;
  loopCount: number;
  lastLoop: DetectedLoop;
  pathLength: number;
  firstPathCell: CellId;
  lastPathCell: CellId;
  /**
   * A nyomvonal cellái HALMAZKÉNT — a körüljárás csak így használja őket.
   *
   * Ezért nem az számít, hogy a játékos visszalépett-e egy már megszerzett
   * cellába, hanem hogy OLYAN cellába lépett-e, amelyik eddig NEM volt a
   * nyomvonalon. Egy már bejárt utcán visszasétálva a halmaz változatlan,
   * tehát a régiók is azok.
   *
   * (Mérve a 24 km-es városi fixture-ön: ez a megkülönböztetés ott mindössze
   * 72→75 találatot hozott, mert a tévesztések nem innen jönnek — de a
   * szigorúbb feltétel fölöslegesen dobná el a hosszú, oda-vissza szakaszokat.)
   */
  onPath: Set<CellId>;
  claimedCells: ReadonlySet<CellId>;
  representatives: CellId[];
  turns: number[];
  result: ProcessResult;
}

export class IncrementalActivityClaims {
  private cache: ClaimCache | null = null;

  /** Hányszor lehetett újrahasználni, illetve hányszor kellett újraszámolni — méréshez. */
  private hitCount = 0;
  private missCount = 0;

  get stats(): { hits: number; misses: number } {
    return { hits: this.hitCount, misses: this.missCount };
  }

  reset(): void {
    this.cache = null;
    this.hitCount = 0;
    this.missCount = 0;
  }

  update(input: ProcessInput, geometry: ActivityGeometry): ProcessResult {
    const cache = this.cache;
    if (cache !== null && this.isReusable(cache, input, geometry)) {
      this.hitCount += 1;
      advanceTo(cache, geometry.cellPath);
      return withCurrentCall(cache.result, input, geometry);
    }

    this.missCount += 1;
    const trace: ProcessTrace = {};
    const result = processActivityGeometry(input, geometry, trace);
    this.cache = this.remember(input, geometry, result, trace.windingRegions);
    return result;
  }

  private isReusable(
    cache: ClaimCache,
    input: ProcessInput,
    geometry: ActivityGeometry,
  ): boolean {
    if (
      input.actorId !== cache.actorId
      || input.type !== cache.type
      || input.cfg !== cache.cfg
      || input.ownership !== cache.ownership
      || input.orphanScope !== undefined
      || input.modifierFactors !== undefined
    ) return false;

    const loops = geometry.loops;
    if (loops.length !== cache.loopCount) return false;
    if (loops[loops.length - 1] !== cache.lastLoop) return false;

    // A nyomvonal csak FOLYTATÓDHATOTT. A cellaazonosító string, ezért a
    // két végpont egyezése az olcsó ellenőrzés; ha a lánc újraépült, a
    // hurokobjektumok azonossága már fentebb elbukott volna.
    const path = geometry.cellPath;
    if (path.length < cache.pathLength) return false;
    if (path[0] !== cache.firstPathCell) return false;
    if (path[cache.pathLength - 1] !== cache.lastPathCell) return false;

    /**
     * ÚJ claim-cellára lépve a fal és a régiók átrendeződnek: a cella
     * átkerül a régióból a falba, és a régió ketté is válhat. A már bejárt
     * cellák ismételt érintése viszont nem változtat a nyomvonal HALMAZÁN,
     * tehát a régiókon sem.
     */
    for (let index = cache.pathLength; index < path.length; index += 1) {
      const cell = path[index]!;
      if (!cache.onPath.has(cell) && cache.claimedCells.has(cell)) return false;
    }

    if (path.length === cache.pathLength) return true;

    // Új kör: a régió képviselőjén mért körüljárás megnőhetett.
    const turns = encirclementsFor(path, cache.representatives);
    for (let index = 0; index < turns.length; index += 1) {
      if (turns[index] !== cache.turns[index]) return false;
    }
    return true;
  }

  private remember(
    input: ProcessInput,
    geometry: ActivityGeometry,
    result: ProcessResult,
    regions: WindingRegion[] | undefined,
  ): ClaimCache | null {
    const loops = geometry.loops;
    const lastLoop = loops[loops.length - 1];
    const firstPathCell = geometry.cellPath[0];
    const lastPathCell = geometry.cellPath[geometry.cellPath.length - 1];

    /**
     * Hurok nélkül nincs mit megőrizni (a hívás amúgy is ~1 ms), compact
     * huroknál pedig az elszámolás külön, blokkos úton megy — oda ez a
     * gyorsítótár nem való. Régiók nélkül sincs mit ellenőrizni.
     */
    if (
      lastLoop === undefined
      || firstPathCell === undefined
      || lastPathCell === undefined
      || regions === undefined
      || input.orphanScope !== undefined
      || input.modifierFactors !== undefined
      || loops.some(hasCompactInterior)
    ) return null;

    return {
      actorId: input.actorId,
      type: input.type,
      cfg: input.cfg,
      ownership: input.ownership,
      loopCount: loops.length,
      lastLoop,
      pathLength: geometry.cellPath.length,
      firstPathCell,
      lastPathCell,
      onPath: new Set(geometry.cellPath),
      claimedCells: new Set(result.claimedCells),
      representatives: regions.map((region) => region.representative),
      turns: regions.map((region) => region.turns),
      result,
    };
  }
}

/**
 * A gyorsítótár állapotát a MOST ellenőrzött nyomvonalhoz igazítja.
 *
 * Az ellenőrzés kimondta, hogy a hosszabb nyomvonalon ugyanaz a körüljárás
 * jön ki, tehát a megőrzött eredmény erre a nyomvonalra is érvényes. Ha ezt
 * nem írnánk vissza, a következő hívás megint a régi hosszhoz képest nézné az
 * új cellákat — ugyanazt a szakaszt sokszor ellenőriznénk.
 */
function advanceTo(cache: ClaimCache, path: readonly CellId[]): void {
  for (let index = cache.pathLength; index < path.length; index += 1) {
    cache.onPath.add(path[index]!);
  }
  const lastPathCell = path[path.length - 1];
  if (lastPathCell !== undefined) {
    cache.pathLength = path.length;
    cache.lastPathCell = lastPathCell;
  }
}

/**
 * A megőrzött eredmény a MOSTANI híváshoz igazítva.
 *
 * A foglalás változatlan, de a nyomvonal hosszabb lett: a megjelenítendő
 * cellalánc, a diagnosztika és a távolságból jövő GP a friss hívásé.
 */
function withCurrentCall(
  cached: ProcessResult,
  input: ProcessInput,
  geometry: ActivityGeometry,
): ProcessResult {
  const cfg = input.cfg ?? DEFAULT_GAMEPLAY;
  return {
    ...cached,
    cellPath: geometry.cellPath,
    gp: computeActivityGp(
      {
        type: input.type,
        distanceKm: input.distanceKm,
        claim: cached.claim,
        streakDays: input.streakDays,
        gpEarnedToday: input.gpEarnedToday,
        modifierFactors: input.modifierFactors,
      },
      cfg,
    ),
    diagnostics: {
      ...cached.diagnostics,
      droppedPoints: geometry.droppedPoints,
      largeGaps: geometry.largeGaps,
      loops: geometry.loopDiagnostics,
    },
  };
}
