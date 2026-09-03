/**
 * Banda-összesítés — előszámított rollup, a `dailyRollover.ts` mintájára.
 *
 * MIÉRT JOB, NEM ÉLŐ OLVASÁSKORI SZUMMA? Geri döntése (GRUNDO #29): a
 * `BandaScreen` megnyitása ne fizessen egy N-tagos `getAll`-t minden
 * alkalommal — a job helyette rendszeresen (Cloud Scheduler, óránként, mint
 * a napi forduló) újraszámolja és beírja a `bandas/{id}.totals`-t, a
 * kliens pedig ezt olvassa, egyetlen dokumentumot.
 *
 * NINCS `nextDueAt`-alapú szűrés, ellentétben a `dailyRollover`-rel: ott a
 * felhasználók helyi éjfele szórtan esik az órákra, itt viszont nincs
 * "esedékesség" fogalom — minden banda mindig újraszámolható, és Phase
 * 1-ben nincs annyi banda, hogy ez számítson. Ha ez változik, a szűrés
 * ugyanúgy bevezethető, mint a felhasználóknál.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS, db } from '../lib/firebase';
import { sumBandaTotals, type BandaMemberAggregate } from '../lib/bandas';

export interface BandaRolloverSummary {
  bandasProcessed: number;
  errors: number;
}

/** Egy futásban legfeljebb ennyi bandát dolgozunk fel. */
const DEFAULT_BATCH = 500;
/** Egy bandán belül legfeljebb ennyi tagot olvasunk be az összesítéshez. */
const MAX_MEMBERS_PER_BANDA = 500;

export async function runBandaRollover(
  now: Date,
  options: { limit?: number } = {},
): Promise<BandaRolloverSummary> {
  const limit = options.limit ?? DEFAULT_BATCH;
  const summary: BandaRolloverSummary = { bandasProcessed: 0, errors: 0 };

  const bandas = await db.collection(COLLECTIONS.bandas).limit(limit).get();

  for (const bandaDoc of bandas.docs) {
    try {
      await rolloverBanda(bandaDoc.id, now);
      summary.bandasProcessed += 1;
    } catch (error) {
      // Egy hibás banda nem állíthatja meg a többit — lásd `dailyRollover.ts`.
      summary.errors += 1;
      console.error(`[bandaRollover] a(z) ${bandaDoc.id} banda összesítése elhasalt`, error);
    }
  }

  return summary;
}

async function rolloverBanda(bandaId: string, now: Date): Promise<void> {
  const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);
  const membersSnapshot = await bandaRef.collection('members').limit(MAX_MEMBERS_PER_BANDA).select().get();
  const memberIds = membersSnapshot.docs.map((doc) => doc.id);

  const userDocs = memberIds.length
    ? await db.getAll(...memberIds.map((id) => db.collection(COLLECTIONS.users).doc(id)))
    : [];

  const aggregates: BandaMemberAggregate[] = userDocs
    .filter((doc) => doc.exists)
    .map((doc) => doc.data() as BandaMemberAggregate);

  const totals = sumBandaTotals(aggregates);
  await bandaRef.set(
    { totals: { ...totals, updatedAt: Timestamp.fromDate(now) } },
    { merge: true },
  );
}
