import { Router } from 'express';
import { COLLECTIONS, db } from '../lib/firebase';
import { badRequest } from '../lib/errors';
import { BLOCK_RESOLUTION, cellKey, effectiveDefense, gameDay, type GridBlock } from '../lib/grid';
import { cellsToM2 } from '../../../src/game/cells';
import { cellToChildren, polygonToCells } from 'h3-js';
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

/**
 * Legfeljebb ennyi blokkot olvasunk egy térképnézethez.
 *
 * Egy res 9 blokk ~105 000 m². Negyven blokk ~4 km² — nagyjából egy belvárosi
 * nézet. Efölött nem olvasunk többet, hanem szólunk a felületnek, hogy
 * közelítsen rá: távolról úgysem lehet értelmesen megjeleníteni hatszázezer
 * hatszöget.
 */
const MAX_VIEW_BLOCKS = 40;

/**
 * GET /api/tiles?layer=foot&south=&west=&north=&east=
 *
 * A látott térképszakasz birtokviszonya — MINDENKIÉ, nem csak a sajátom.
 *
 * Miért működik ez index nélkül? Mert a rács dokumentumainak azonosítója maga
 * a földrajzi kulcs (`{réteg}_{res9index}`). A nézethez tartozó res 9 cellákat
 * ki tudjuk számolni, és a dokumentumokat AZONOSÍTÓ SZERINT kérjük le — ehhez
 * nem kell lekérdezés, tehát index sem. Ez a hexagonrács egyik nyeresége: a
 * térbeli keresés címzéssé egyszerűsödik.
 */
tilesRouter.get('/', async (req, res, next) => {
  try {
    const layer = parseLayer(req.query.layer);
    const south = Number(req.query.south);
    const west = Number(req.query.west);
    const north = Number(req.query.north);
    const east = Number(req.query.east);

    if (![south, west, north, east].every(Number.isFinite) || north <= south || east <= west) {
      throw badRequest('invalid_bbox', 'Hibás térképszakasz.');
    }

    // A h3 [szélesség, hosszúság] párokat vár, és zárt gyűrűt.
    const ring: [number, number][] = [
      [south, west],
      [south, east],
      [north, east],
      [north, west],
      [south, west],
    ];
    const blockIds = polygonToCells(ring, BLOCK_RESOLUTION);

    if (blockIds.length > MAX_VIEW_BLOCKS) {
      return res.json({ layer, cells: [], owners: {}, tooWide: true });
    }
    if (blockIds.length === 0) {
      return res.json({ layer, cells: [], owners: {}, tooWide: false });
    }

    const today = gameDay(new Date());
    const refs = blockIds.map((id) => db.collection(COLLECTIONS.grid).doc(`${layer}_${id}`));
    const snapshots = await db.getAll(...refs);

    const cells: { cell: CellId; owner: string; defense: number }[] = [];
    const ownerIds = new Set<string>();

    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue;
      const block = snapshot.data() as GridBlock;
      const byKey = new Map<string, CellId>();
      for (const child of cellToChildren(block.parent, 12)) byKey.set(cellKey(child), child);

      for (const [key, stored] of Object.entries(block.cells ?? {})) {
        const cell = byKey.get(key);
        if (!cell) continue;
        cells.push({ cell, owner: stored.o, defense: effectiveDefense(stored, today) });
        ownerIds.add(stored.o);
      }
    }

    res.json({
      layer,
      // A blokkokat is visszaadjuk: ezekből tudja a kliens kiszámolni, mely
      // cellák SZABADOK — a szabad cella nem tárolódik sehol, az a hiánya.
      blocks: blockIds,
      cells,
      owners: await ownerNames(ownerIds),
      tooWide: false,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/tiles/leaderboard?layer=foot — a legnagyobb területek.
 *
 * Egyetlen mező szerinti rendezés, ezért NEM kell összetett index: a Firestore
 * minden mezőt magától indexel, a beágyazottakat is.
 */
tilesRouter.get('/leaderboard', async (req, res, next) => {
  try {
    const layer = parseLayer(req.query.layer);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

    const snapshot = await db
      .collection(COLLECTIONS.users)
      .orderBy(`territoryM2.${layer}`, 'desc')
      .limit(limit)
      .get();

    res.json({
      layer,
      entries: snapshot.docs
        .map((doc) => {
          const data = doc.data() as {
            username?: string;
            photoURL?: string | null;
            territoryM2?: Record<string, number>;
            cellCount?: Record<string, number>;
          };
          return {
            uid: doc.id,
            username: data.username ?? 'ismeretlen',
            photoURL: data.photoURL ?? null,
            areaM2: data.territoryM2?.[layer] ?? 0,
            cellCount: data.cellCount?.[layer] ?? 0,
          };
        })
        // A nulla területűeket nem soroljuk fel: az nem ranglista, hanem
        // névsor. Szűrni a lekérdezésben is lehetne, de az már összetett
        // indexet igényelne.
        .filter((entry) => entry.areaM2 > 0),
    });
  } catch (error) {
    next(error);
  }
});

/** A tulajdonosok neve — a térképen látni kell, kié a folt. */
async function ownerNames(ids: Set<string>): Promise<Record<string, string>> {
  const list = [...ids].slice(0, 50);
  if (list.length === 0) return {};
  const refs = list.map((id) => db.collection(COLLECTIONS.users).doc(id));
  const names: Record<string, string> = {};
  for (const snapshot of await db.getAll(...refs)) {
    if (!snapshot.exists) continue;
    names[snapshot.id] = (snapshot.data() as { username?: string }).username ?? 'ismeretlen';
  }
  return names;
}
