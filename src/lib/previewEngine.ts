import { hasCompactInterior, IncrementalActivityGeometry } from '@/game';
import { IncrementalActivityClaims } from '@/game/incrementalClaims';
import type { CaptureCell, CaptureSnapshot } from '@/lib/captureEvents';
import type { ActivityType, OwnershipMap, TracePoint } from '@/types';

/**
 * AZ ÉLŐ ELŐNÉZET MOTORJA — a `TrackingScreen` `useMemo`-jából kiemelve.
 *
 * MIÉRT KÜLÖN MODUL: ugyanezt a számítást KÉT helyen kell futtatni. Rendes
 * esetben a `workers/previewWorker.ts`-ben, a főszálról levéve; ha a
 * `Worker` nem áll rendelkezésre (régi webnézet, teszt), akkor a
 * `hooks/usePreviewEngine.ts` tartalék ága hívja szinkron módon. A két útnak
 * BETŰRE ugyanazt kell adnia, különben a tartalék ág csendben más előnézetet
 * mutatna, mint az éles.
 *
 * MIÉRT NEM A `src/game/` ALATT VAN: a `game/` a szerverrel közös,
 * platformfüggetlen motor, és nem ismerheti a kliens
 * foglalás-visszajelzését (`lib/captureEvents.ts`). Ez a modul viszont a
 * kettő ÖSSZEKÖTÉSE — DOM-mentes, tehát workerben is fut, de kliensoldali.
 *
 * ── MÉRT ADAT, AMI EZT A FELÁLLÁST INDOKOLJA ─────────────────────────────
 *
 * Terepi mérés 2026-09-04 (`docs/ai/meres-2026-09-04-terepi-fosszal.md`),
 * két készülék, ~40 perc, 8,6–9,0 km:
 *
 *   - a teljes főszálas költség 0,1% kitöltés — az ÖSSZEG nem probléma;
 *   - de a Samsungon a háttérből visszatéréskor EGYETLEN blokk **859 ms** volt,
 *     mert a háttérben felgyűlt GPS-minták egy kötegben kerültek feldolgozásra;
 *   - ennek 99,5%-a a hurokkeresés (`IncrementalLoopDetector.append`), nem az
 *     elszámolás: a `preview.process` telefonon mindössze 2,6–2,8 ms.
 *
 * Ezért NEM az algoritmus olcsóbbá tétele az első lépés, hanem a főszálról
 * levétel: a hosszú blokk így is megvan, csak nem fagyasztja be a felületet.
 */

/**
 * Egy előnézeti mező úgy, ahogy a `MapView` várja.
 *
 * Az `owner` NEM elhagyható: abból derül ki a térképnek, hogy a felhasználó
 * választott cellaszínével rajzolja, ne a szerep alapszínével.
 */
export interface PreviewCell {
  cell: string;
  defense: number;
  owner: string;
  preview: true;
}

/** Az előnézet KÉRÉSE — minden, ami a nyomvonalon kívül kell. */
export interface PreviewRequest {
  type: ActivityType;
  distanceM: number;
  actorId: string;
}

/**
 * Az előnézet EREDMÉNYE. A `path` szándékosan hiányzik: a cellalánc olcsó
 * (a teljes körre mérve 6 ms), ezért a főszálon marad — így a nyom és a
 * lépéshang akkor is azonnal frissül, amikor a worker válasza még úton van.
 */
export interface PreviewOutput {
  claimable: string[];
  own: PreviewCell[];
  stolen: PreviewCell[];
  gp: number;
  snapshot: CaptureSnapshot;
  /** Kísérőszámok a mérőhöz (`lib/perfMeter.ts` `notePerf`). */
  counts: { points: number; cells: number; loops: number; fates: number };
  /** Fázisidők ezredmásodpercben — a mérő ezekből él, lásd lent. */
  timings: { geometryMs: number; processMs: number; fatesMs: number; totalMs: number };
}

const EMPTY_TIMINGS = { geometryMs: 0, processMs: 0, fatesMs: 0, totalMs: 0 };

/**
 * Nagy (compact belsejű) huroknál a motor csak ÜRES birtokviszonyt fogad el.
 * Modulszintű állandó, mert az elszámolás-gyorsítótár a Map AZONOSSÁGÁT nézi:
 * egy hívásonként újragyártott üres Map minden alkalommal tévesztés lenne.
 */
const EMPTY_OWNERSHIP: OwnershipMap = new Map();

function emptyOutput(pointCount: number): PreviewOutput {
  return {
    claimable: [],
    own: [],
    stolen: [],
    gp: 0,
    snapshot: { loopCount: 0, cells: new Map(), gainedCells: 0, gainedAreaM2: 0 },
    counts: { points: pointCount, cells: 0, loops: 0, fates: 0 },
    timings: EMPTY_TIMINGS,
  };
}

export class PreviewSession {
  private geometry = new IncrementalActivityGeometry();
  private claims = new IncrementalActivityClaims();

