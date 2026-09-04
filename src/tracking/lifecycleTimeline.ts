/**
 * Egy aktivitás előtér/háttér idővonala.
 *
 * A `src/tracking/lifecycle.ts` az UTOLSÓ eseményt őrzi, hogy egy megszakadt
 * webes rögzítést újraindulás után meg lehessen magyarázni. Ez a modul mást
 * csinál: a TELJES idővonalat gyűjti, amíg egy adott aktivitás fut, hogy a
 * mentett adatban utólag látszódjon, mikor volt az app háttérben — pl. a
 * lezárt képernyős GPS-hibák diagnózisához (lásd `docs/ai/DECISIONS.md`).
 */

export type LifecycleTimelineKind = 'foreground' | 'background';

export interface LifecycleTimelineEvent {
  kind: LifecycleTimelineKind;
  at: number;
}

/**
 * @param isActive csak akkor jegyzünk eseményt, ha ez igazat ad — a
 *   feliratkozás a teljes komponensélettartamra szól, de csak rögzítés
 *   közben releváns.
 */
export function trackLifecycleTimeline(
  isActive: () => boolean,
  onEvent: (event: LifecycleTimelineEvent) => void,
): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const onVisibility = () => {
    if (!isActive()) return;
    onEvent({
      kind: document.visibilityState === 'visible' ? 'foreground' : 'background',
      at: Date.now(),
    });
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => document.removeEventListener('visibilitychange', onVisibility);
}
