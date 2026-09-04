import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EMPTY_DISPATCH_STATE,
  planDispatch,
  PreviewSession,
  type DispatchState,
  type PreviewCell,
  type PreviewOutput,
} from '@/lib/previewEngine';
import { EMPTY_CAPTURE_SNAPSHOT } from '@/lib/captureEvents';
import {
  measurePerf,
  notePerf,
  perfVisibility,
  recordPerf,
  type PerfVisibility,
} from '@/lib/perfMeter';
import type { PreviewCommand, PreviewResponse } from '@/workers/previewProtocol';
import type { ActivityType, OwnershipMap, TracePoint } from '@/types';
import type { CaptureSnapshot } from '@/lib/captureEvents';

/**
 * AZ ÉLŐ ELŐNÉZET HAJTÓJA — a workert eteti, és a legutóbbi eredményt tartja.
 *
 * ── MI LÁTSZIK, AMÍG A VÁLASZ ÚTON VAN ───────────────────────────────────
 *
 * A nyom (`path`) és a lépéshang a főszálon marad, tehát AZONNAL frissül. A
 * foglalt mezők színe, a mezőszámláló és a GP-becslés a LEGUTÓBBI eredményt
 * mutatja, amíg meg nem jön az új — tipikusan egy ezredmásodperces
 * körbefordulás, a háttérből visszatéréskor pedig legfeljebb annyi, amennyi
 * eddig FAGYÁS volt (mérve 859 ms). Nincs pörgő, nincs villanás: egy
 * kicsit régebbi előnézet jobb, mint egy üres.
 *
 * Új rögzítésnél (`sessionKey` váltás) viszont AZONNAL üres — az előző futás
 * hurkai nem lóghatnak át az újba, még egy körbefordulásnyi időre sem.
 *
 * ── EGYSZERRE EGY SZÁMÍTÁS ───────────────────────────────────────────────
 *
 * A worker felé mindig legfeljebb EGY kérés van úton. Ami közben érkezik,
 * összevonódik, és egyetlen kötegként megy ki. Ez pontosan az a művelet, ami
 * eddig a főszálon fagyasztott: a munka mennyisége ugyanannyi (mérve: a
 * kötegmérettől független, 1,26–1,46 s a teljes körre), csak már nem a
 * felület árán.
 */

export interface PreviewResult {
  path: string[];
  claimable: string[];
  own: PreviewCell[];
  stolen: PreviewCell[];
  gp: number;
  /** A foglalás-visszajelzés bemenete — lásd `lib/captureEvents.ts`. */
  snapshot: CaptureSnapshot;
}

export interface PreviewEngineInput {
  points: readonly TracePoint[];
  /** A főszálon számolt cellalánc — a `path` közvetlenül ebből lesz. */
  cellPath: string[];
  ownership: OwnershipMap;
  type: ActivityType;
  distanceM: number;
  actorId: string;
  /** A rögzítés azonossága (`geometrySessionKey`). */
  sessionKey: string;
  /** A rögzítő állapota — a régi `useMemo` is függött tőle. */
  status: string;
}

interface Stored {
  session: string;
  output: PreviewOutput;
}

/**
 * A kimenő üzenetek állapota. Ref, nem state: a `flush` a legfrissebb értéket
 * kell hogy lássa, és egy state-frissítés újrarendereléssel járna, ami itt
 * pont a mérendő főszálas költséget növelné.
 */
interface Dispatch {
  /** Mit tud már a worker — a `planDispatch` bemenete és kimenete. */
  state: DispatchState;
  busy: boolean;
  /** Érkezett-e újabb adat, amíg a worker dolgozott. */
  dirty: boolean;
  seq: number;
  /**
   * Láthatóság az ÉPP FUTÓ kérés elküldésekor. A worker válaszáig eltelhet
   * egy háttér-előtér váltás — a mérésnek pont ez a különbség kell.
   */
  sentVisibility: PerfVisibility;
}

/**
 * Amíg nincs eredmény, ez látszik. Modulszintű állandó, mert a
 * `useCaptureFeedback` a pillanatkép AZONOSSÁGÁT figyeli — egy hívásonként
 * újragyártott üres objektum minden rendernél „változást" jelentene.
 */
