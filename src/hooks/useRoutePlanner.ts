import { useCallback, useState } from 'react';
import { api, type RoutePlanResult } from '@/lib/api';
import { currentPosition, PositionUnavailableError } from '@/lib/currentPosition';
import { clearGhostRoute, rememberPlannedRoute, type GhostRoute } from '@/lib/ghostRoute';
import {
  DEFAULT_PLANNER_SETTINGS,
  toPlanInput,
  type PlannerPoint,
  type PlannerSettings,
} from '@/components/RoutePlannerSheet';
import type { ActivityType } from '@/types';

/**
 * Az útvonaltervezés állapota — a rögzítés képernyőn kívül tartva.
 *
 * MIÉRT KÜLÖN HOOK? Mert a `TrackingScreen` már 1900 sor fölött van, és ez a
 * folyamat önmagában is sok állapotot visz: pontok, beállítások, a tervezés
 * futása, az eredmény, és a két lap (beállítások / zsákmány) közti váltás.
 * A képernyő így csak megjeleníti, amit ez a hook eldönt.
 *
 * ⚠️ EZ A HOOK NEM ÍR JÁTÉKADATOT. A terv csak javaslat; területet, GP-t és
 * mezőket kizárólag a tényleges rögzítés eredményez.
 */

/** A tervező melyik lapja látszik épp. */
export type PlannerStage = 'closed' | 'settings' | 'reward';

export interface RoutePlannerState {
  stage: PlannerStage;
  from: PlannerPoint | null;
  to: PlannerPoint | null;
  /** Egy elem `null`, amíg nincs kijelölve — lásd `addStop`. */
  stops: (PlannerPoint | null)[];
  settings: PlannerSettings;
  plan: RoutePlanResult | null;
  busy: boolean;
  error: string | null;
  /** Melyik ponthoz várunk térképi koppintást, ha épp arra várunk. */
  picking: 'from' | 'to' | number | null;
}

const EMPTY: RoutePlannerState = {
  stage: 'closed',
  from: null,
  to: null,
  stops: [],
  settings: DEFAULT_PLANNER_SETTINGS,
  plan: null,
  busy: false,
  error: null,
  picking: null,
};

