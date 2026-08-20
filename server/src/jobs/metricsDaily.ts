/**
 * Napi használati aggregátum — az admin áttekintőnek.
 *
 * A `daily-rollover` hívja, de csak NAPONTA EGYSZER (a helyi éjfél utáni első
 * órás futáskor), nem minden órában — az admin áttekintő egy naptári napra
 * egy pillanatképet vár, nem huszonnégyet.
 *
 * DAU/WAU/MAU a `users.streak.lastActiveDay`-ből jön, ami minden aktivitás-
 * mentéskor frissül (`activityCommit.ts` → `advanceStreak`) — ez a felhasználó
 * SAJÁT helyi napja, nem a rögzített `GAME_TIMEZONE`. A legtöbb felhasználónál
 * ez ugyanaz vagy néhány órás eltérés a nap szélén; ennél pontosabb közelítés
 * a felhasználónkénti időzóna nélkül nem érhető el olcsón, és az admin
 * áttekintőnél ez a pontosság elég.
 *
 * docs/05-adatmodell.md → `metricsDaily/{day}`
 * docs/06-architektura-es-admin.md → Admin felület · 1. Áttekintő
 */

import { Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS, db } from '../lib/firebase';
import { GAME_TIMEZONE, gameDay, localDayWindow, localHour } from '../lib/gridMath';

export interface MetricsDailySummary {
  day: number;
  dau: number;
  wau: number;
  mau: number;
  signups: number;
  activities: number;
  distanceKm: number;
  claimedCellsNet: number;
  activeStreaks: number;
}

/**
 * Igaz, ha ÉPP MOST van a naponta egyszeri aggregálás órája.
 *
 * A `daily-rollover` óránként fut; a napi aggregátumot csak akkor számoljuk,
 * amikor a helyi óra 0 — ez az órás ütemben naponta pontosan egyszer
 * következik be, `Europe/Budapest` szerint.
 */
export function isMetricsDailyHour(now: Date): boolean {
  return localHour(now, GAME_TIMEZONE) === 0;
}

/**
 * Az aggregátum kiszámítása egy LEZÁRT napra.
 *
 * A jelenlegi léptékben (napi néhány felhasználó) a teljes dokumentum-
 * beolvasás olcsóbb és megbízhatóbb, mint egy még sosem futtatott aggregáló
 * lekérdezés bevezetése — ha a kollekció mérete ezt indokolja majd, ide
 * kerülhet a `count()`/`sum()` optimalizálás.
 */
export async function computeMetricsDaily(day: number): Promise<MetricsDailySummary> {
  const { start, end } = localDayWindow(day, GAME_TIMEZONE);
  const startTs = Timestamp.fromDate(start);
  const endTs = Timestamp.fromDate(end);

  const usersCol = db.collection(COLLECTIONS.users);

  const [signupsSnap, activitiesSnap, dauSnap, wauSnap, mauSnap, activeStreaksSnap] =
    await Promise.all([
      usersCol.where('createdAt', '>=', startTs).where('createdAt', '<', endTs).get(),
      db
        .collection(COLLECTIONS.activities)
        .where('createdAt', '>=', startTs)
        .where('createdAt', '<', endTs)
        .get(),
      usersCol.where('streak.lastActiveDay', '==', day).get(),
      usersCol.where('streak.lastActiveDay', '>=', day - 6).get(),
      usersCol.where('streak.lastActiveDay', '>=', day - 29).get(),
      usersCol.where('streak.current', '>', 0).get(),
    ]);

  let distanceM = 0;
  let claimedCells = 0;
  for (const doc of activitiesSnap.docs) {
    const data = doc.data() as { distanceM?: number; summary?: { claimedCells?: number } };
    distanceM += Number(data.distanceM ?? 0);
    claimedCells += Number(data.summary?.claimedCells ?? 0);
  }

  return {
    day,
    dau: dauSnap.size,
    wau: wauSnap.size,
    mau: mauSnap.size,
    signups: signupsSnap.size,
    activities: activitiesSnap.size,
    distanceKm: distanceM / 1000,
    claimedCellsNet: claimedCells,
    activeStreaks: activeStreaksSnap.size,
  };
}

export async function writeMetricsDaily(summary: MetricsDailySummary): Promise<void> {
  await db
    .collection(COLLECTIONS.metricsDaily)
    .doc(String(summary.day))
    .set({ ...summary, computedAt: Timestamp.now() }, { merge: true });
}

/**
 * Belépési pont a napi fordulóból.
 *
 * Ha nincs itt az órája, nem csinál semmit. Ha itt van, kiszámolja és
 * felülírja a MOST ZÁRULÓ nap aggregátumát — determinisztikus dokumentum-
 * névvel (`metricsDaily/{day}`), tehát egy megismételt futás felülír, nem
 * duplikál.
 */
export async function maybeRunMetricsDaily(now: Date): Promise<MetricsDailySummary | null> {
  if (!isMetricsDailyHour(now)) return null;
  const closedDay = gameDay(now) - 1;
  const summary = await computeMetricsDaily(closedDay);
  await writeMetricsDaily(summary);
  return summary;
}
