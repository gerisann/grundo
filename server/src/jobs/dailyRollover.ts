/**
 * Napi forduló — HELYI IDŐ szerint.
 *
 * A job ÓRÁNKÉNT fut, és mindig azokat a felhasználókat dolgozza fel, akiknél
 * az elmúlt órában fordult a helyi éjfél. Így a terhelés egyenletesen oszlik
 * el a nap 24 órájára — ez üzemeltetési szempontból kényelmesebb is, mint
 * egyetlen UTC-csúcs.
 *
 * SORREND (nem cserélhető fel):
 *   1. hold-bónusz kiosztása a birtokolt terület után
 *   2. sorozat-értékelés (fagyasztás, megszakadás)
 *   3. heti/havi ablakzárás: gpWeek/gpMonth nullázás, heti sorozat, mérföldkövek
 *
 * ⚠️ A VÉDELEM NEM ITT ÁLL VISSZA. Az elévülés olvasáskor számolódik
 * (`effectiveDefense()`), és ott a nap `Europe/Budapest` szerint telik, mert a
 * cellának nincs időzónája. A szakasz korábbi szövege felsorolt egy „védelem
 * visszaállítása" lépést; az a 2026-08-19-i tisztázással kikerült, mert
 * ellentmondott az olvasáskori elévülésnek — egy „mindent visszaír" job több
 * tízezer dokumentumot érintene, és félbeszakadva a rács fele elévülne, a
 * másik fele nem.
 *
 * EGY FUTÁS = EGY NAP. Ha a job kiesett néhány napra, nem próbálunk egyszerre
 * bepótolni mindent: minden futás pontosan egy naphatárt lép át. Az óránkénti
 * ütem így napi 24 nap lemaradást hoz be, a kód viszont marad egyetlen,
 * átlátható úton — nincs külön „pótlás" ág, ami csak kiesés után futna, tehát
 * sosem lenne rendesen tesztelve.
 *
 * docs/03-jatekszabalyok.md → Napi forduló
 * docs/04-pontrendszer.md   → Napi tartás (hold) bónusz
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { computeHoldBonus } from '../../../src/game/scoring';
import { levelFor } from '../../../src/game/levels';
import { modifierFactor, type Modifier } from '../../../src/game/modifiers';
import type { GameplayConfig } from '../../../src/config/gameplay';
import { COLLECTIONS, db } from '../lib/firebase';
import { gameDay, localDay, monthOf, nextLocalMidnight, weekOf } from '../lib/gridMath';
import { getGameplaySnapshot } from '../lib/gameplayConfig';
import { getModifiers } from '../lib/modifiers';
import { maybeRunMetricsDaily } from './metricsDaily';
import { notifyGpDaily, notifyModifierStarted } from '../lib/notifications';

export const DEFAULT_TIMEZONE = 'Europe/Budapest';

/** Egy futásban legfeljebb ennyi felhasználót dolgozunk fel. */
const DEFAULT_BATCH = 500;

export interface RolloverSummary {
  usersProcessed: number;
  /** Akiknél most jegyeztük be először a fordulót — nekik még nem jár jóváírás. */
  usersSeeded: number;
  holdGpAwarded: number;
  streaksBroken: number;
  freezesUsed: number;
  milestonesAwarded: number;
  weeksClosed: number;
  errors: number;
  configVersion: number;
}

// ════════════════════════════════════════════════════════════════════════════
//  A TERVEZŐ — tiszta függvény, Firestore nélkül
// ════════════════════════════════════════════════════════════════════════════

export interface StoredRolloverStreak {
  current?: number;
  longest?: number;
  lastActiveDay?: number | null;
  freezesLeftThisWeek?: number;
  weeks?: number;
  weekActiveDays?: number;
  milestonesAwarded?: number[];
}

