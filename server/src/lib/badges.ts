/**
 * Jelvények kiosztása — a Firestore-ral beszélő fele.
 *
 * A kiértékelés a `src/game/badges.ts`-ben van (tiszta függvény, `ctx`-ből
 * számol); ez a fájl állítja elő a `ctx`-et a felhasználó FRISS állapotából,
 * és írja ki az új jelvényeket.
 *
 * EGYETLEN HELYRŐL HÍVÓDIK: aktivitás mentése után (`routes/activities.ts`),
 * a fő tranzakción KÍVÜL. Ez fedi az első lépések, távolság, terület és
 * hódító kategóriákat — ezek mind aktivitáshoz kötött eseményből változnak.
 *
 * ⚠️ SZÁNDÉKOSAN NEM HÍVÓDIK a napi fordulóból (`jobs/dailyRollover.ts`),
 * pedig a heti sorozat- és a hűség-jelvények elméletileg ott is
 * kiértékelődhetnének. Egy próbafuttatás megmutatta, miért rossz ötlet: a
 * `dailyRollover.emulator.test.ts` a jutalom-GP-t PONTOS ÉRTÉKKEL ellenőrzi
 * (`gpTotal`, `gpWeek`), és egy ott is lefutó jelvény-kiosztás csendben
 * hozzáadna egy előre nem várt GP-összeget — a teszt két helyen bukott meg
 * emiatt. A heti/hűség-jelvények emiatt csak a KÖVETKEZŐ aktivitásnál
 * derülnek ki — ez elfogadható késés, nem elveszett jutalom, mert
 * `earnedBadgeIds()` tiszta függvény: a következő hívás úgyis pótolja.
 *
 * Ez a szétválasztás azért biztonságos, mert `earnedBadgeIds()` TISZTA
 * FÜGGVÉNY: ugyanahhoz a `ctx`-hez mindig ugyanazt az eredményt adja,
 * függetlenül attól, ki és mikor hívja. A jelvényírás emiatt kívülről is
 * KOCKÁZAT NÉLKÜL kihagyható (best-effort, sose dob), mert egy elmaradt
 * jelvény semmilyen játékadatot nem érint — a következő kiértékelés úgyis
 * pótolja.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { BADGES_BY_ID, earnedBadgeIds, type BadgeContext, type BadgeDef } from '../../../src/game/badges';
import { COLLECTIONS, db } from './firebase';

interface UserSnapshotForBadges {
  counters?: {
    activities?: number;
    distanceKm?: { run?: number; walk?: number; ride?: number };
  };
  territoryM2?: { foot?: number; bike?: number };
  streak?: { longest?: number; milestonesAwarded?: number[] };
  createdAt?: { toMillis(): number } | Date;
}

function toMillis(value: UserSnapshotForBadges['createdAt']): number {
  if (!value) return Date.now();
  if (value instanceof Date) return value.getTime();
  return typeof value.toMillis === 'function' ? value.toMillis() : Date.now();
}

/**
 * A jelvények NÉV NÉLKÜL mennek a kliensnek — csak `{id, earnedAt}`.
 *
 * A nevet, leírást és ritkasági színt a kliens a `src/game/badges.ts`
 * katalógusból oldja fel, ami a klienssel közös kódban él. Duplikálni a
 * szövegeket a válaszban felesleges forgalom lenne.
 */
export function toEarnedBadges(
  snapshot: FirebaseFirestore.QuerySnapshot,
): { id: string; earnedAt: number }[] {
  return snapshot.docs.map((doc) => {
    const data = doc.data() as { earnedAt?: { toMillis(): number } };
    return { id: doc.id, earnedAt: data.earnedAt?.toMillis() ?? 0 };
  });
}