const EMPTY_PREVIEW: Omit<PreviewResult, 'path'> = {
  claimable: [],
  own: [],
  stolen: [],
  gp: 0,
  snapshot: EMPTY_CAPTURE_SNAPSHOT,
};

/**
 * A worker fázisidőit a MEGSZOKOTT `preview.*` kulcsokon könyveljük, hogy a
 * számok összevethetők maradjanak a 2026-09-04-i terepi méréssel.
 *
 * A `startedVisibility` a KÜLDÉS pillanatának állapota, nem a mostani: a
 * munka a workerben futott, és épp az a kérdés, hogy a felület közben
 * rejtve volt-e. Enélkül a háttérből visszatérő torlódás megint csak
 * következtetés lenne, nem mérés.
 *
 * A kísérőszámok a fázisidők ELŐTT frissülnek, hogy a mérő a mostani
 * értékeket írja a nevezetes futások mellé.
 */
function recordTimings(output: PreviewOutput, startedVisibility: PerfVisibility): void {
  notePerf('points', output.counts.points);
  notePerf('cells', output.counts.cells);
  notePerf('loops', output.counts.loops);
  notePerf('fates', output.counts.fates);
  const context = { startedVisibility };
  recordPerf('preview.geometry', output.timings.geometryMs, context);
  recordPerf('preview.process', output.timings.processMs, context);
  recordPerf('preview.fates', output.timings.fatesMs, context);
  recordPerf('preview.total', output.timings.totalMs, context);
}

/**
 * Elindítja a workert. `null`, ha a környezet nem tudja — régi webnézet,
 * jsdom a tesztekben, vagy letiltott worker. A hívó ilyenkor szinkron számol.
 */
function startWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    /**
     * ⚠️ A `new URL(..., import.meta.url)` alakot a Vite FORDÍTÁSKOR elemzi,
     * ezért az útvonalnak szó szerint itt kell állnia — se `@/` alias, se
     * változó. A `type: 'module'` párja a `vite.config.ts` `worker.format`
     * beállítása; a kettőnek együtt kell mozognia.
     */
    return new Worker(new URL('../workers/previewWorker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return null;
  }
}

