/**
 * A rögzítés közbeni foglalás-visszajelzés vezérlése — hang és felugró üzenet.
 *
 * A DÖNTÉS (mi az esemény) a `lib/captureEvents.ts` tiszta függvényében van;
 * ez a réteg csak a Reactté fordítás: pillanatkép-összehasonlítás
 * renderelések között, hanglejátszás, és az üzenet öt másodperces élete.
 *
 * ⚠️ AZ ELSŐ MEGFIGYELÉS SOSEM ESEMÉNY. Egy félbehagyott rögzítés
 * visszaállításakor (`useRecorder` `restore`) a hurokszám nullából egyből
 * ötre ugorhat — az nem most történt, hanem fél órája. Ezért minden
 * munkamenet-váltásnál (`sessionKey`) az első pillanatkép némán beáll
 * kiindulásnak.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  captureKind,
  diffCaptureSnapshots,
  type CaptureEvent,
  type CaptureKind,
  type CaptureSnapshot,
} from '@/lib/captureEvents';
import { playSound } from '@/lib/sound';
import { useFeedbackSettings } from './useFeedbackSettings';

/** Ennyi ideig áll az üzenet magától — Geri kérése (2026-09-01). */
export const TERRITORY_TOAST_MS = 5000;

export interface CaptureFeedback {
  /** A megjelenítendő esemény, vagy `null`, ha épp nincs. */
  event: CaptureEvent | null;
  kind: CaptureKind | null;
  /** Kézi bezárás — az automatikus eltűnés előtt. */
  dismiss: () => void;
}

export function useCaptureFeedback(
  snapshot: CaptureSnapshot,
  sessionKey: string,
  active: boolean,
): CaptureFeedback {
  const settings = useFeedbackSettings();
  const previous = useRef<CaptureSnapshot | null>(null);
  const session = useRef<string | null>(null);
  const [event, setEvent] = useState<CaptureEvent | null>(null);

  const dismiss = useCallback(() => setEvent(null), []);

  useEffect(() => {
    // Nem futó rögzítésnél (tétlen, befejezett) nincs mit ünnepelni — és a
    // mentés-panel alatt egy felugró üzenet csak takarna.
    if (!active) {
      previous.current = null;
      session.current = null;
      return;
    }

    if (session.current !== sessionKey) {
      session.current = sessionKey;
      previous.current = snapshot;
      return;
    }

    const before = previous.current;
    previous.current = snapshot;
    if (before === null) return;

    const next = diffCaptureSnapshots(before, snapshot);
    if (next === null) return;

    setEvent(next);

    /**
     * ⚠️ ITT CSAK A HUROK FANFÁRJA SZÓL — a cellahangok NEM ide tartoznak.
     *
     * A mezők koppanása valós időben, lépéskor megy (`useCellStepSound`),
     * Geri kérése szerint (2026-09-01): „nem azt akarom, hogy a hurok
     * zárásnál játszd le 400x ugyanazt a cella foglalás hangot, hanem hogy
     * mikor real time rámegyünk egy új cellára". A bezárás a terület
     * megszerzésének a jutalma, egyetlen hang és a felugró üzenet.
     */
    playSound('loop-closed');
  }, [active, sessionKey, snapshot]);

  /**
   * Az ÜZENET külön él a hangtól: a hangot a `settings` már a lejátszáskor
   * kapuzza, a felugró üzenetet viszont itt kell, mert a kapcsoló menet
   * közben is átbillenhet.
   */
  useEffect(() => {
    if (event === null) return;
    if (!settings.territoryPopup) {
      setEvent(null);
      return;
    }
    const timer = window.setTimeout(() => setEvent(null), TERRITORY_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [event, settings.territoryPopup]);

  return {
    event: settings.territoryPopup ? event : null,
    kind: event === null ? null : captureKind(event),
    dismiss,
  };
}
