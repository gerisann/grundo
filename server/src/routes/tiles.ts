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
import { loadBlobsForView } from '../lib/territoryBlobStore';
import { isCellColor } from '../../../src/lib/cellColors';
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
 * A nézetet LEFEDŐ blokkok sugara gyűrűkben.
 *
 * Négy gyűrűnél (61 blokk, ~2,4 km) nem megyünk tovább. Nem a lekérdezés
 * miatt: egy res 12 hatszög ekkora nézetben már képpontnyi, a háló pedig
 * olvashatatlan szürkeséggé folyna össze.
 *
 * ⚠️ EZ A KÖZELI RÉTEG, ÉS SZÁNDÉKOSAN MARAD SZŰK. Kizoomolva NEM ez tartja
 * életben a térképet, hanem az előszámolt területfoltok (`/blobs`) — azok
 * nézettől függetlenül léteznek, ezért nem vágódnak el és nem ugrálnak.
 * Korábban itt próbáltunk durva, blokkonkénti hatszögeket visszaadni; az
 * pontatlan volt és pásztázáskor villódzott, ezért került ki.
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
      ...(await ownerProfiles(ownerIds).then(({ names, colors }) => ({
        owners: names,
        ownerColors: colors,
      }))),
      // A háló csak a nézet közepét fedi le — a széleken NEM tudjuk, mi van.
      partial,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/tiles/blobs?layer=foot&south=&west=&north=&east=
 *
 * AZ ÖSSZEFÜGGŐ TERÜLETFOLTOK — a térkép fő területrétege minden nagításon.
 *
 * MIÉRT KÜLÖN VÉGPONT A `/`-tól? Mert más a természetük. A `/` a nézet
 * közepének CELLÁIT adja vissza a hatszögrácshoz és a védelmi szintekhez,
 * és ezért szűk sugarú. Ez viszont NÉZETTŐL FÜGGETLEN, előszámolt egységeket
 * ad: a folt akkor is teljes, ha kilóg a képernyőről, és ugyanaz a folt
 * ugyanakkora marad, akárhonnan nézzük. Ettől nem ugrálnak és nem
 * csonkulnak a területek pásztázás közben.
 *
 * A méretszűrés a szerveren történik (`territoryScale.ts`): kizoomolva a
 * kis foltokat be sem töltjük, ezért a válasz mérete nem nő a nagyítással.
 */
