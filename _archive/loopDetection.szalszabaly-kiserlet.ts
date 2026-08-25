import { gridDisk } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import type {
  CellId,
  DetectedLoop,
  LoopDiagnostics,
  RejectedLoopDiagnostic,
} from '@/types';
import { LoopTooLargeError, pruneDeadEnds } from './loops';
import {
  buildLoopInterior,
  loopInteriorCellCount,
  loopInteriorHas,
  loopInteriorOverlapCount,
} from './loopInterior';

interface AcceptedLoopRecord {
  loop: DetectedLoop;
  /** Az a traversal-index, ahol ezt a geometriai hurkot jóváírtuk. */
  toIndex: number;
}

/**
 * Egyetlen H3 kontaktfolt több egymás melletti korábbi cellát is érinthet.
 * Ezek a pathon jellemzően néhány indexen belül vannak, de geometriában ugyanazt
 * a kereszteződést jelentik. Ha mindegyiket külön jelöltként futtatjuk, ugyanarra
 * a fizikai találkozásra 2–6× Tarjan + flood fill indul.
 *
 * A 6 index elég tág egy res12 kontaktfolthoz, de több külön kör / külön korábbi
 * áthaladás tipikusan nagyságrendekkel távolabb van a pathon, tehát azok nem
 * olvadnak össze.
 */
const CONTACT_INDEX_CLUSTER_GAP = 6;

/**
 * Ismételt, tényleges új traversalnál ekkora H3-kvantálási eltérést tekintünk
 * ugyanannak a fizikai huroknak. Ez nem deduplikálja a bezárást: a defense nő,
 * csak nem engedi, hogy ugyanaz a kör 1-2 kapucella jitter miatt terjeszkedjen.
 */
const REPEAT_CANONICAL_MAX_SYMMETRIC_DIFF = 2;

/**
 * Egy bezárás falának legalább ekkora hányada legyen FRISSEN bejárt szakasz.
 *
 * Ez a detektor egyetlen anti-farm őrszeme. A gondolat: egy hurok akkor új,
 * ha a kerületének a nagy részét a játékos most járta be — nem akkor, ha egy
 * régi fal mellett kilépett két cellát, és a flood fill ismét ugyanazt a
 * régiót találta meg.
 *
 * Miért a fal ARÁNYÁHOZ mérünk, és nem index-ablakhoz: az index-ablak a bejárás
 * irányától függ (ezt váltottuk le), a fal aránya viszont a jelölt SAJÁT
 * tulajdonsága. Mérve: enélkül egy ötkörös futás 214 bezárást adott, egy 100 m-es
 * oda-vissza rávezető pedig 9-et egy helyett.
 */
const MIN_FRESH_WALL_SHARE = 0.5;

export interface IncrementalLoopSnapshot {
  loops: DetectedLoop[];
  diagnostics: LoopDiagnostics;
}

/**
 * Állapottartó, inkrementális hurokdetektor.
 *
 * A korábbi batch algoritmus minden preview-frissítésnél az egész addigi
 * aktivitást újraszámolta. Ez kis útvonalon is egyre drágább lett, főleg egy
 * már bejárt fal mellett, ahol minden új cella több korábbi kontaktból képezhet
 * hurokjelöltet.
 *
 * Ez az osztály pontosan ugyanazt a döntési logikát használja, de egy új H3
 * cella érkezésekor CSAK az új cella által létrehozott jelölteket vizsgálja.
 * A `detectLoopsDetailed()` lent kompatibilis batch wrapper marad.
 */
export class IncrementalLoopDetector {
  private readonly path: CellId[] = [];
  private readonly loops: DetectedLoop[] = [];
  private readonly successful: LoopDiagnostics['successful'] = [];
  private readonly rejected: RejectedLoopDiagnostic[] = [];
  private shortRevisits = 0;

  private readonly seenAt = new Map<CellId, number[]>();
  private readonly accepted: AcceptedLoopRecord[] = [];

