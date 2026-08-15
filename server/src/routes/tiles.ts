import { Router } from 'express';

export const tilesRouter = Router();

/**
 * GET /api/tiles/:layer/:z/:x/:y.mvt
 *
 * A hexrács Mapbox vektorcsempeként. A rácsot SOHA nem szolgáljuk ki nyers
 * Firestore-olvasásból: egy városnyi nézet több száz blokkot jelentene.
 *
 * Zoom szerinti aggregáció (docs/05-adatmodell.md → Térkép-megjelenítés):
 *   z ≥ 15   egyedi res 12 hexagonok, tulajdonos színe + védelmi jelölés
 *   z 12–14  res 9/10 aggregáció, domináns tulajdonos
 *   z ≤ 11   zóna-kontúrok és hőtérkép
 *
 * A válasz Cloud CDN-ben cache-elődik, és a `grid` blokk `version` mezőjének
 * változásakor invalidálódik.
 */
tilesRouter.get('/:layer/:z/:x/:y.mvt', async (_req, res) => {
  res.status(501).json({ message: 'Még nincs implementálva.' });
});