export interface RolloverUserState {
  timezone?: string | null;
  territoryM2?: { foot?: number; bike?: number } | null;
  gpTotal?: number;
  streak?: StoredRolloverStreak | null;
  rollover?: { lastDay?: number | null } | null;
  bandaStats?: Record<string, Record<string, unknown>> | null;
}

export interface PlannedStreak {
  current: number;
  longest: number;
  lastActiveDay: number | null;
  freezesLeftThisWeek: number;
  weeks: number;
  weekActiveDays: number;
  milestonesAwarded: number[];
}

export interface RolloverPlan {
  kind: 'seed' | 'advance' | 'noop';
  /** A most lezáruló nap — ezt értékeljük. */
  closedDay: number;
  /** Az új nap, ahová lépünk. */
  newDay: number;
  hold: { foot: number; bike: number; total: number };
  holdFactor: number;
  streak: PlannedStreak;
  streakBroken: boolean;
  freezeUsed: boolean;
  weekClosed: boolean;
  monthClosed: boolean;
  /** A most kiosztott mérföldkő hetei, vagy null. */
  milestoneWeeks: number | null;
  milestoneGp: number;
  /** A felhasználó GP-jének teljes növekménye ebben a fordulóban. */
  gpDelta: number;
  nextDueAt: Date;
  timezone: string;
}

export interface PlanContext {
  now: Date;
  cfg: GameplayConfig;
  /** A `hold_multiplier` modifierek eredője erre a felhasználóra. */
  holdFactor?: number;
}

/**
 * Mi történjen ezzel a felhasználóval? Semmit nem ír, csak eldönti.
 *
 * Azért különálló, tiszta függvény, mert a forduló szabályai (fagyasztás,
 * hétforduló, mérföldkő) pontosan az a fajta logika, amit unit-teszttel kell
 * körbekeríteni — emulátort indítani minden határesethez kényelmetlen, és
 * kényelmetlen tesztet senki nem ír meg.
 */