  /**
   * A NYITOTT SZÁL: melyik path-indexeket nyelte már el egy lezárt hurok.
   *
   * Amikor egy hurok bezárul, a bezárás KIVÁGJA magát a szálból: a kapu és a
   * bezárás közötti szakasz elhasználódik, és a szál a kapunál folytatódik
   * tovább. Ez a klasszikus hurok-kivágás, és pontosan azt írja le, amit a
   * játékos csinál — bezárta a kört, onnan megy tovább.
   *
   * FONTOS, hogy csak a hurok szakasza vész el, a KAPU ELŐTTI rész nem: egy
   * nagy kör közben bezáruló kis lebeny nem teheti tönkre a nagy kört. (A
   * naiv „a bezárás után minden korábbi index tilos" alak épp ezt vitte el:
   * a `7.4` teszt kék területe 2× helyett 1×-en maradt.)
   *
   * Ez váltotta le a korábbi „closure zone" tiltást, ami index-ablakkal és a
   * fal 75%-ával döntött. Az index-ablak a bejárás irányától függ — ugyanaz a
   * geometria oda hat, vissza két bezárást adott.
   */
  private readonly consumed: boolean[] = [];

  /** A már lezárt hurkok falai — ezekre a szál elhasznált szakaszon is bezárulhat. */
  private readonly acceptedWallCells = new Set<CellId>();

  /** Minden eddig bekerített cella (fal + belső) — az „új terület" próbához. */
  private readonly enclosed = new Set<CellId>();

  /** Hány H3 cellát dolgoztunk már fel. */
  get length(): number {
    return this.path.length;
  }

  /**
   * Használható-e egy adott cella korábbi előfordulása kapuként.
   * A nyitott szálon mindig; elhasznált szakaszon csak lezárt falon.
   */
  private gateFilter(cell: CellId): (index: number) => boolean {
    const onOldWall = this.acceptedWallCells.has(cell);
    return (index) => onOldWall || this.consumed[index] !== true;
  }