tilesRouter.get('/blobs', async (req, res, next) => {
  try {
    const layer = parseLayer(req.query.layer);
    const south = Number(req.query.south);
    const west = Number(req.query.west);
    const north = Number(req.query.north);
    const east = Number(req.query.east);

    if (![south, west, north, east].every(Number.isFinite) || north <= south || east <= west) {
      throw badRequest('invalid_bbox', 'Hibás térképszakasz.');
    }

    const { blobs, minAreaM2, truncated } = await loadBlobsForView(layer, { south, west, north, east });

    const ownerIds = new Set(blobs.map((blob) => blob.owner));
    const { names, colors } = await ownerProfiles(ownerIds);

    res.json({
      layer,
      blobs: blobs.map((blob) => ({
        id: blob.id,
        owner: blob.owner,
        areaM2: blob.areaM2,
        cellCount: blob.cellCount,
        rings: blob.rings,
      })),
      owners: names,
      ownerColors: colors,
      // A kliens jelezni tudja, ha a nagyítás miatt szűrtünk.
      minAreaM2,
      truncated,
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

/** A ranglista nézetei — melyik mező szerint rendezünk. */
type LeaderboardWindow = 'day' | 'week' | 'month' | 'alltime';

const WINDOW_FIELD: Record<LeaderboardWindow, string> = {
  day: 'areaDay',
  week: 'areaWeek',
  month: 'areaMonth',
  alltime: 'territoryM2',
};

function parseWindow(raw: unknown): LeaderboardWindow {
  const value = String(raw ?? 'alltime');
  if (value !== 'day' && value !== 'week' && value !== 'month' && value !== 'alltime') {
    throw badRequest('invalid_window', 'Ismeretlen ranglista-nézet.');
  }
  return value;
}

/**
 * GET /api/tiles/leaderboard?layer=foot&window=alltime — legnagyobb területek.
 *
 * NÉGY NÉZET (`window`): `alltime` a jelenlegi állományt mutatja
 * (`territoryM2`), `day`/`week`/`month` pedig az ADOTT IDŐSZAKBAN SZERZETT
 * bruttó területet (`areaDay`/`areaWeek`/`areaMonth`) — ez a `gpWeek`/
 * `gpMonth` mintája, NEM a nettó változás: ha valakitől időközben elvették a
 * frissen szerzett cellákat, a heti számából az még nem vész ki. Geri
 * döntése (2026-08-22): a bruttó egyszerűbb és elég erre a célra.
 *
 * MINDENKI RAJTA VAN, a nulla értékűek is — Geri kifejezetten ezt kérte: a
 * lista attól ranglista, hogy mindenki helyét mutatja, nem csak azokét, akik
 * épp vezetnek/szereztek. Egy korábbi próbálkozás (`hasOwnedArea` jelző,
 * csak az ÚJ szerzéseknél írva) ÜRES listát adott éles adaton, mert a régi
 * felhasználóknál nincs visszamenőleg kitöltve — ezért kikerült.
 *
 * A MÁSODLAGOS RENDEZÉS ábécésorrend (`usernameLower`): egyenlő érték esetén
 * (a leggyakoribb ilyen eset épp a nulla) ne a Firestore tetszőleges
 * dokumentum-sorrendje döntsön, hanem valami, ami a felhasználó számára is
 * értelmezhető. Ehhez összetett index kell (lásd `firestore.indexes.json`),
 * mert két mező szerint rendezünk — nézetenként és rétegenként külön, mert a
 * Firestore indexe konkrét mezőútvonalra szól, nem paraméterezhető.
 */
tilesRouter.get('/leaderboard', async (req, res, next) => {
  try {
    const layer = parseLayer(req.query.layer);
    const window = parseWindow(req.query.window);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const field = WINDOW_FIELD[window];

    const snapshot = await db
      .collection(COLLECTIONS.users)
      .orderBy(`${field}.${layer}`, 'desc')
      .orderBy('usernameLower', 'asc')
      .limit(limit)
      .get();

    res.json({
      layer,
      window,
      entries: snapshot.docs.map((doc) => {
        const data = doc.data() as {
          username?: string;
          photoURL?: string | null;
          cellCount?: Record<string, number>;
        } & Record<string, Record<string, number> | undefined>;
        return {
          uid: doc.id,
          username: data.username ?? 'ismeretlen',
          photoURL: data.photoURL ?? null,
          areaM2: data[field]?.[layer] ?? 0,
          cellCount: data.cellCount?.[layer] ?? 0,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * A tulajdonosok neve ÉS választott cellaszíne — a térképen látni kell, kié a
 * folt, és milyen színben.
 *
 * A kettő EGY olvasásból jön: a színért külön körbefordulni pazarlás lenne,
 * hiszen ugyanazt a felhasználó-dokumentumot kell megnyitni hozzá.
 *
 * ⚠️ A színek KÜLÖN mezőként mennek ki, nem az `owners` átalakításával. A
 * backend külön települ, tehát a válaszának visszafelé kompatibilisnek kell
 * lennie a már kint lévő webes és iOS kliensekkel — azok az `owners`-t
 * `Record<string, string>` alakban várják.
 */
async function ownerProfiles(
  ids: Set<string>,
): Promise<{ names: Record<string, string>; colors: Record<string, string> }> {
  const list = [...ids].slice(0, 50);
  if (list.length === 0) return { names: {}, colors: {} };
  const refs = list.map((id) => db.collection(COLLECTIONS.users).doc(id));
  const names: Record<string, string> = {};
  const colors: Record<string, string> = {};
  for (const snapshot of await db.getAll(...refs)) {
    if (!snapshot.exists) continue;
    const data = snapshot.data() as { username?: string; cellColor?: unknown };
    names[snapshot.id] = data.username ?? 'ismeretlen';
    // Érvénytelen vagy hiányzó érték esetén nem küldünk semmit: a kliens
    // ilyenkor az alapértelmezett színt használja.
    if (isCellColor(data.cellColor)) colors[snapshot.id] = data.cellColor;
  }
  return { names, colors };
}