async function buildContext(uid: string, user: UserSnapshotForBadges): Promise<BadgeContext> {
  /**
   * Aggregáló lekérdezés, nem a teljes lista beolvasása.
   *
   * A `.count()` egyetlen olvasásba kerül, függetlenül attól, hány
   * `territoryEvents` dokumentum tartozik a felhasználóhoz — egy aktív
   * hódítónál ez több száz-ezer dokumentum lenne, ha egyenként olvasnánk be.
   */
  const stealSnapshot = await db
    .collection(COLLECTIONS.territoryEvents)
    .where('actorId', '==', uid)
    .count()
    .get();

  return {
    activitiesCount: Number(user.counters?.activities ?? 0),
    distanceKm: {
      run: Number(user.counters?.distanceKm?.run ?? 0),
      walk: Number(user.counters?.distanceKm?.walk ?? 0),
      ride: Number(user.counters?.distanceKm?.ride ?? 0),
    },
    territoryM2Total: Number(user.territoryM2?.foot ?? 0) + Number(user.territoryM2?.bike ?? 0),
    stealCount: stealSnapshot.data().count,
    streakLongestDays: Number(user.streak?.longest ?? 0),
    weekMilestonesAwarded: Array.isArray(user.streak?.milestonesAwarded)
      ? user.streak!.milestonesAwarded!
      : [],
    accountAgeDays: (Date.now() - toMillis(user.createdAt)) / 86_400_000,
  };
}

/**
 * Kiértékel és kioszt — a friss profilból számolva.
 *
 * SOSE DOB: a hívó helyek fire-and-forget módon indítják, a válaszra nem
 * várnak. Egy hibás jelvénykiosztás nem véve a fő útvonalat magával.
 *
 * @returns az ÚJONNAN kiosztott jelvények — egyelőre csak naplózásra
 *          használjuk, a jövőbeli értesítés-funkció (HANDOFF → 6. pont)
 *          erre épülhet majd rá.
 */
export async function evaluateAndAwardBadges(uid: string): Promise<BadgeDef[]> {
  try {
    const userRef = db.collection(COLLECTIONS.users).doc(uid);
    const [userSnap, existingSnap] = await Promise.all([
      userRef.get(),
      userRef.collection('badges').get(),
    ]);
    if (!userSnap.exists) return [];

    const already = new Set(existingSnap.docs.map((doc) => doc.id));
    const ctx = await buildContext(uid, userSnap.data() as UserSnapshotForBadges);
    const earned = earnedBadgeIds(ctx);
    const fresh = earned.filter((id) => !already.has(id) && BADGES_BY_ID.has(id));
    if (fresh.length === 0) return [];

    const now = FieldValue.serverTimestamp();
    const batch = db.batch();
    let rewardGp = 0;
    const awarded: BadgeDef[] = [];

    for (const id of fresh) {
      const def = BADGES_BY_ID.get(id)!;
      batch.set(userRef.collection('badges').doc(id), { earnedAt: now, tier: def.tier });
      rewardGp += def.rewardGp;
      awarded.push(def);
    }
    if (rewardGp > 0) {
      /**
       * A GP-jutalom `gpTotal`-ra ÉS `gpWeek`/`gpMonth`-ra IS megy, ugyanúgy,
       * mint az aktivitásból származó pont — a heti/havi ranglistának nem
       * számít, HONNAN jött a GP.
       *
       * A `level` itt NEM frissül újraszámolva: a jelvény-jutalom tipikusan
       * kicsi ahhoz, hogy önmagában szintet lépjen, és a legközelebbi
       * aktivitás úgyis frissíti. Egy pontatlan, egy körre elmaradó szint-
       * kijelzés ártalmatlanabb, mint egy plusz olvasás minden jelvényosztásnál.
       */
      batch.set(
        userRef,
        {
          gpTotal: FieldValue.increment(rewardGp),
          gpWeek: FieldValue.increment(rewardGp),
          gpMonth: FieldValue.increment(rewardGp),
        },
        { merge: true },
      );
    }

    await batch.commit();
    return awarded;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[badges] a(z) ${uid} felhasználó jelvény-kiértékelése elhasalt`, error);
    return [];
  }
}
