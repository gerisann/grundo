/**
 * Szintek — a kumulált GP-ből.
 *
 * A szint SZÁMÍTOTT érték, nem tárolt állapot. A `users/{uid}.level` mező
 * létezik, de az csak gyorsítótár: az igazság mindig a `gpTotal` és a
 * `GAMEPLAY.LEVELS` lépcső. Így a lépcső hangolása nem igényel migrációt, és
 * nem fordulhat elő, hogy valakinek a profilja elavult szintet mutat.
 */

import { GAMEPLAY } from '@/config/gameplay';

export interface LevelProgress {
  /** 1-től indexelve — ahogy a felhasználónak mutatjuk. 1…100. */
  level: number;
  /** A teljes név, fokozattal együtt: „ROOKIE III.". */
  name: string;
  /** A következő szint neve, vagy `null`, ha ez a legmagasabb. */
  nextName: string | null;
  /** A jelenlegi szint kezdete és a következő küszöb, kumulált GP-ben. */
  from: number;
  to: number | null;
  /** Mennyi hiányzik a következő szintig. A csúcson 0. */
  remaining: number;
  /** 0 és 1 közötti haladás a sávhoz. A csúcson 1. */
  ratio: number;
}

export function levelFor(gpTotal: number): number {
  const gp = Math.max(0, gpTotal);
  let level = 1;
  for (let i = 0; i < GAMEPLAY.LEVELS.length; i += 1) {
    if (gp >= GAMEPLAY.LEVELS[i]!) level = i + 1;
  }
  return level;
}

export function levelProgress(gpTotal: number): LevelProgress {
  const gp = Math.max(0, gpTotal);
  const level = levelFor(gp);
  const from = GAMEPLAY.LEVELS[level - 1] ?? 0;
  const to = GAMEPLAY.LEVELS[level] ?? null;

  return {
    level,
    name: GAMEPLAY.LEVEL_NAMES[level - 1] ?? 'ROOKIE I.',
    nextName: to === null ? null : (GAMEPLAY.LEVEL_NAMES[level] ?? null),
    from,
    to,
    remaining: to === null ? 0 : Math.max(0, to - gp),
    // A csúcson a sáv tele van: nincs mit tovább tölteni, és egy félig
    // töltött sáv ott azt sugallná, hogy van még hova fejlődni.
    ratio: to === null ? 1 : Math.min(1, Math.max(0, (gp - from) / (to - from))),
  };
}