  /**
   * A NYOMVONAL, amit a munkamenet gyűjt.
   *
   * ⚠️ EZ A MODUL LEGFONTOSABB RÉSZLETE. Az inkrementális gyorsítótárak abból
   * ismerik fel a folytatást, hogy a korábbi pontok OBJEKTUM-AZONOSSÁGA
   * változatlan (`IncrementalActivityGeometry.update` `isExtension` ága). A
   * worker viszont `structuredClone`-nal kapja az üzeneteket, ami MINDEN
   * pontot új objektummá másol — ha a teljes pontsort küldenénk át
   * frissítésenként, az azonosság minden alkalommal elveszne, és a motor
   * mindannyiszor a NULLÁRÓL épülne újra. Mérve az asztali padon a terepi
   * nyomvonalon: a hideg teljes újraépítés **1 248 ms**, szemben a
   * folytatás átlagos 2,6 ms-ával — vagyis a worker önmagában ötszázszorosára
   * rontaná azt, amit javítani akar.
   *
   * Ezért a protokoll KÜLÖNBSÉGET küld, a munkamenet pedig ÚJ TÖMBBE fűzi a
   * régi pontobjektumokkal: a tömb referenciája változik (a hívó `useMemo`-i
   * észreveszik), az elemeké nem (a gyorsítótár folytatásnak látja).
   * A `previewEngine.test.ts` „nem épül újra" esete ezt őrzi.
   */
  private points: readonly TracePoint[] = [];

  /** Amit a geometria LEGUTÓBB látott — csak a folytatás ellenőrzéséhez. */
  private seen: readonly TracePoint[] = [];

  private ownership: OwnershipMap = EMPTY_OWNERSHIP;

  private appendCount = 0;
  private rebuildCount = 0;

  /**
   * Hányszor folytatódott a nyom, és hányszor kellett a NULLÁRÓL kezdeni.
   * A `rebuilds` a bekapcsolt rögzítés alatt 1 (az első hívás) — minden
   * további érték szivárgó objektum-azonosságot jelent.
   */
  get stats(): { appends: number; rebuilds: number } {
    return { appends: this.appendCount, rebuilds: this.rebuildCount };
  }

  get pointCount(): number {
    return this.points.length;
  }

  reset(): void {
    this.geometry.reset();
    this.claims.reset();
    this.points = [];
    this.seen = [];
    this.ownership = EMPTY_OWNERSHIP;
    this.appendCount = 0;
    this.rebuildCount = 0;
  }

  /**
   * Új birtokviszony a `/api/tiles` válaszából. A Map AZONOSSÁGA a
   * gyorsítótár kulcsa, ezért csak akkor hívjuk, ha tényleg változott —
   * különben minden előnézet újraszámolna.
   */
  setOwnership(ownership: OwnershipMap): void {
    this.ownership = ownership;
  }

  /** A nyom folytatása. A pontobjektumokat NEM másoljuk — lásd `points`. */
  appendPoints(points: readonly TracePoint[]): void {
    if (points.length === 0) return;
    this.points = this.points.length === 0 ? [...points] : [...this.points, ...points];
  }

  /**
   * A nyom TELJES cseréje — csak akkor, ha a hívó szerint a nyomvonal nem
   * folytatódott (visszamenőleges eltérés, új rögzítés ugyanabban a
   * munkamenetben). Drága: a gyorsítótár a nulláról épül.
   */
  replacePoints(points: readonly TracePoint[]): void {
    this.geometry.reset();
    this.claims.reset();
    this.points = [...points];
    this.seen = [];
  }