export function planRollover(user: RolloverUserState, ctx: PlanContext): RolloverPlan {
  const timezone = user.timezone || DEFAULT_TIMEZONE;
  const today = localDay(ctx.now, timezone);
  const lastDay = user.rollover?.lastDay;
  const stored = user.streak ?? {};
  const cfg = ctx.cfg;

  const streak: PlannedStreak = {
    current: numberOr(stored.current, 0),
    longest: numberOr(stored.longest, 0),
    lastActiveDay: typeof stored.lastActiveDay === 'number' ? stored.lastActiveDay : null,
    freezesLeftThisWeek: numberOr(stored.freezesLeftThisWeek, cfg.STREAK_FREEZES_PER_WEEK),
    weeks: numberOr(stored.weeks, 0),
    weekActiveDays: numberOr(stored.weekActiveDays, 0),
    milestonesAwarded: Array.isArray(stored.milestonesAwarded)
      ? [...stored.milestonesAwarded]
      : [],
  };

  const idle = (kind: 'seed' | 'noop', closedDay: number, newDay: number): RolloverPlan => ({
    kind,
    closedDay,
    newDay,
    hold: { foot: 0, bike: 0, total: 0 },
    holdFactor: 1,
    streak,
    streakBroken: false,
    freezeUsed: false,
    weekClosed: false,
    monthClosed: false,
    milestoneWeeks: null,
    milestoneGp: 0,
    gpDelta: 0,
    nextDueAt: nextLocalMidnight(ctx.now, timezone),
    timezone,
  });

  /**
   * Első találkozás: csak bejegyezzük, hol tart, jóváírás nélkül.
   *
   * Jóváírni azért nem szabad, mert nem tudjuk, mióta van így: egy régi fiók
   * első fordulója különben egyetlen napra kapná meg az egész addigi tartást.
   */
  if (typeof lastDay !== 'number') return idle('seed', today, today);
  if (today <= lastDay) return idle('noop', lastDay, lastDay);

  const closedDay = lastDay;
  const newDay = lastDay + 1;
  const holdFactor = positive(ctx.holdFactor);

  // ── 1. Hold-bónusz a lezárt napra ────────────────────────────────────────
  const daysSinceActive =
    streak.lastActiveDay === null ? Number.POSITIVE_INFINITY : closedDay - streak.lastActiveDay;
  const foot = computeHoldBonus(numberOr(user.territoryM2?.foot, 0), daysSinceActive, cfg, holdFactor);
  const bike = computeHoldBonus(numberOr(user.territoryM2?.bike, 0), daysSinceActive, cfg, holdFactor);

  // ── 2. Sorozat-értékelés ─────────────────────────────────────────────────
  const wasActive = streak.lastActiveDay !== null && streak.lastActiveDay >= closedDay;
  let streakBroken = false;
  let freezeUsed = false;

  if (wasActive) {
    streak.weekActiveDays += 1;
  } else if (streak.current > 0) {
    /**
     * A fagyasztás a NAPI sorozatot védi, a hetit nem.
     *
     * A kihagyott nap attól még kihagyott nap: a heti sorozathoz megkövetelt
     * aktív napokba nem számít bele. Enélkül a fagyasztás két jutalmat adna
     * egyetlen kihagyásért.
     */
    if (streak.freezesLeftThisWeek > 0) {
      streak.freezesLeftThisWeek -= 1;
      freezeUsed = true;
    } else {
      streak.current = 0;
      streakBroken = true;
    }
  }

  // ── 3. Heti / havi ablakzárás ────────────────────────────────────────────
  const weekClosed = weekOf(newDay) > weekOf(closedDay);
  const monthClosed = monthOf(newDay) > monthOf(closedDay);

  let milestoneWeeks: number | null = null;
  let milestoneGp = 0;

  if (weekClosed) {
    streak.weeks =
      streak.weekActiveDays >= cfg.WEEK_STREAK_MIN_ACTIVE_DAYS ? streak.weeks + 1 : 0;
    streak.weekActiveDays = 0;
    // A fagyasztás az ÚJ hétre töltődik újra — a lezárt hét kihagyását még a
    // régi hét kerete fedezte (lásd fent).
    streak.freezesLeftThisWeek = cfg.STREAK_FREEZES_PER_WEEK;

    const reward = cfg.WEEK_STREAK_MILESTONES[streak.weeks];
    if (
      typeof reward === 'number' &&
      reward > 0 &&
      streak.weeks > 0 &&
      !streak.milestonesAwarded.includes(streak.weeks)
    ) {
      milestoneWeeks = streak.weeks;
      milestoneGp = reward;
      streak.milestonesAwarded = [...streak.milestonesAwarded, streak.weeks];
    }
  }

  /**
   * A következő esedékesség.
   *
   * Ha még le vagyunk maradva (a lépett nap nem a mai), akkor MOST esedékes —
   * így a következő futás azonnal viszi tovább, és a lemaradás óránként fogy.
   */
  const nextDueAt = newDay < today ? new Date(ctx.now) : nextLocalMidnight(ctx.now, timezone);

  return {
    kind: 'advance',
    closedDay,
    newDay,
    hold: { foot, bike, total: foot + bike },
    holdFactor,
    streak,
    streakBroken,
    freezeUsed,
    weekClosed,
    monthClosed,
    milestoneWeeks,
    milestoneGp,
    gpDelta: foot + bike + milestoneGp,
    nextDueAt,
    timezone,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  A VÉGREHAJTÓ
// ════════════════════════════════════════════════════════════════════════════

/**
 * Egy óra fordulója.
 *
 * @param now a futás időpontja — sose olvasd közvetlenül a rendszerórát, hogy
 *            tesztelhető maradjon
 */
export async function runDailyRollover(
  now: Date,
  options: { limit?: number } = {},
): Promise<RolloverSummary> {
  const limit = options.limit ?? DEFAULT_BATCH;
  const snapshot = await getGameplaySnapshot(now);
  const modifiers = await getModifiers(now);

  const summary: RolloverSummary = {
    usersProcessed: 0,
    usersSeeded: 0,
    holdGpAwarded: 0,
    streaksBroken: 0,
    freezesUsed: 0,
    milestonesAwarded: 0,
    weeksClosed: 0,
    errors: 0,
    configVersion: snapshot.version,
  };

  const due = await db
    .collection(COLLECTIONS.users)
    .where('rollover.nextDueAt', '<=', Timestamp.fromDate(now))
    .orderBy('rollover.nextDueAt')
    .limit(limit)
    .get();

  for (const doc of due.docs) {
    try {
      const result = await rolloverUser(doc.id, now, snapshot.config, snapshot.version, modifiers);
      if (result === 'seeded') summary.usersSeeded += 1;
      else if (result !== null) {
        summary.usersProcessed += 1;
        summary.holdGpAwarded += result.hold.total;
        summary.streaksBroken += result.streakBroken ? 1 : 0;
        summary.freezesUsed += result.freezeUsed ? 1 : 0;
        summary.milestonesAwarded += result.milestoneWeeks !== null ? 1 : 0;
        summary.weeksClosed += result.weekClosed ? 1 : 0;
        // Csak a Firestore `notifications` alkollekcióba ír — a `users` doksi
        // GP-mezőit NEM érinti, tehát nem veszélyezteti a fenti, pontos
        // értékeket ellenőrző teszteket (lásd a jelvény-kiértékelés
        // eltávolításának indoklását `lib/badges.ts` fejlécében — ez a hívás
        // más okból biztonságos, nem azért, mert ugyanazt kevésbé nézzük).
        notifyGpDaily(doc.id, result.hold.total);
      }
    } catch (error) {
      /**
       * Egy felhasználó hibája nem állíthatja meg a többit. A `nextDueAt`
       * ilyenkor változatlan marad, tehát a következő óra újra próbálja —
       * ez a helyes viselkedés egy átmeneti hibánál.
       */
      summary.errors += 1;
      console.error(`[dailyRollover] a(z) ${doc.id} felhasználó fordulója elhasalt`, error);
    }
  }

  await recordRun(now, summary);
  await runMetricsDailyIfDue(now);
  await notifyStartedModifiersIfDue(now);
  return summary;
}

/**
 * „Aktív akció indul" — Geri 5. pontja.
 *
 * Az óránként futó fordulóban ellenőrizzük, elindult-e azóta egy GLOBÁLIS
 * modifier — a `notifiedAt` mező zárja ki az ismétlést, akkor is, ha a
 * forduló egy órán belül kétszer fut.
 *
 * ⚠️ CSAK `scope: 'global'`. Egy `area`/`segment` modifier csak a
 * felhasználók egy részét érinti, és a célzáshoz (kinek a birodalma esik az
 * érintett cellákba) a `zones` kollekció kellene, ami még nincs megírva
 * (ugyanaz a hiány, mint a hold-modifier területi hatókörénél,
 * `dailyRollover.ts` fentebb). Kitalálni helyette rossz célzást hazugság
 * lenne — inkább kimarad, amíg a `zones` megvan.
 *
 * ⚠️ A BROADCAST MINDEN felhasználóhoz megy. GRUNDO jelenlegi méreténél ez
 * elhanyagolható; ha a felhasználószám megnő, ez a lépés újragondolandó
 * (pl. kötegelt, több lépcsős kiküldés).
 */
async function notifyStartedModifiersIfDue(now: Date): Promise<void> {
  try {
    const snapshot = await db
      .collection(COLLECTIONS.modifiers)
      .where('scope', '==', 'global')
      .where('from', '<=', Timestamp.fromDate(now))
      .where('to', '>', Timestamp.fromDate(now))
      .get();

    const starting = snapshot.docs.filter((doc) => !doc.data().notifiedAt);
    if (starting.length === 0) return;

    const users = await db.collection(COLLECTIONS.users).select().get();
    const uids = users.docs.map((doc) => doc.id);

    for (const doc of starting) {
      const reason = String((doc.data() as { reason?: string }).reason ?? 'Új akció');
      notifyModifierStarted(uids, reason);
      await doc.ref.set({ notifiedAt: Timestamp.fromDate(now) }, { merge: true });
    }
  } catch (error) {
    console.error('[dailyRollover] az akció-indulás értesítés elhasalt', error);
  }
}

/**
 * Egy hibás aggregálás nem állíthatja meg a fordulót — a felhasználóknak már
 * kiosztott GP addigra megvan, és a `metricsDaily` csak az admin áttekintőt
 * táplálja, a játékmenetet nem.
 */
async function runMetricsDailyIfDue(now: Date): Promise<void> {
  try {
    await maybeRunMetricsDaily(now);
  } catch (error) {
    console.error('[dailyRollover] a napi aggregátum számítása elhasalt', error);
  }
}

/** `null`, ha nem volt teendő; `'seeded'`, ha csak bejegyeztük. */
async function rolloverUser(
  uid: string,
  now: Date,
  cfg: GameplayConfig,
  configVersion: number,
  modifiers: readonly Modifier[],
): Promise<RolloverPlan | 'seeded' | null> {
  const userRef = db.collection(COLLECTIONS.users).doc(uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) return null;
    const user = snap.data() as RolloverUserState;

    /**
     * A hold-modifier a tranzakción KÍVÜLRŐL kapott listából számol.
     *
     * TERÜLETI HATÓKÖR EGYELŐRE NEM ÉRVÉNYESÜL a tartás-bónuszon: ahhoz tudni
     * kellene, a felhasználó birodalmának mekkora hányada esik a bónuszterületre,
     * ez pedig a `zones` kollekciót igényli, ami még nincs megírva. A
     * `modifierFactor` üres mintával 0 részesedést ad, tehát a területi modifier
     * ilyenkor NEM HAT — inkább maradjon el a bónusz, mint hogy rosszul járjon.
     * A globális és a szegmens hatókör működik.
     */
    const hold = modifierFactor(modifiers, 'hold_multiplier', {}, now.getTime(), cfg);
    const plan = planRollover(user, { now, cfg, holdFactor: hold.factor });

    if (plan.kind === 'noop') {
      // A `nextDueAt` mégis frissül, különben a lekérdezés minden órában
      // visszahozná ugyanezt a felhasználót.
      tx.set(
        userRef,
        { rollover: { lastDay: plan.newDay, nextDueAt: Timestamp.fromDate(plan.nextDueAt) } },
        { merge: true },
      );
      return null;
    }

    if (plan.kind === 'seed') {
      tx.set(
        userRef,
        { rollover: { lastDay: plan.newDay, nextDueAt: Timestamp.fromDate(plan.nextDueAt) } },
        { merge: true },
      );
      return 'seeded';
    }

    const gpBefore = numberOr(user.gpTotal, 0);
    const gpAfter = gpBefore + plan.gpDelta;
    const ledgerDay = gameDay(now);

    const update: Record<string, unknown> = {
      streak: plan.streak,
      rollover: {
        lastDay: plan.newDay,
        nextDueAt: Timestamp.fromDate(plan.nextDueAt),
        lastRunAt: Timestamp.fromDate(now),
      },
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (plan.gpDelta > 0) {
      update.gpTotal = gpAfter;
      update.level = levelFor(gpAfter);
    }

    /**
     * A heti/havi ablak nullázása MEGELŐZI a mai jóváírást.
     *
     * A hold-bónusz könyvelési napja az új nap, tehát az új hét számlájára megy.
     * Ha fordítva csinálnánk, a hétfő hajnali jóváírás azonnal el is tűnne a
     * nullázásban, és a felhasználó egy hétig nem értené, hova lett.
     */
    if (plan.weekClosed) update.gpWeek = plan.gpDelta;
    else if (plan.gpDelta > 0) update.gpWeek = FieldValue.increment(plan.gpDelta);

    if (plan.monthClosed) update.gpMonth = plan.gpDelta;
    else if (plan.gpDelta > 0) update.gpMonth = FieldValue.increment(plan.gpDelta);

    /**
     * Az `areaDay`/`areaWeek`/`areaMonth` NEM kap jóváírást itt — azok
     * kizárólag a claim-nél nőnek (`activityCommit.ts`/`activityChunked.ts`).
     * A forduló dolga csak a nullázás a határon, a `gpWeek`/`gpMonth`
     * mintájától eltérően nincs "átvitt" napi delta, amit meg kellene
     * előznie: minden `advance` egy naphatárt lép át, tehát az `areaDay`
     * MINDIG nullázódik; a hét/hónap csak a saját zárásánál.
     */
    update.areaDay = { foot: 0, bike: 0 };
    if (plan.weekClosed) update.areaWeek = { foot: 0, bike: 0 };
    if (plan.monthClosed) update.areaMonth = { foot: 0, bike: 0 };

    const storedBandaStats = (user.bandaStats as Record<string, Record<string, unknown>> | undefined) ?? {};
    update.bandaStats = Object.fromEntries(['run', 'walk', 'ride'].map((type) => {
      const stats = storedBandaStats[type] ?? {};
      return [type, {
        ...stats,
        areaDayM2: 0,
        gpDay: 0,
        ...(plan.weekClosed ? { areaWeekM2: 0, gpWeek: 0 } : {}),
        ...(plan.monthClosed ? { areaMonthM2: 0, gpMonth: 0 } : {}),
      }];
    }));

    tx.set(userRef, update, { merge: true });

    /**
     * A főkönyv a pontok egyetlen igazságforrása, az azonosító pedig
     * determinisztikus — ugyanarra a napra kétszer futva ugyanaz a dokumentum
     * íródik felül, nem keletkezik második jóváírás.
     */
    if (plan.hold.total > 0) {
      tx.set(db.collection(COLLECTIONS.gpLedger).doc(`hold_${uid}_${plan.closedDay}`), {
        userId: uid,
        source: 'hold',
        amount: plan.hold.total,
        hold: { foot: plan.hold.foot, bike: plan.hold.bike },
        multiplier: plan.holdFactor,
        modifiers: hold.applied,
        configVersion,
        note: `Tartás-bónusz a ${plan.closedDay}. játéknapra (${plan.timezone}).`,
        at: Timestamp.fromDate(now),
        day: ledgerDay,
        localDay: plan.closedDay,
      });
    }

    if (plan.milestoneWeeks !== null && plan.milestoneGp > 0) {
      tx.set(db.collection(COLLECTIONS.gpLedger).doc(`milestone_${uid}_${plan.milestoneWeeks}`), {
        userId: uid,
        source: 'streak_milestone',
        amount: plan.milestoneGp,
        configVersion,
        note: `${plan.milestoneWeeks} hetes sorozat mérföldkő.`,
        at: Timestamp.fromDate(now),
        day: ledgerDay,
        localDay: plan.closedDay,
      });
    }

    return plan;
  });
}

/** A futás nyoma az admin „Rendszer" oldalához. */
async function recordRun(now: Date, summary: RolloverSummary): Promise<void> {
  const id = now.toISOString().slice(0, 13).replace(/[:-]/g, ''); // YYYYMMDDTHH
  try {
    await db
      .collection(COLLECTIONS.rolloverRuns)
      .doc(id)
      .set({ ...summary, at: Timestamp.fromDate(now) }, { merge: true });
  } catch (error) {
    // A futás naplója kényelmi funkció; ha nem sikerül, az nem teszi
    // érvénytelenné a már kiosztott pontokat.
    console.error('[dailyRollover] a futás naplózása nem sikerült', error);
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positive(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 1;
}
