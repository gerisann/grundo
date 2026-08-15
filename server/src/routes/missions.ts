import { Router } from 'express';

export const missionsRouter = Router();

/**
 * POST /api/missions/generate
 *
 * A küldetés-ajánló. NEM útvonaltervező: a bemenet IDŐ, nem távolság, a
 * kimenet pedig játékbeli tét.
 *
 *   { minutes: 45, type: 'run', filters: { minCrossings, greenSpaces, flat } }
 *   → 3–4 küldetés: Hódítás · Rajtaütés · Erősítés · Felfedezés
 *
 * Algoritmus (docs/02-funkcionalis-spec.md → Küldetés-ajánló):
 *   1. kör-jelöltek a pozíció körül (út-gráf, célhossz ±15 %, 8 irányban);
 *      a célhossz a felhasználó SAJÁT átlagtempójából jön
 *   2. minden jelöltre a bezáruló cellahalmaz — ugyanaz a flood fill,
 *      mint élesben (src/game/loops.ts)
 *   3. értékelés a JELENLEGI birtokviszonyok ellen:
 *      szabad / lopható / áttörendő / erősíthető cellák
 *   4. becsült GP a src/game/scoring.ts képletével
 *   5. típusonként a legjobb — 3 ÉRDEMBEN különböző ajánlat
 *
 * ADATVÉDELMI KORLÁT: a célszemély csak akkor nevezhető meg, ha a fiókja
 * publikus; privát fióknál "egy helyi játékostól". Ugyanaz a személy naponta
 * legfeljebb egyszer jelenhet meg célpontként — a küldetés nem lehet célzott
 * zaklatási eszköz.
 *
 * Kvóta: ingyenes heti 5, Pro korlátlan.
 */
missionsRouter.post('/generate', async (_req, res) => {
  res.status(501).json({ message: 'Még nincs implementálva.' });
});
