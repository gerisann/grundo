/**
 * Heti bontás az aktivitás-listából.
 *
 * MIÉRT A LISTÁBÓL, ÉS NEM A PROFILBÓL? Mert a profil összesítői mindenkori
 * értékek (`counters.distanceKm`), nem naprakész heti bontás. Egy külön heti
 * összegzőt tárolni azt jelentené, hogy hétfő hajnalban valakinek nulláznia
 * kell — és ha az a feladat kimarad vagy kétszer fut le, a felhasználó hamis
 * számot lát. A lekért aktivitásokból számolva ez a hiba nem létezhet.
 *
 * A HÉT HÉTFŐVEL KEZDŐDIK — magyar konvenció. A `Date.getDay()` vasárnapot ad
 * nullának, ezért kell az eltolás.
 */

import type { FeedActivity } from '@/lib/api';

export interface WeekDay {
  /** Egybetűs címke a diagram alatt: H K Sz Cs P Szo V */
  label: string;
  /** A nap kezdete, epoch ms — kulcsnak és összehasonlításhoz. */
  startOfDay: number;
  distanceM: number;
  movingS: number;
  gp: number;
  activities: number;
  /** Ma van-e. A mai oszlopot kiemeljük, mert még nem teljes. */
  today: boolean;
}

export interface WeekSummary {
  days: WeekDay[];
  distanceM: number;
  movingS: number;
  gp: number;
  activities: number;
  /** A leghosszabb nap távja — a diagram oszlopainak viszonyítási alapja. */
  peakM: number;
}

const LABELS = ['H', 'K', 'Sz', 'Cs', 'P', 'Szo', 'V'];

/** Az adott dátumot tartalmazó hét hétfőjének 00:00-ja. */
export function startOfWeek(at: Date): Date {
  const monday = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  // getDay(): 0 = vasárnap. A (n + 6) % 7 hétfőt tesz nullára.
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

export function weekSummary(activities: readonly Pick<FeedActivity, 'startedAt' | 'distanceM' | 'movingS' | 'gp'>[], now = new Date()): WeekSummary {
  const monday = startOfWeek(now);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const days: WeekDay[] = LABELS.map((label, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    const startOfDay = day.getTime();
    return {
      label,
      startOfDay,
      distanceM: 0,
      movingS: 0,
      gp: 0,
      activities: 0,
      today: startOfDay === todayStart,
    };
  });

  const summary: WeekSummary = {
    days,
    distanceM: 0,
    movingS: 0,
    gp: 0,
    activities: 0,
    peakM: 0,
  };

  for (const activity of activities) {
    const at = new Date(activity.startedAt);
    const startOfDay = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
    const bucket = days.find((day) => day.startOfDay === startOfDay);
    // A héten kívüli aktivitás nem hiba: a lista több hetet is tartalmazhat.
    if (!bucket) continue;

    bucket.distanceM += activity.distanceM;
    bucket.movingS += activity.movingS;
    bucket.gp += activity.gp;
    bucket.activities += 1;

    summary.distanceM += activity.distanceM;
    summary.movingS += activity.movingS;
    summary.gp += activity.gp;
    summary.activities += 1;
  }

  summary.peakM = Math.max(0, ...days.map((day) => day.distanceM));
  return summary;
}
