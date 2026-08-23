import { GAMEPLAY } from '@/config/gameplay';

/**
 * Távolságalapú cél, visszafelé kompatibilis időbecsléssel.
 *
 * Az új backend a `distanceKm` mezőt használja. A kilométeres bemenet előtti
 * verzió viszont csak a `minutes` mezőt ismeri, ezért a két frontend/backend
 * telepítés közti rövid időben is küldünk egy érvényes becslést.
 */
export function compatibleDistanceTarget(
  distanceKm: number,
  paceSecPerKm: number,
): { distanceKm: number; minutes: number } {
  const estimate = Math.round((distanceKm * paceSecPerKm) / 60);
  return {
    distanceKm,
    minutes: Math.max(
      GAMEPLAY.MISSION_MIN_MINUTES,
      Math.min(GAMEPLAY.MISSION_MAX_MINUTES, estimate),
    ),
  };
}
