/**
 * A webes rögzítő megszakadásának minimális, helyben maradó diagnosztikája.
 *
 * A félbehagyott rögzítés csak a React/oldal újraindulásakor jelenhet meg
 * újra. Nem szabad összekeverni egy sima GPS-hibával, ezért a következő
 * indításnak megőrizzük az utolsó böngésző-életciklus eseményt.
 */

const KEY = 'grundo.recorder.lifecycle.v1';

export type LifecycleKind = 'hidden' | 'pagehide';

export interface LifecycleEvent {
  kind: LifecycleKind;
  at: number;
  persisted?: boolean;
}

export function describeResumeCause(
  previous: LifecycleEvent | null,
  navigationType: string | undefined,
): string {
  if (navigationType === 'reload') {
    return 'Az oldal újratöltődött, ezért a mérés helyi mentésből állítható helyre.';
  }
  if (previous?.kind === 'pagehide' && previous.persisted === false) {
    return 'Az oldal bezárult vagy újraindult, ezért a mérés helyi mentésből állítható helyre.';
  }
  if (previous?.kind === 'hidden') {
    return 'A böngésző háttérbe került; ha közben újraindult, a mérés helyi mentésből állítható helyre.';
  }
  return 'A rögzítő oldala újraindult, ezért a mérés helyi mentésből állítható helyre.';
}

export function currentNavigationType(): string | undefined {
  if (typeof performance === 'undefined') return undefined;
  const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return entry?.type;
}

export function readLastLifecycleEvent(storage: Storage | null = safeSessionStorage()): LifecycleEvent | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LifecycleEvent>;
    if (
      (parsed.kind !== 'hidden' && parsed.kind !== 'pagehide') ||
      typeof parsed.at !== 'number'
    ) return null;
    return {
      kind: parsed.kind,
      at: parsed.at,
      ...(typeof parsed.persisted === 'boolean' ? { persisted: parsed.persisted } : {}),
    };
  } catch {
    return null;
  }
}

export function installLifecycleDiagnostics(): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => undefined;
  const write = (event: LifecycleEvent) => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(event));
    } catch {
      // A rögzítésnek privát mód vagy betelt tárhely mellett is működnie kell.
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') write({ kind: 'hidden', at: Date.now() });
  };
  const onPageHide = (event: PageTransitionEvent) => {
    write({ kind: 'pagehide', at: Date.now(), persisted: event.persisted });
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
  };
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
