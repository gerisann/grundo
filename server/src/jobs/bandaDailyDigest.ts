/**
 * Napi banda-összesítő értesítés.
 *
 * MIT KÜLD: bandánként egy üzenetet a tagoknak arról, mennyi területet és GP-t
 * gyűjtött a banda AZNAP. A számok forrása a `bandas/{id}.totals` napi mezője,
 * amit a `bandaRollover` job tölt — ez a job csak olvas és értesít.
 *
 * ⚠️ A NAPI FORDULÓ ELŐTT KELL FUTNIA. A `dailyRollover` a naphatáron nullázza
 * a napi mezőket; ha ez a job utána futna, minden bandáról nullát jelentene.
 * Ezért az ütemezése a helyi éjfél ELÉ esik (lásd
 * `docs/06-architektura-es-admin.md`).
 *
 * NEM KÜLD ÜRES ÖSSZESÍTŐT: ha a bandának aznap nem gyűlt sem területe, sem
 * GP-je, az értesítés kimarad. „Ma nem történt semmi" nem hír, viszont
 * naponta egyszer megbízhatóan idegesítő.
 */

import { COLLECTIONS, db } from '../lib/firebase';
import { notifyBandaDaily } from '../lib/notifications';

export interface BandaDailyDigestSummary {
  bandasProcessed: number;
  notificationsSent: number;
  errors: number;
}

const DEFAULT_BATCH = 500;
const MAX_MEMBERS_PER_BANDA = 500;

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function runBandaDailyDigest(
  options: { limit?: number } = {},
): Promise<BandaDailyDigestSummary> {
  const summary: BandaDailyDigestSummary = {
    bandasProcessed: 0,
    notificationsSent: 0,
    errors: 0,
  };

  const bandas = await db.collection(COLLECTIONS.bandas).limit(options.limit ?? DEFAULT_BATCH).get();

  for (const bandaDoc of bandas.docs) {
    try {
      summary.bandasProcessed += 1;
      const data = bandaDoc.data() as Record<string, any>;
      const totals = (data.totals ?? {}) as Record<string, any>;
      const areaDay = (totals.areaDayM2 ?? {}) as Record<string, unknown>;
      const areaM2 = num(areaDay.foot) + num(areaDay.bike);
      /**
       * Napi GP-t a `totals` nem tart külön (a rollup hetit és havit számol),
       * ezért a tagok `bandaStats.*.gpDay` mezőiből adjuk össze — ugyanabból,
       * amit a banda-ranglista „Mai" nézete is mutat.
       */
      const memberSnap = await bandaDoc.ref
        .collection('members')
        .select('notify')
        .limit(MAX_MEMBERS_PER_BANDA)
        .get();
      if (memberSnap.empty) continue;

      const memberIds = memberSnap.docs.map((doc) => doc.id);
      const userDocs = await db.getAll(
        ...memberIds.map((id) => db.collection(COLLECTIONS.users).doc(id)),
      );
      let gp = 0;
      for (const userDoc of userDocs) {
        const stats = (userDoc.data()?.bandaStats ?? {}) as Record<string, Record<string, unknown>>;
        for (const sport of ['run', 'walk', 'ride']) {
          gp += num(stats[sport]?.gpDay);
        }
      }

      if (areaM2 <= 0 && gp <= 0) continue;

      const recipients = memberSnap.docs
        .filter((doc) => (doc.data() as { notify?: boolean }).notify !== false)
        .map((doc) => doc.id);
      if (recipients.length === 0) continue;

      notifyBandaDaily(
        recipients,
        bandaDoc.id,
        String(data.name ?? 'Banda'),
        areaM2,
        Math.round(gp),
      );
      summary.notificationsSent += recipients.length;
    } catch (error) {
      // Egy hibás banda nem állíthatja meg a többit — lásd `bandaRollover.ts`.
      summary.errors += 1;
      console.error(`[bandaDailyDigest] a(z) ${bandaDoc.id} banda összesítője elhasalt`, error);
    }
  }

  return summary;
}
