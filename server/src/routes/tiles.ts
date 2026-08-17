import { Router } from 'express';
import { COLLECTIONS, db } from '../lib/firebase';
import { badRequest } from '../lib/errors';
import { cellKey, effectiveDefense, gameDay, type GridBlock } from '../lib/grid';
import { cellsToM2 } from '../../../src/game/cells';
import { cellToChildren } from 'h3-js';
import type { CellId, Layer } from '../../../src/types';

export const tilesRouter = Router();

/**
 * Legfeljebb ennyi blokkot olvasunk egy kérésben.
 *
 * Egy blokk 343 cella, tehát 200 blokk már ~68 600 cella — ennyi hatszöget
 * amúgy sem lehet értelmesen kirajzolni egy telefonra. A korlát nem a
 * felhasználó ellen véd, hanem a szolgáltatás ellen: enélkül egy sokat játszó
 * felhasználó profilja több ezer dokumentumot olvasna minden megnyitáskor.
 */
const MAX_BLOCKS = 200;

/**
 * GET /api/tiles/mine?layer=foot — a saját területem.
 *
 * A válasz cellánként adja meg a védelmi szintet, mert a térképen ez a
 * színezés alapja: az 5-ös védelmű folt máshogy néz ki, mint a frissen
 * szerzett. Az ÉRVÉNYES szintet adjuk vissza — a tegnapi 5-ös ma 1 —, hogy a
 * felhasználó azt lássa, ami a támadónak is számít.
 */
tilesRouter.get('/mine', async (req, res, next) => {
  try {
    const uid = (req as { uid?: string }).uid!;
    const layer = parseLayer(req.query.layer);
    const today = gameDay(new Date());

    const index = await db
      .collection(COLLECTIONS.users)
      .doc(uid)
      .collection('blocks')
      .where('layer', '==', layer)
      .limit(MAX_BLOCKS)
      .get();

    if (index.empty) {
      return res.json({ layer, cells: [], areaM2: 0, cellCount: 0, blockCount: 0 });
    }

    const refs = index.docs.map((doc) => db.collection(COLLECTIONS.grid).doc(doc.id));
    const blocks = await db.getAll(...refs);

    const cells: { cell: CellId; defense: number }[] = [];

    for (const snapshot of blocks) {
      if (!snapshot.exists) continue;
      const block = snapshot.data() as GridBlock;

      /**
       * A tárolt kulcs a cella indexének utolsó 6 karaktere — a teljes index
       * nincs eltárolva. Visszafejteni a szülő gyerekeiből lehet: a res 9
       * blokk 343 db res 12 gyereke közül az, amelyiknek a vége egyezik.
       */
      const children = cellToChildren(block.parent, 12);
      const byKey = new Map<string, CellId>();
      for (const child of children) byKey.set(cellKey(child), child);

      for (const [key, stored] of Object.entries(block.cells ?? {})) {
        if (stored.o !== uid) continue;
        const cell = byKey.get(key);
        if (cell) cells.push({ cell, defense: effectiveDefense(stored, today) });
      }
    }

    res.json({
      layer,
      cells,
      cellCount: cells.length,
      areaM2: cellsToM2(cells.length),
      blockCount: index.size,
      // Ha ennyi blokkot olvastunk, valószínűleg van még — a felület jelezze.
      truncated: index.size >= MAX_BLOCKS,
    });
  } catch (error) {
    next(error);
  }
});

function parseLayer(raw: unknown): Layer {
  const value = String(raw ?? 'foot');
  if (value !== 'foot' && value !== 'bike') {
    throw badRequest('invalid_layer', 'Ismeretlen réteg.');
  }
  return value;
}
