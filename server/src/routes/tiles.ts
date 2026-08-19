import { Router } from 'express';
import { COLLECTIONS, db } from '../lib/firebase';
import { badRequest, notFound } from '../lib/errors';
import {
  BLOCK_RESOLUTION,
  effectiveDefense,
  expandBlock,
  gameDay,
  loadUserBlockIds,
  type GridBlock,
} from '../lib/grid';
import { cellsToM2 } from '../../../src/game/cells';
import { levelFor } from '../../../src/game/levels';
import { GAMEPLAY } from '../../../src/config/gameplay';
import { cellToChildren, gridDisk, latLngToCell } from 'h3-js';
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

    /**
     * A blokklista RÉTEGENKÉNT EGY dokumentumból jön (`blockIndex/{layer}`).
     *
     * Ha a felhasználónak még nincs index-dokumentuma — mert a mentése a
     * migráció előtti —, a `loadUserBlockIds` magától visszaesik a régi,
     * blokkonkénti alkollekcióra. Így a területe nem tűnik el a térképről,
     * amíg a migráció le nem fut.
     */
    const index = await loadUserBlockIds(uid, layer, MAX_BLOCKS);

    if (index.blockIds.length === 0) {
      return res.json({ layer, cells: [], areaM2: 0, cellCount: 0, blockCount: 0 });
    }

    const refs = index.blockIds.map((id) => db.collection(COLLECTIONS.grid).doc(id));
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
      // Az `expandBlock` mindkét tárolási alakot kezeli — a tömörített
      // (uniform) blokkot is. Enélkül az üresen jelenne meg a térképen.
      for (const [cell, stored] of expandBlock(block, GAMEPLAY.H3_RESOLUTION)) {
        if (stored.o !== uid) continue;
        cells.push({ cell, defense: effectiveDefense(stored, today) });
      }
    }

    res.json({
      layer,
      cells,
      cellCount: cells.length,
      areaM2: cellsToM2(cells.length),
      blockCount: index.blockIds.length,
      // Ha ennyi blokkot olvastunk, valószínűleg van még — a felület jelezze.
      truncated: index.truncated,
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

/** Négy gyűrű = 61 blokk. Ennyi az a legnagyobb szakasz, amit lefedünk. */
const MAX_VIEW_BLOCKS = 61;

/**
 * Egy res 9 cella jellemző átmérője kilométerben.
 *
 * A h3 res 9 átlagos élhossza ~0,174 km, tehát a szemközti oldalak távolsága
 * ~0,30 km. Ebből számoljuk, hány gyűrűnyi cella kell a nézet lefedéséhez.
 */
const BLOCK_SPAN_KM = 0.3;

/**
 * A nézetet LEFEDŐ blokkok.
 *
 * Miért nem `polygonToCells`? Mert az csak azokat a cellákat adja vissza,
 * amelyeknek a KÖZEPE a poligonon belül van. Ebből két hiba következett:
 *
 *   1. A nézet szélein lévő cellák kimaradtak, tehát a hatszögháló nem érte
 *      el a képernyő szélét.
 *   2. Erős ráközelítésnél, amikor a nézet kisebb egy blokknál, egyetlen
 *      közép sem esett bele — nulla cella jött vissza, és semmi nem rajzolódott.
 *
 * A gyűrűs lefedés mindkettőt megoldja: a nézet közepéből indulunk, és annyi
 * gyűrűt veszünk, amennyi biztosan túlér a széleken.
 */
const MAX_RINGS = 4;

function coveringBlocks(view: {
  south: number;
  west: number;
  north: number;
  east: number;
}): { blocks: string[]; partial: boolean } {
  const centerLat = (view.north + view.south) / 2;
  const centerLng = (view.east + view.west) / 2;

  // Fok → kilométer, a szélességi kör összehúzódását figyelembe véve.
  const heightKm = (view.north - view.south) * 111.32;
  const widthKm = (view.east - view.west) * 111.32 * Math.cos((centerLat * Math.PI) / 180);
  const radiusKm = Math.hypot(heightKm, widthKm) / 2;

  // Legalább egy gyűrű: erős ráközelítésnél a nézet kisebb egy blokknál, de
  // a középső cellát és a szomszédjait akkor is meg kell mutatni.
  const needed = Math.max(1, Math.ceil(radiusKm / BLOCK_SPAN_KM));
  const rings = Math.min(MAX_RINGS, needed);

  return {
    blocks: gridDisk(latLngToCell(centerLat, centerLng, BLOCK_RESOLUTION), rings),
    // Ha levágtuk, a háló csak a nézet közepét fedi le — a kliensnek tudnia
    // kell róla, hogy ne higgye tévesen szabadnak a széleket.
    partial: needed > MAX_RINGS,
  };
}

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

    /**
     * Négy gyűrűnél (61 blokk, ~2,4 km) nem megyünk tovább.
     *
     * Nem a lekérdezés miatt: egy res 12 hatszög ekkora nézetben már
     * képpontnyi, a háló pedig olvashatatlan szürkeséggé folyna össze. A
     * középső szakaszt viszont ilyenkor is megmutatjuk — jobb valamit látni,
     * mint üres térképet.
     */
    const { blocks: blockIds, partial } = coveringBlocks({ south, west, north, east });

    const today = gameDay(new Date());
    const refs = blockIds.map((id) => db.collection(COLLECTIONS.grid).doc(`${layer}_${id}`));
    const snapshots = await db.getAll(...refs);

    const cells: { cell: CellId; owner: string; defense: number }[] = [];
    const ownerIds = new Set<string>();

    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue;
      const block = snapshot.data() as GridBlock;
      for (const [cell, stored] of expandBlock(block, GAMEPLAY.H3_RESOLUTION)) {
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
      // A háló csak a nézet közepét fedi le — a széleken NEM tudjuk, mi van.
      partial,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/tiles/owner/:uid?layer=foot — kié ez a mező?
 *
 * A térképen egy mezőre koppintva ezt kérjük le. SZÁNDÉKOSAN külön végpont, és
 * nem a `tiles` válaszába csomagolva: a névnél többet (profilkép, rang, terület,
 * pont) minden csempe-lekérésnél átvinni pazarlás lenne, hiszen a felhasználó
 * egyszerre legfeljebb egy kártyát néz.
 *
 * CSAK NYILVÁNOS ADAT megy ki. A bizalmi pontszám, az e-mail és a nyers
 * összesítők itt sem jelennek meg.
 */
tilesRouter.get('/owner/:uid', async (req, res, next) => {
  try {
    const layer = parseLayer(req.query.layer);
    const uid = String(req.params.uid ?? '');
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) {
      throw badRequest('invalid_uid', 'Hibás felhasználó-azonosító.');
    }

    const snapshot = await db.collection(COLLECTIONS.users).doc(uid).get();
    if (!snapshot.exists) throw notFound('owner_missing', 'Ez a játékos már nincs meg.');

    const data = snapshot.data() as {
      username?: string;
      photoURL?: string | null;
      gpTotal?: number;
      territoryM2?: Partial<Record<'foot' | 'bike', number>>;
      cellCount?: Partial<Record<'foot' | 'bike', number>>;
    };

    /**
     * A szintet a GP-ből SZÁMOLJUK, nem a tárolt `level` mezőből.
     *
     * Az a mező csak gyorsítótár, és bizonyítottan el tud csúszni: a régi
     * mentéseknél 74 833 GP mellett is 1-es szint állt benne. A számított
     * érték mindig helyes, és a lépcső hangolása sem igényel migrációt.
     */
    const gpTotal = Math.round(Number(data.gpTotal ?? 0));
    const level = levelFor(gpTotal);

    res.json({
      owner: {
        uid,
        username: data.username ?? 'ismeretlen',
        photoURL: data.photoURL ?? null,
        level,
        rankName: GAMEPLAY.LEVEL_NAMES[level - 1] ?? GAMEPLAY.LEVEL_NAMES[0],
        gpTotal,
        areaM2: Math.round(Number(data.territoryM2?.[layer] ?? 0)),
        cellCount: Number(data.cellCount?.[layer] ?? 0),
        layer,
      },
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