  /**
   * Egy új, már összefüggő cellalánc-elemet dolgoz fel.
   * Visszatérési érték: keletkezett-e ezen a lépésen új elfogadott hurok.
   */
  append(cell: CellId): boolean {
    const i = this.path.length;
    this.path.push(cell);

    const sameHistory = this.seenAt.get(cell) ?? [];
    const latestSame = sameHistory[sameHistory.length - 1];

    if (latestSame !== undefined && i - latestSame < GAMEPLAY.MIN_LOOP_STEPS) {
      this.shortRevisits += 1;
    }

    /**
     * A mostani cella saját korábbi előfordulásai és a hat élszomszéd korábbi
     * előfordulásai lehetnek kapuk. Cellánként legfeljebb a három legfrissebb
     * strukturálisan érvényes előzményt tartjuk meg.
     *
     * Kapu csak a NYITOTT szálon lehet: amit egy korábbi bezárás elnyelt, azt
     * a játékosnak újra be kell járnia.
     *
     * EGYETLEN KIVÉTEL: egy MÁR LEZÁRT HUROK FALA. A 03. fejezet kifejezetten
     * engedi, hogy a korábban megszerzett terület széle egy új hurok egyik
     * oldala legyen — egy kifelé tartó spirál például soha nem éri el önmagát,
     * csak az előző kör falát. E kivétel nélkül mérve a spirál 25 és 35 m/kör
     * esetén a bejárási iránytól függően 34%, illetve 38% területeltérést adott.
     */
    const candidates = new Set<number>();
    addRecentEligible(sameHistory, i, this.gateFilter(cell), candidates);
    for (const near of gridDisk(cell, 1)) {
      if (near === cell) continue;
      addRecentEligible(this.seenAt.get(near) ?? [], i, this.gateFilter(near), candidates);
    }

    /**
     * Egy H3 kereszteződés több egymás melletti korábbi cellát érinthet. Ezeket
     * egyetlen kontaktfolttá vonjuk össze, és a korábbi viselkedéssel egyezően
     * a legfrissebb indexet próbáljuk. Külön korábbi áthaladások a nagyobb
     * indexkülönbség miatt külön jelöltek maradnak.
     */
    const candidateIndices = clusterCandidateIndices(candidates);

    for (const previous of candidateIndices) {
      const rawWall = new Set(this.path.slice(previous, i + 1));
      const wall = pruneDeadEnds(rawWall);
      const prunedCells = Math.max(0, rawWall.size - wall.size);

      /** A jelölt szakaszából mennyi az, amit még nem nyelt el korábbi bezárás. */
      let freshSteps = 0;
      for (let k = previous; k <= i; k += 1) {
        if (this.consumed[k] !== true) freshSteps += 1;
      }

      let interiorGeometry: ReturnType<typeof buildLoopInterior>;
      try {
        interiorGeometry = buildLoopInterior(wall);
      } catch (err) {
        if (err instanceof LoopTooLargeError) {
          this.rejected.push({
            reason: 'too_large',
            fromIndex: previous,
            toIndex: i,
            wallCells: wall.size,
            interiorCells: 0,
            prunedCells,
            candidateCells: err.candidateCells,
          });
          continue;
        }
        throw err;
      }

      if (interiorGeometry.cellCount < GAMEPLAY.MIN_INTERIOR_CELLS) {
        this.rejected.push({
          reason: 'interior_too_small',
          fromIndex: previous,
          toIndex: i,
          wallCells: wall.size,
          interiorCells: interiorGeometry.cellCount,
          prunedCells,
        });
        continue;
      }

      let candidate: DetectedLoop = {
        wall,
        interior: interiorGeometry.interior,
        ...(interiorGeometry.compactInterior
          ? { compactInterior: interiorGeometry.compactInterior }
          : {}),
        fromIndex: previous,
        toIndex: i,
      };

      /**
       * Ha egy már lezárt fal mellett haladva a nyom csak egy egysoros, két
       * dimenziós mag nélküli slivert csíp le, az nem új játékterület.
       *
       * Tipikus eset: bezártuk a négyzetet, majd a régi fal mellett kifelé
       * haladunk. A H3 szomszédság 1-2 belső cellás mesterséges „hurkot” látna,
       * pedig ez csak a cellakvantálásból adódó kilógó érintés. Valódi új lobe,
       * amelyik a régi falat használja egyik oldalként, továbbra is számít,
       * amint van tényleges 2D belső magja.
       */
      if (isThinSliverAlongOldWall(candidate, this.accepted)) {
        continue;
      }

      // Tényleges új lapnál a bezárás megmarad, de egy 1-2 cellás H3-kapu
      // jitter ne növelje lassan a területet minden körrel.
      candidate = canonicalizeNearIdenticalRepeat(candidate, this.accepted);

      /**
       * ÚJ BEZÁRÁS = FRISSEN BEJÁRT KERÜLET.
       *
       * A hurok fala részben állhat korábban már elhasznált szakaszból — a 03.
       * fejezet kifejezetten engedi, hogy a saját terület széle egy új hurok
       * egyik oldala legyen. De ha a fal TÚLNYOMÓ része régi, akkor a játékos
       * nem járt körbe semmit, csak hozzáért a saját falához.
       */
      if (freshSteps < GAMEPLAY.MIN_LOOP_STEPS
        || freshSteps < wall.size * MIN_FRESH_WALL_SHARE) {
        this.rejected.push({
          reason: 'interior_too_small',
          fromIndex: previous,
          toIndex: i,
          wallCells: candidate.wall.size,
          interiorCells: loopInteriorCellCount(candidate),
          prunedCells,
        });
        continue;
      }

      this.loops.push(candidate);
      this.successful.push({
        fromIndex: previous,
        toIndex: i,
        wallCells: candidate.wall.size,
        interiorCells: loopInteriorCellCount(candidate),
        prunedCells,
      });
      this.accepted.push({ loop: candidate, toIndex: i });
      for (const wallCell of candidate.wall) {
        this.acceptedWallCells.add(wallCell);
        this.enclosed.add(wallCell);
      }
      if (!candidate.compactInterior) {
        for (const inner of candidate.interior) this.enclosed.add(inner);
      }
      // A bezárás kivágja magát a szálból; a kapu előtti rész nyitva marad.
      for (let k = previous + 1; k <= i; k += 1) this.consumed[k] = true;
      noteVisit(this.seenAt, cell, i);
      return true;
    }

    noteVisit(this.seenAt, cell, i);
    return false;
  }

  appendMany(cells: readonly CellId[]): number {
    let addedLoops = 0;
    for (const cell of cells) {
      if (this.append(cell)) addedLoops += 1;
    }
    return addedLoops;
  }

