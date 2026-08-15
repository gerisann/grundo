import { Router } from 'express';
import type { AuthedRequest } from '../../server';

export const activitiesRouter = Router();

/**
 * POST /api/activities
 *
 * Egy befejezett aktivitás feldolgozása. A folyamat:
 *
 *   1. a nyomvonal mentése (teljes → activities/{id}/private/track)
 *   2. levágott nyomvonal a privát zóna szerint  → ez a publikus
 *   3. térkép-előnézeti kép generálása a LEVÁGOTT nyomvonalból
 *   4. Trust Score számítás (server/src/trust/score.ts)
 *   5. ha `trusted`: a játékmotor futtatása (src/game/processActivity)
 *      ha `pending_review`: az aktivitás mentődik, de a rács NEM változik
 *   6. a rács frissítése blokkonként (grid/{layer}_{h3res9}), tranzakcióban
 *   7. GP könyvelése (gpLedger) + a felhasználó aggregátumainak frissítése
 *   8. territoryEvents írása — TÁMADÁSONKÉNT egy esemény, nem cellánként
 *   9. értesítések a károsultaknak
 *
 * FONTOS: a 4. lépés a TELJES nyomvonalat kapja, a levágástól függetlenül.
 * Ha a levágott nyomvonalból számolnánk, a privát zóna csalási felület lenne.
 *
 * Idempotens: ugyanaz az `activityId` kétszer feldolgozva nem duplázza a pontot.
 * Sorbaállítás: Cloud Tasks, H3 res 5 területi kulcs szerint szerializálva —
 * két egyidejű, ugyanoda érkező foglalás így determinisztikus sorrendben fut.
 */
activitiesRouter.post('/', async (req: AuthedRequest, res) => {
  // TODO(F1/F2): implementáció
  res.status(501).json({ message: 'Még nincs implementálva.', uid: req.uid });
});

/** GET /api/activities/:id/track — a teljes nyomvonal, csak a tulajdonosnak. */
activitiesRouter.get('/:id/track', async (_req: AuthedRequest, res) => {
  res.status(501).json({ message: 'Még nincs implementálva.' });
});

/** POST /api/activities/:id/report — bejelentés (technikai vagy tartalmi ág). */
activitiesRouter.post('/:id/report', async (_req: AuthedRequest, res) => {
  res.status(501).json({ message: 'Még nincs implementálva.' });
});