export function useRoutePlanner(activityType: ActivityType) {
  const [state, setState] = useState<RoutePlannerState>(EMPTY);

  const open = useCallback(() => {
    setState((prev) => ({ ...prev, stage: 'settings', error: null }));
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, stage: 'closed', picking: null }));
  }, []);

  /** Vissza a beállításokhoz — ez a fogaskerék gomb a térképen. */
  const reopenSettings = useCallback(() => {
    setState((prev) => ({ ...prev, stage: 'settings', error: null }));
  }, []);

  const setPoint = useCallback((role: 'from' | 'to' | number, point: PlannerPoint) => {
    setState((prev) => {
      if (role === 'from') return { ...prev, from: point, picking: null };
      if (role === 'to') return { ...prev, to: point, picking: null };
      const stops = [...prev.stops];
      stops[role] = point;
      return { ...prev, stops, picking: null };
    });
  }, []);

  /*
    ⚠️ AZ ÜRES MEGÁLLÓ `null`, NEM (0, 0). A nullpont a Guineai-öbölben van:
    egy kijelöletlen megállóval a tervező odáig akarna eljutni. Így viszont
    látszik, hogy még nincs kitöltve, és a tervezés sem indulhat.
  */
  const addStop = useCallback(() => {
    setState((prev) => (prev.stops.length >= 5 ? prev : { ...prev, stops: [...prev.stops, null] }));
  }, []);

  const removeStop = useCallback((index: number) => {
    setState((prev) => ({ ...prev, stops: prev.stops.filter((_, i) => i !== index) }));
  }, []);

  const setSettings = useCallback((settings: PlannerSettings) => {
    setState((prev) => ({ ...prev, settings }));
  }, []);

  /**
   * Térképi kijelölés kérése: elrejtjük a lapot, hogy látszódjon a térkép.
   *
   * A lap NEM zárul be — a `picking` jelzi, hogy visszatérünk ide, amint
   * megvan a pont.
   */
  const pickOnMap = useCallback((role: 'from' | 'to' | number) => {
    setState((prev) => ({ ...prev, stage: 'closed', picking: role }));
  }, []);

  /** A térképi koppintás eredménye — a hívó adja át a koordinátát. */
  const acceptMapPick = useCallback((lat: number, lng: number) => {
    setState((prev) => {
      if (prev.picking === null) return prev;
      const point: PlannerPoint = { lat, lng };
      const role = prev.picking;
      const next =
        role === 'from'
          ? { ...prev, from: point }
          : role === 'to'
            ? { ...prev, to: point }
            : { ...prev, stops: prev.stops.map((s, i) => (i === role ? point : s)) };
      return { ...next, picking: null, stage: 'settings' as const };
    });
  }, []);

  const useCurrentPositionAsStart = useCallback(async () => {
    try {
      const fix = await currentPosition();
      setState((prev) => ({
        ...prev,
        from: { lat: fix.lat, lng: fix.lng, label: 'Jelenlegi pozícióm' },
        error: null,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error:
          error instanceof PositionUnavailableError
            ? 'Nem sikerült meghatározni a helyzetedet. Engedélyezd a helymeghatározást, vagy jelöld ki a rajtot a térképen.'
            : 'Nem sikerült meghatározni a helyzetedet.',
      }));
    }
  }, []);

  /**
   * A tervezés lefuttatása.
   *
   * ⚠️ LASSÚ (mérve 3,6–7 s), ezért a lap `busy` állapotba kerül, és a gomb
   * letiltódik — kétszeres kérés a heti keretből is kétszer vonna.
   */
  const runPlan = useCallback(async () => {
    const { from, to, stops, settings } = state;
    if (!from || !to) return;

    setState((prev) => ({ ...prev, busy: true, error: null }));
    try {
      const result = await api.routesPlan(
        toPlanInput(from, to, stops, settings, activityType),
      );
      setState((prev) => ({ ...prev, busy: false, plan: result, stage: 'reward' }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        busy: false,
        /*
          A szerver magyar, érthető üzenetet ad (kvóta, túl messze, nincs kör) —
          azt mutatjuk, nem nyers hibaszöveget.
        */
        error: error instanceof Error ? error.message : 'Nem sikerült megtervezni az útvonalat.',
      }));
    }
  }, [state, activityType]);

  /**
   * Vissza barangoláshoz — a terv ELVETÉSE.
   *
   * ⚠️ A SZELLEMVONALAT IS TÖRLI. Enélkül a tervezett útvonal ottmaradna a
   * rögzítés térképén, miközben a felhasználó már azt választotta, hogy
   * szabadon barangol — a vonal ilyenkor nem segítség, hanem zavar.
   */
  const discardPlan = useCallback(() => {
    clearGhostRoute();
    setState((prev) => ({ ...prev, plan: null, stage: 'closed', picking: null, error: null }));
  }, []);

  /**
   * „Gyerünk!” — a terv átadása a rögzítésnek.
   *
   * A szellemvonal ugyanabba a tárba kerül, amit a küldetések is használnak,
   * tehát a navigáció ugyanúgy indul, mint eddig.
   */
  const startPlanned = useCallback((): GhostRoute | null => {
    if (!state.plan) return null;
    const ghost = rememberPlannedRoute({
      polyline: state.plan.polyline,
      totalDistanceM: state.plan.totalDistanceM,
      maneuvers: state.plan.maneuvers,
      stolenCells: state.plan.reward?.stolenCells,
      newCells: state.plan.reward?.newCells,
      /* A törésponthoz: a válasz külön adja az odautat és a visszautat. */
      outboundPoints: state.plan.outbound.length,
      roadClasses: state.plan.roadClasses,
    });
    setState((prev) => ({ ...prev, stage: 'closed' }));
    return ghost;
  }, [state.plan]);

  return {
    state,
    open,
    close,
    discardPlan,
    reopenSettings,
    setPoint,
    addStop,
    removeStop,
    setSettings,
    pickOnMap,
    acceptMapPick,
    useCurrentPositionAsStart,
    runPlan,
    startPlanned,
  };
}