  snapshot(): IncrementalLoopSnapshot {
    return {
      loops: [...this.loops],
      diagnostics: {
        successful: [...this.successful],
        rejected: [...this.rejected],
        shortRevisits: this.shortRevisits,
      },
    };
  }
}

/**
 * Hurokdetektor átfedő és egymásba kapcsolódó bezárásokhoz.
 *
 * A H3-on egy fizikai útvonal-találkozás nem egy matematikai pont, hanem több
 * cellából álló kontaktfolt. Ráadásul egy már bezárt régió peremén/belsejében
 * továbbhaladva ugyanabból az útvonalból több, egyre nagyobb kompozit ciklus is
 * levezethető. Ezek gráfelméletileg létező ciklusok, de a játék szempontjából
 * NEM külön bezárási események.
 *
 * A batch API kompatibilitásból megmarad, de belül ugyanazt az inkrementális
 * állapotgépet eteti végig pontosan egyszer.
 */
export function detectLoopsDetailed(path: readonly CellId[]): {
  loops: DetectedLoop[];
  diagnostics: LoopDiagnostics;
} {
  const detector = new IncrementalLoopDetector();
  detector.appendMany(path);
  return detector.snapshot();
}

export function detectLoops(path: readonly CellId[]): DetectedLoop[] {
  return detectLoopsDetailed(path).loops;
}

function noteVisit(history: Map<CellId, number[]>, cell: CellId, index: number): void {
  const visits = history.get(cell);
  if (visits) visits.push(index);
  else history.set(cell, [index]);
}

function addRecentEligible(
  history: readonly number[],
  currentIndex: number,
  eligible: (index: number) => boolean,
  target: Set<number>,
): void {
  let added = 0;
  for (let i = history.length - 1; i >= 0 && added < 3; i -= 1) {
    const index = history[i]!;
    if (currentIndex - index < GAMEPLAY.MIN_LOOP_STEPS) continue;
    if (!eligible(index)) continue;
    target.add(index);
    added += 1;
  }
}

/**
 * Ugyanahhoz a fizikai H3 kontaktfolthoz tartozó path-indexeket összevonja.
 * A lista csökkenő sorrendű, minden klaszterből a legfrissebb index marad.
 */
function clusterCandidateIndices(candidates: ReadonlySet<number>): number[] {
  const sorted = [...candidates].sort((a, b) => b - a);
  if (sorted.length < 2) return sorted;

  const result: number[] = [];
  let clusterNewest = sorted[0]!;
  let previous = sorted[0]!;

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    if (previous - current <= CONTACT_INDEX_CLUSTER_GAP) {
      previous = current;
      continue;
    }
    result.push(clusterNewest);
    clusterNewest = current;
    previous = current;
  }
  result.push(clusterNewest);
  return result;
}

/**
 * Egy régi, már lezárt falhoz tapadó egysoros H3-sliver felismerése.
 *
 * A szálszabály bevezetése óta ez a szűrő a fő anti-farm őrszem: a bezárás után
 * a nyom gyakran a saját, imént lezárt fala mellett halad tovább, és a H3
 * kvantálás ilyenkor egy-két cellás, mag nélküli „hurkot" mutat. Valódi új
 * lebeny, aminek van 2D belső magja, továbbra is átmegy — akkor is, ha a régi
 * falat használja az egyik oldalaként (a 03. fejezet ezt kifejezetten engedi).
 */
/**
 * Van-e a cellahalmaznak valódi kétdimenziós magja: olyan cella, amelynek
 * legalább három oldalszomszédja szintén a halmazban van. Egysoros csíkon
 * minden cellának legfeljebb kettő van.
 */
function hasTwoDimensionalCore(cells: ReadonlySet<CellId>): boolean {
  for (const cell of cells) {
    let neighbours = 0;
    for (const near of gridDisk(cell, 1)) {
      if (near === cell) continue;
      if (cells.has(near)) neighbours += 1;
      if (neighbours >= 3) return true;
    }
  }
  return false;
}