  run(request: PreviewRequest): PreviewOutput {
    const points = this.points;
    if (points.length < 2) return emptyOutput(points.length);

    const previousCount = this.seen.length;
    const isExtension = previousCount > 0
      && points[previousCount - 1] === this.seen[previousCount - 1];
    if (isExtension) this.appendCount += 1;
    else this.rebuildCount += 1;
    this.seen = points;

    const startedAt = performance.now();
    try {
      const geometryStartedAt = performance.now();
      const geometry = this.geometry.update(points);
      const geometryMs = performance.now() - geometryStartedAt;

      /**
       * Nagy (compact belsejű) huroknál a motor SZÁNDÉKOSAN dob, ha valódi
       * ownershipet kap (`game/index.ts` `processActivityGeometry` őre) — a
       * valódi elszámolás a szerver blokkos útján történik, itt csak előnézet
       * kell. Enélkül egy nagy bringakör, ami meglévő birtok mellett halad el
       * (szinte mindig, hiszen a `nearby` majdnem sosem üres), a `catch`-ig
       * futott, és a preview NULLA claimet/GP-t mutatott (HANDOFF #20).
       */
      const hasCompactLoop = geometry.loops.some(hasCompactInterior);
      const ownership = hasCompactLoop ? EMPTY_OWNERSHIP : this.ownership;

      const processStartedAt = performance.now();
      const result = this.claims.update(
        {
          points,
          type: request.type,
          distanceKm: request.distanceM / 1000,
          actorId: request.actorId || 'preview',
          ownership,
          streakDays: 0,
          gpEarnedToday: 0,
        },
        geometry,
      );
      const processMs = performance.now() - processStartedAt;

      const fatesStartedAt = performance.now();
      const own: PreviewCell[] = [];
      const stolen: PreviewCell[] = [];
      const claimable: string[] = [];
      /**
       * A cellánkénti pillanatkép a foglalás-visszajelzéshez
       * (`lib/captureEvents.ts`). UGYANEBBŐL a ciklusból épül, mert pontosan
       * ugyanaz az adat kell hozzá — egy külön bejárás csak a lista kétszeri
       * végigolvasását jelentené minden új cellánál.
       */
      const snapshotCells = new Map<string, CaptureCell>();
      for (const [cell, fate] of result.claim?.fates ?? []) {
        const defense = result.claim?.updates.get(cell)?.defense ?? 1;
        snapshotCells.set(cell, { fate, defense });
        if (fate === 'breakthrough') continue;
        const item = { cell, defense, owner: request.actorId, preview: true as const };
        (fate === 'stolen' ? stolen : own).push(item);
        claimable.push(cell);
      }
      const fatesMs = performance.now() - fatesStartedAt;

      const snapshot: CaptureSnapshot = {
        loopCount: geometry.loops.length,
        cells: snapshotCells,
        /* A motor ÖSSZESÍTÉSE, nem a cellatérkép mérete — nagy, tömör
           huroknál a kettő szándékosan eltér (lásd `captureEvents.ts`). */
        gainedCells: (result.claim?.counts.free ?? 0) + (result.claim?.counts.stolen ?? 0),
        gainedAreaM2: result.claim?.gainedM2 ?? 0,
      };

      return {
        claimable,
        own,
        stolen,
        gp: result.gp.total,
        snapshot,
        counts: {
          points: points.length,
          cells: geometry.cellPath.length,
          loops: geometry.loops.length,
          fates: snapshotCells.size,
        },
        timings: {
          geometryMs,
          processMs,
          fatesMs,
          totalMs: performance.now() - startedAt,
        },
      };
    } catch {
      // A motor túl nagy hurokra kivételt dob (GPS-ugrás). A nyom attól még
      // rajzolható — az előnézet hiánya nem indok arra, hogy a térkép is
      // kiessen. A `path` amúgy is a hívónál van, nem itt.
      const failed = emptyOutput(points.length);
      return { ...failed, timings: { ...EMPTY_TIMINGS, totalMs: performance.now() - startedAt } };
    }
  }
}

export { emptyOutput as emptyPreviewOutput };

/**
 * ── MIT KÜLDJÜNK ÁT A WORKERNEK ──────────────────────────────────────────
 *
 * A `hooks/usePreviewEngine.ts` React-hook, tehát böngésző nélkül nem
 * futtatható; ez a döntés viszont a lánc legtörékenyebb pontja, ezért tiszta
 * függvényként él itt, teszttel. Amit eldönt:
 *
 *  - kell-e `reset` (új rögzítés),
 *  - kell-e új birtokviszony (a Map AZONOSSÁGA a gyorsítótár kulcsa),
 *  - a nyom FOLYTATÓDOTT-e, és ha igen, mi az új rész.
 *
 * ⚠️ A `delta` a bemeneti tömb EREDETI pontobjektumait adja vissza, nem
 * másolatokat. A worker oldalán a `structuredClone` úgyis másol — de a
 * főszálon egy fölösleges másolás itt csendben megduplázná a küldött adatot.
 */
export interface DispatchState {
  session: string;
  /** Hány pontot küldtünk már el, és melyik tömbből. */
  sentCount: number;
  lastSent: readonly TracePoint[];
  ownership: OwnershipMap | null;
}

export interface DispatchPlan {
  reset: boolean;
  sendOwnership: boolean;
  /** A nyom NEM folytatódott: a `delta` a teljes nyomvonal. */
  replace: boolean;
  delta: readonly TracePoint[];
  next: DispatchState;
}

export const EMPTY_DISPATCH_STATE: DispatchState = {
  session: '',
  sentCount: 0,
  lastSent: [],
  ownership: null,
};

export function planDispatch(
  state: DispatchState,
  input: { sessionKey: string; points: readonly TracePoint[]; ownership: OwnershipMap },
): DispatchPlan {
  const reset = state.session !== input.sessionKey;
  const base = reset ? { ...EMPTY_DISPATCH_STATE, session: input.sessionKey } : state;
  const sendOwnership = base.ownership !== input.ownership;

  const points = input.points;
  const sent = base.sentCount;
  /**
   * A folytatás feltétele az OBJEKTUM-AZONOSSÁG: a korábban elküldött utolsó
   * pontnak ugyanannak az objektumnak kell lennie az új tömbben is. A hossz
   * önmagában nem elég — egy visszamenőleg átírt nyom ugyanolyan hosszú
   * lehet, és akkor a worker gyorsítótára hibás geometriát vinne tovább.
   */
  const continued = sent === 0
    || (points.length >= sent && points[sent - 1] === base.lastSent[sent - 1]);

  return {
    reset,
    sendOwnership,
    replace: !continued,
    delta: continued ? points.slice(sent) : points,
    next: {
      session: input.sessionKey,
      sentCount: points.length,
      lastSent: points,
      ownership: input.ownership,
    },
  };
}
