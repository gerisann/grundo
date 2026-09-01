import { useSyncExternalStore } from 'react';
import {
  feedbackSettings,
  subscribeToFeedbackSettings,
  type FeedbackSettings,
} from '@/lib/feedbackSettings';

/**
 * A visszajelzés-beállítások React-oldali olvasása.
 *
 * `useSyncExternalStore`, nem Context: a beállítást a `Dock`, a
 * `TrackingScreen` és két beállítás-képernyő olvassa, a közös szülőjük
 * viszont az app gyökere. Egy ottani Provider minden kapcsolgatásnál a
 * teljes fát újrarenderelné; így csak az iratkozik fel, akinek tényleg
 * kell.
 *
 * A szerveroldali pillanatkép ugyanaz a függvény — a modul `localStorage`
 * hiányában is az alapértelmezett beállítást adja, tehát nincs hidratálási
 * eltérés.
 */
export function useFeedbackSettings(): FeedbackSettings {
  return useSyncExternalStore(subscribeToFeedbackSettings, feedbackSettings, feedbackSettings);
}
