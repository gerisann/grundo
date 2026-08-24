import { gridDisk } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import type {
  CellId,
  DetectedLoop,
  LoopDiagnostics,
  RejectedLoopDiagnostic,
} from '@/types';
import { floodFillInterior, LoopTooLargeError, pruneDeadEnds } from './loops';

interface AcceptedLoopRecord {
  loop: DetectedLoop;
  /** Az a traversal-index, ahol ezt a geometriai hurkot jóváírtuk. */
  toIndex: number;
}

/**
 * Hurokdetektor átfedő bezárásokhoz.
 *
 * Két külön problémát kell egyszerre kezelnünk:
 *
 * 1. Egy KÉSŐBBI valódi hurok használhassa falnak a korábban bejárt utat.
 *    Emiatt a látogatási előzményt nem törölhetjük minden bezárás után.
 *
 * 2. Egyetlen fizikai keresztezés H3-on nem egy pont, hanem több szomszédos
 *    cellából álló kontaktzóna. Ha minden cellát külön kapunak tekintünk,
 *    ugyanaz a hurok 2–5 alkalommal is elsül, és a defense egyetlen körből
 *    rögtön 3–5-re ugrik.
 *
 * A megoldás két védőréteg:
 *
 * - GATE ZONE: egy sikeres bezárás közvetlen 1-cellás H3 környezetében nem
 *   keresünk újabb hurkot. Új kapuhoz előbb ténylegesen el kell hagyni ezt a
 *   kontaktzónát. Így a keresztezés 4–6 egymás melletti H3 cellája egyetlen
 *   útvonal-találkozás marad.
 *
 * - TRAVERSAL DEDUPE: ha egy jelölt geometria gyakorlatilag ugyanaz, mint egy
 *   már elfogadott hurok, és a jelölt kezdete még AZ ELŐZŐ JÓVÁÍRÁS ELŐTTI
 *   traversalból származik, nem jár érte új bezárás. Ha viszont a teljes kört
 *   újra megfutottuk, a következő hurok kezdete már az előző zárásnál vagy
 *   utána van, ezért újra számít és építheti a defense-t.
 *
 * Ezzel a régi rávezető-szakasz hiba is zárva marad: a kör után ugyanazon az
 * ágon visszafelé haladva nem lehet ugyanazt a területet minden cellánál újra
 * bezárni.
 */