function isThinSliverAlongOldWall(
  candidate: DetectedLoop,
  accepted: readonly AcceptedLoopRecord[],
): boolean {
  if (candidate.compactInterior || hasTwoDimensionalInteriorCore(candidate)) return false;

  for (let i = accepted.length - 1; i >= 0; i -= 1) {
    if (wallsOverlap(candidate.wall, accepted[i]!.loop.wall)) return true;
  }
  return false;
}

/**
 * A lineáris/egysoros belső minden cellájának legfeljebb két belső szomszédja
 * van. Valódi 2D magban legalább egy cella három vagy több belső oldalszomszédot
 * kap. Ez felbontásfüggetlenebb jel, mint egy önkényes „min. N belső cella”.
 */
function hasTwoDimensionalInteriorCore(loop: DetectedLoop): boolean {
  if (loop.compactInterior) return true;
  for (const cell of loop.interior) {
    let neighbours = 0;
    for (const near of gridDisk(cell, 1)) {
      if (near === cell) continue;
      if (loopInteriorHas(loop, near)) neighbours += 1;
      if (neighbours >= 3) return true;
    }
  }
  return false;
}

function wallsOverlap(a: ReadonlySet<CellId>, b: ReadonlySet<CellId>): boolean {
  const smaller = a.size <= b.size ? a : b;
  const larger = smaller === a ? b : a;
  for (const cell of smaller) {
    if (larger.has(cell)) return true;
  }
  return false;
}

/**
 * Tényleges új traversalnál egy majdnem bitazonos H3-hurok cellahalmazát
 * kanonizáljuk az előzőre. A bezárás ettől megmarad (defense credit jár), csak
 * az 1-2 cellás kapuzási jitter nem hoz létre új területet.
 */
function canonicalizeNearIdenticalRepeat(
  candidate: DetectedLoop,
  accepted: readonly AcceptedLoopRecord[],
): DetectedLoop {
  if (candidate.compactInterior) return candidate;

  for (let i = accepted.length - 1; i >= 0; i -= 1) {
    const record = accepted[i]!;
    if (record.loop.compactInterior) continue;
    if (!sameLoopGeometry(candidate, record.loop)) continue;
    if (normalLoopSymmetricDifference(candidate, record.loop) > REPEAT_CANONICAL_MAX_SYMMETRIC_DIFF) {
      continue;
    }

    return {
      wall: new Set(record.loop.wall),
      interior: new Set(record.loop.interior),
      fromIndex: candidate.fromIndex,
      toIndex: candidate.toIndex,
    };
  }
  return candidate;
}

function normalLoopSymmetricDifference(a: DetectedLoop, b: DetectedLoop): number {
  const aCells = new Set<CellId>([...a.wall, ...a.interior]);
  const bCells = new Set<CellId>([...b.wall, ...b.interior]);
  let difference = 0;
  for (const cell of aCells) if (!bCells.has(cell)) difference += 1;
  for (const cell of bCells) if (!aCells.has(cell)) difference += 1;
  return difference;
}

/**
 * Ugyanazt a területet elsődlegesen a BELSEJE alapján azonosítjuk. Compact
 * geometriánál a metszetszám parent-szinten számolható, ezért egy Balaton-méretű
 * hurok deduplikációja sem bont vissza több millió res12 cellára.
 */
function sameLoopGeometry(a: DetectedLoop, b: DetectedLoop): boolean {
  const aInterior = loopInteriorCellCount(a);
  const bInterior = loopInteriorCellCount(b);
  const minInterior = Math.min(aInterior, bInterior);
  const maxInterior = Math.max(aInterior, bInterior);

  if (minInterior > 0) {
    if (minInterior / maxInterior < 0.85) return false;
    const shared = loopInteriorOverlapCount(a, b);
    if (shared / minInterior >= 0.95) return true;
  }

  const minWall = Math.min(a.wall.size, b.wall.size);
  const maxWall = Math.max(a.wall.size, b.wall.size);
  if (minWall === 0 || minWall / maxWall < 0.9) return false;

  const smallerWall = a.wall.size <= b.wall.size ? a.wall : b.wall;
  const largerWall = smallerWall === a.wall ? b.wall : a.wall;
  let sharedWall = 0;
  for (const cell of smallerWall) {
    if (largerWall.has(cell)) sharedWall += 1;
  }
  return sharedWall / minWall >= 0.95;
}