export function usePreviewEngine(input: PreviewEngineInput): PreviewResult {
  const [stored, setStored] = useState<Stored | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const fallbackRef = useRef<PreviewSession | null>(null);
  const dispatchRef = useRef<Dispatch>({
    state: EMPTY_DISPATCH_STATE,
    busy: false,
    dirty: false,
    seq: 0,
    sentVisibility: 'visible',
  });

  /** A legfrissebb bemenet, hogy a `flush` ne zárt változóból dolgozzon. */
  const inputRef = useRef(input);
  inputRef.current = input;

  /** Átállás a szinkron ágra — worker-hiba vagy hiányzó `Worker` esetén. */
  const switchToFallback = useCallback(() => {
    const worker = workerRef.current;
    if (worker !== null) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      workerRef.current = null;
    }
    if (fallbackRef.current === null) fallbackRef.current = new PreviewSession();
    // A tartalék munkamenet még egyetlen pontot sem látott.
    const dispatch = dispatchRef.current;
    dispatch.state = EMPTY_DISPATCH_STATE;
    dispatch.busy = false;
  }, []);

  const flush = useCallback(() => {
    const dispatch = dispatchRef.current;
    if (dispatch.busy) {
      dispatch.dirty = true;
      return;
    }

    const current = inputRef.current;
    const worker = workerRef.current;
    const fallback = fallbackRef.current;
    if (worker === null && fallback === null) return;

    const plan = planDispatch(dispatch.state, {
      sessionKey: current.sessionKey,
      points: current.points,
      ownership: current.ownership,
    });
    dispatch.state = plan.next;
    const { reset, sendOwnership, replace, delta } = plan;

    const request = {
      type: current.type,
      distanceM: current.distanceM,
      actorId: current.actorId,
    };

    if (worker !== null) {
      /**
       * A `preview.dispatch` azt a FŐSZÁLAS terhet méri, ami a workeres úton
       * megmarad: az üzenetek felépítése és sorosítása. Ez az a szám, aminek
       * a következő terepi mérésen elhanyagolhatónak kell lennie — a
       * számítás maga a `preview.total`-ban látszik, immár a workerből.
       */
      measurePerf('preview.dispatch', () => {
        if (reset) {
          worker.postMessage({ kind: 'reset', session: current.sessionKey } satisfies PreviewCommand);
        }
        if (sendOwnership) {
          worker.postMessage({
            kind: 'ownership',
            session: current.sessionKey,
            cells: [...current.ownership],
          } satisfies PreviewCommand);
        }
        dispatch.seq += 1;
        dispatch.busy = true;
        dispatch.sentVisibility = perfVisibility();
        worker.postMessage({
          kind: 'run',
          session: current.sessionKey,
          seq: dispatch.seq,
          points: delta,
          replace,
          request,
        } satisfies PreviewCommand);
      });
      return;
    }

    if (fallback === null) return;
    if (reset) fallback.reset();
    if (sendOwnership) fallback.setOwnership(current.ownership);
    if (replace) fallback.replacePoints(delta);
    else fallback.appendPoints(delta);
    const startedVisibility = perfVisibility();
    const output = fallback.run(request);
    recordTimings(output, startedVisibility);
    setStored({ session: current.sessionKey, output });
  }, []);

  useEffect(() => {
    /**
     * ⚠️ AZ ÚJ MOTOR SEMMIT NEM TUD A NYOMRÓL. A `dispatchRef` túléli a
     * hook újracsatolását (`useRef`), ezért ha nem nullázzuk, a következő
     * `flush` KÜLÖNBSÉGET küldene egy üres workernek: a nyom eleje soha nem
     * érne oda, a geometria pedig csendben hibás lenne. React `StrictMode`
     * alatt ez minden fejlesztői indításkor bekövetkezne (az effekt kétszer
     * fut), élesben pedig worker-hiba utáni újraindításkor.
     */
    dispatchRef.current = {
      state: EMPTY_DISPATCH_STATE,
      busy: false,
      dirty: false,
      seq: 0,
      sentVisibility: 'visible',
    };

    const worker = startWorker();
    if (worker === null) {
      fallbackRef.current = new PreviewSession();
    } else {
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<PreviewResponse>) => {
        const message = event.data;
        if (message.kind === 'ready') return;

        const dispatch = dispatchRef.current;
        dispatch.busy = false;

        if (message.kind === 'failed') {
          /**
           * A worker elhasalt egy konkrét kérésen. Nem dobjuk el miatta az
           * előnézetet: a szinkron ág ugyanezt a kódot futtatja, csak a
           * főszálon. Egy akadás elviselhető, a néma hiány nem.
           */
          switchToFallback();
          flush();
          return;
        }

        if (message.session === dispatchRef.current.state.session) {
          recordTimings(message.output, dispatch.sentVisibility);
          setStored({ session: message.session, output: message.output });
        }

        if (dispatch.dirty) {
          dispatch.dirty = false;
          flush();
        }
      };
      worker.onerror = () => {
        switchToFallback();
        flush();
      };
    }

    return () => {
      const running = workerRef.current;
      if (running !== null) {
        running.onmessage = null;
        running.onerror = null;
        running.terminate();
        workerRef.current = null;
      }
      fallbackRef.current = null;
    };
  }, [flush, switchToFallback]);

  /**
   * A ÚJRASZÁMOLÁS KAPUJA — pontosan a régi `useMemo` függőségei.
   *
   * Nem minden GPS-mintára frissítünk, hanem minden ÚJ H3-cellára és
   * 25 méterenként: a korábbi ötpontos köteg bringánál 20–40 méteres látható
   * lemaradást okozott, majd egyszerre „behozta" a cellákat.
   */
  const cellRevision = `${input.cellPath.length}:${input.cellPath.at(-1) ?? ''}`;
  const distanceBucket = Math.floor(input.distanceM / 25);
  useEffect(() => {
    flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cellRevision,
    distanceBucket,
    input.status,
    input.sessionKey,
    input.type,
    input.actorId,
    input.ownership,
    flush,
  ]);

  const output = stored !== null && stored.session === input.sessionKey
    ? stored.output
    : null;

  return useMemo<PreviewResult>(() => {
    if (output === null) return { path: input.cellPath, ...EMPTY_PREVIEW };
    return {
      path: input.cellPath,
      claimable: output.claimable,
      own: output.own,
      stolen: output.stolen,
      gp: output.gp,
      snapshot: output.snapshot,
    };
  }, [output, input.cellPath]);
}