export function detectLoopsDetailed(path: readonly CellId[]): {
  loops: DetectedLoop[];
  diagnostics: LoopDiagnostics;
} {
  const loops: DetectedLoop[] = [];
  const successful: LoopDiagnostics['successful'] = [];
  const rejected: RejectedLoopDiagnostic[] = [];
  let shortRevisits = 0;

  // Egy cellát egy aktivitás alatt többször is érinthetünk. Nem csak a
  // legutolsó előfordulás kell: egy közeli rövid visszaérintés mögött lehet
  // egy régebbi, valódi bezárási kapu.
  const seenAt = new Map<CellId, number[]>();
  const accepted: AcceptedLoopRecord[] = [];

  /**
   * Az utoljára elfogadott kapu közvetlen H3-környezete.
   *
   * Amíg benne haladunk, ugyanannak a fizikai keresztezésnek a celláit
   * dolgozzuk fel. Az első cella bezárhat; a többi nem generál új hurkot.
   * Amint kilépünk, a blokk megszűnik, tehát egy későbbi valódi metszés — vagy
   * ugyanennek a kapunak egy teljes körrel későbbi új meglátogatása — ismét
   * jogosult hurokvizsgálatra.
   */
  let blockedGateZone: Set<CellId> | null = null;

  for (let i = 0; i < path.length; i += 1) {
    const cell = path[i]!;

    if (blockedGateZone !== null && !blockedGateZone.has(cell)) {
      blockedGateZone = null;
    }

    const sameHistory = seenAt.get(cell) ?? [];
    const latestSame = sameHistory[sameHistory.length - 1];

    if (latestSame !== undefined && i - latestSame < GAMEPLAY.MIN_LOOP_STEPS) {
      shortRevisits += 1;
    }

    // Ha még az előző keresztezés H3 kontaktzónájában vagyunk, csak a historyt
    // építjük tovább. Ez a kritikus rész: a következő 2–5 szomszédos cella nem
    // kaphat lehetőséget ugyanannak a huroknak az újbóli elsütésére.
    if (blockedGateZone !== null) {
      noteVisit(seenAt, cell, i);
      continue;
    }

    /**
     * A kapu cellaszinten záródik. A mostani cella saját korábbi
     * előfordulásai ÉS a hat élszomszéd minden korábbi előfordulása jelölt.
     *
     * A legfrissebb jelöltet próbáljuk először: egy új keresztezésnél ez adja
     * a lokális, frissen bezárt hurkot. Ha az túl kicsi vagy érvénytelen,
     * haladunk visszafelé a régebbi kapuk felé.
     */
    const candidates = new Set<number>();
    for (const index of sameHistory) {
      if (i - index >= GAMEPLAY.MIN_LOOP_STEPS) candidates.add(index);
    }
    for (const near of gridDisk(cell, 1)) {
      if (near === cell) continue;
      for (const index of seenAt.get(near) ?? []) {
        if (i - index >= GAMEPLAY.MIN_LOOP_STEPS) candidates.add(index);
      }
    }
    const candidateIndices = [...candidates].sort((a, b) => b - a);

    for (const previous of candidateIndices) {
      const rawWall = new Set(path.slice(previous, i + 1));
      const wall = pruneDeadEnds(rawWall);
      const prunedCells = Math.max(0, rawWall.size - wall.size);

      let interior: Set<CellId>;
      try {
        interior = floodFillInterior(wall);
      } catch (err) {
        if (err instanceof LoopTooLargeError) {
          rejected.push({
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

      if (interior.size < GAMEPLAY.MIN_INTERIOR_CELLS) {
        rejected.push({
          reason: 'interior_too_small',
          fromIndex: previous,
          toIndex: i,
          wallCells: wall.size,
          interiorCells: interior.size,
          prunedCells,
        });
        continue;
      }

      const candidate: DetectedLoop = { wall, interior, fromIndex: previous, toIndex: i };

      /**
       * Ugyanannak a területnek a következő kapucellája nem új kör.
       *
       * Csak olyan korábbi hurokkal kell összevetni, amelynek jóváírása a
       * jelenlegi jelölt [previous, i] traversalába beleesik. Ha `previous`
       * már az előző jóváírásnál vagy utána van, akkor egy teljesen új
       * traversal történt — tipikusan újra megfutottuk a teljes kört —, azt
       * szándékosan engedjük defense-t építeni.
       */
      if (isTraversalDuplicate(candidate, previous, accepted)) {
        continue;
      }

      loops.push(candidate);
      successful.push({
        fromIndex: previous,
        toIndex: i,
        wallCells: wall.size,
        interiorCells: interior.size,
        prunedCells,
      });
      accepted.push({ loop: candidate, toIndex: i });

      /**
       * A kapu két oldala ugyanaz a cella vagy élszomszéd. A két 1-gyűrű
       * uniója lefedi azt a H3 kontaktfoltot, amit a térképen 4–6 sárga
       * kereszteződési cellaként látunk. Legalább egy valóban különálló cellán
       * át kell haladni, mielőtt új hurok vizsgálható.
       */
      blockedGateZone = gateZone(path[previous]!, cell);
      break;
    }

    noteVisit(seenAt, cell, i);
  }

  return { loops, diagnostics: { successful, rejected, shortRevisits } };
}

export function detectLoops(path: readonly CellId[]): DetectedLoop[] {
  return detectLoopsDetailed(path).loops;
}

function noteVisit(history: Map<CellId, number[]>, cell: CellId, index: number): void {
  const visits = history.get(cell);
  if (visits) visits.push(index);
  else history.set(cell, [index]);
}

function gateZone(a: CellId, b: CellId): Set<CellId> {
  const zone = new Set<CellId>();
  for (const cell of gridDisk(a, 1)) zone.add(cell);
  for (const cell of gridDisk(b, 1)) zone.add(cell);
  return zone;
}

/**
 * Azonnali/folyamatos duplikáció felismerése ugyanarra a geometriai hurokra.
 *
 * A falat hasonlítjuk, nem a teljes belsőt: nagy területnél a belső akár
 * milliós cellaszámú lehet, a fal viszont a kerülettel nő. Ezért a teszt
 * skálázható marad Balaton-méretű hurkoknál is.
 */
function isTraversalDuplicate(
  candidate: DetectedLoop,
  previous: number,
  accepted: readonly AcceptedLoopRecord[],
): boolean {
  for (let i = accepted.length - 1; i >= 0; i -= 1) {
    const record = accepted[i]!;

    // A korábbi jóváírás már a jelenlegi traversal előtt történt. Mivel az
    // accepted lista időrendben van, a még régebbiek sem lehetnek duplikátok.
    if (previous >= record.toIndex) break;

    if (sameLoopGeometry(candidate, record.loop)) return true;
  }
  return false;
}

/**
 * Két hurok akkor ugyanaz a fizikai terület, ha a faluk szinte teljesen
 * megegyezik és a belső cellaszámuk is ugyanabban a nagyságrendben van.
 *
 * Nem követelünk bitpontos azonosságot, mert egy H3-keresztezés következő
 * kapucellája a fal szélén 1–2 cellát hozzáadhat/elvehet. Ugyanakkor elég
 * szigorú a küszöb ahhoz, hogy egy valóban más, átfedő hurok megmaradjon.
 */
function sameLoopGeometry(a: DetectedLoop, b: DetectedLoop): boolean {
  const aWall = a.wall;
  const bWall = b.wall;
  const minWall = Math.min(aWall.size, bWall.size);
  const maxWall = Math.max(aWall.size, bWall.size);
  if (minWall === 0) return false;

  // Ha már a kerület mérete is nagyon eltér, biztosan más hurokról van szó.
  if (minWall / maxWall < 0.88) return false;

  const minInterior = Math.min(a.interior.size, b.interior.size);
  const maxInterior = Math.max(a.interior.size, b.interior.size);
  if (maxInterior > 0 && minInterior / maxInterior < 0.88) return false;

  const smaller = aWall.size <= bWall.size ? aWall : bWall;
  const larger = smaller === aWall ? bWall : aWall;
  let shared = 0;
  for (const cell of smaller) {
    if (larger.has(cell)) shared += 1;
  }

  return shared / minWall >= 0.9;
}
