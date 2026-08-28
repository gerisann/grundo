/**
 * A TERÜLETFOLTOK TÁROLÁSA ÉS LEKÉRDEZÉSE.
 *
 * A foltok kiszámítása tiszta logika (`src/game/territoryBlobs.ts`); ez a
 * modul csak a Firestore-oldal: mikor íródnak újra, és hogyan kérdezzük le
 * őket egy térképszakaszhoz.
 *
 * ── MIÉRT ELŐSZÁMOLT? ──────────────────────────────────────────────────
 * Mert a folt csak akkor stabil, ha a NÉZETTŐL FÜGGETLENÜL létezik. Ha a
 * térkép menet közben vonná össze a betöltött cellákat, akkor a folt mérete
 * és alakja attól függene, mennyi töltődött be körülötte — a betöltési ablak
 * szélén átnyúló területet levágná, pásztázáskor pedig újra és újra máshogy.
 * Pontosan ez volt a hiba, amit a felhasználó jelzett.
 *
 * ── A SZINTEK (a lekérdezés kulcsa) ────────────────────────────────────
 * Minden folt a MÉRETE szerint kerül egy szintre, és a szint csempemérete
 * ahhoz igazodik, milyen messziről látszik még az a méret (lásd
 * `territoryScale.ts`). Így távoli nézetben elég a durva szintet
 * lekérdezni — a kis foltokat úgysem rajzolnánk ki, tehát be sem töltjük.
 *
 * Ez az, ami miatt az országos nézet is olcsó marad: nem az történik, hogy
 * mindent betöltünk és utána eldobjuk, hanem eleve rá sem kérdezünk.
 */

import { cellToLatLng, gridDisk, latLngToCell } from 'h3-js';
import { COLLECTIONS, db } from './firebase';
import { expandBlock, loadUserBlockIds, type GridBlock } from './grid';
import { blobsFromCells, type BlobRings } from '../../../src/game/territoryBlobs';
import { minVisibleAreaM2, viewWidthKm, type ViewBox } from '../../../src/game/territoryScale';
import { GAMEPLAY } from '../../../src/config/gameplay';
import type { CellId, Layer } from '../../../src/types';

/**
 * Tárolási szintek — a csempe felbontása és a rajta tárolt méretsáv.
 *
 * A `across` a csempe jellemző átmérője kilométerben; ebből számoljuk, hány
 * gyűrű fedi le a nézetet. A `maxAreaM2` a szint FELSŐ határa: a nála
 * nagyobb folt a következő szintre kerül.
 *
 * ⚠️ A számok összefüggnek a láthatósági szabállyal. A 0. szint felső
 * határa 1 km², ami a 2%-os szabály szerint 50 km-es nézetig látszik — a
 * res 5 csempe (~17 km) ekkor is csak 3 gyűrű, tehát kezelhető mennyiség.
 * Ha a láthatósági arány változik, ezeket a határokat is nézd meg újra.
 */
const LEVELS = [
  { level: 0, resolution: 5, acrossKm: 17, maxAreaM2: 1_000_000 },
  { level: 1, resolution: 2, acrossKm: 316, maxAreaM2: Number.POSITIVE_INFINITY },
] as const;

/** Ennél több gyűrűt egy szinten sem kérdezünk le — védőkorlát, nem finomhangolás. */
const MAX_TILE_RINGS = 4;

/**
 * Az `in` szűrő értékeinek darabszáma egy lekérdezésben.
 *
 * A Firestore újabb változatai 30-at is engednek, de a régebbiek csak 10-et.
 * A 10 mindenhol biztonságos, és mivel a csempék száma amúgy is kicsi, a
 * néhány párhuzamos lekérdezés nem számít.
 */
const IN_CHUNK = 10;

/** Legfeljebb ennyi foltot adunk vissza egy nézetre — a térkép védelme. */
const MAX_BLOBS_PER_VIEW = 400;

/**
 * A felhasználó blokkjainak felső korlátja újraszámoláskor.
 *
 * Egy blokk 343 cella, tehát 400 blokk ~137 000 cella — ennél nagyobb
 * területnél a folt alakja már úgysem a részleteken múlik. A korlát a
 * mentési út futásidejét védi: ez a beolvasás minden aktivitás után lefut.
 */
const MAX_BLOCKS_PER_USER = 400;

export interface StoredBlob {
  id: string;
  owner: string;
  areaM2: number;
  cellCount: number;
  rings: BlobRings;
  bbox: { south: number; west: number; north: number; east: number };
}

function levelForArea(areaM2: number) {
  return LEVELS.find((entry) => areaM2 < entry.maxAreaM2) ?? LEVELS[LEVELS.length - 1]!;
}

function docId(layer: Layer, owner: string, blobId: string): string {
  return `${layer}_${owner}_${blobId}`;
}

/**
 * A felhasználó ÖSSZES foltjának újraszámolása és kiírása.
 *
 * TELJES újraszámolás, nem részleges frissítés. Egy új kör két korábban
 * külön foltot össze is olvaszthat, és ketté is vághat egy meglévőt (ha
 * közben elvették a közepét), ezért a „csak a változott részt nézzük" út
 * hibás eredményt adna. A teljes újraszámolás ára egy blokkolvasás-köteg,
 * a haszna, hogy a tárolt kép SOHA nem sodródik el a valóságtól.
 */
export async function recomputeTerritoryBlobs(uid: string, layer: Layer): Promise<number> {
  const index = await loadUserBlockIds(uid, layer, MAX_BLOCKS_PER_USER);

  const cells: CellId[] = [];
  if (index.blockIds.length > 0) {
    const refs = index.blockIds.map((id) => db.collection(COLLECTIONS.grid).doc(id));
    for (const snapshot of await db.getAll(...refs)) {
      if (!snapshot.exists) continue;
      const block = snapshot.data() as GridBlock;
      for (const [cell, stored] of expandBlock(block, GAMEPLAY.H3_RESOLUTION)) {
        if (stored.o === uid) cells.push(cell);
      }
    }
  }

  const blobs = blobsFromCells(cells);
  const now = new Date();

  // A meglévő foltok azonosítói — amit az újraszámolás nem hozott vissza, az
  // megszűnt (elvették, vagy összeolvadt egy másikkal), tehát törlendő.
  const existing = await db
    .collection(COLLECTIONS.territoryBlobs)
    .where('layer', '==', layer)
    .where('owner', '==', uid)
    .get();

  const keep = new Set(blobs.map((blob) => docId(layer, uid, blob.id)));
  const writes: { ref: FirebaseFirestore.DocumentReference; data?: Record<string, unknown> }[] = [];

  for (const snapshot of existing.docs) {
    if (!keep.has(snapshot.id)) writes.push({ ref: snapshot.ref });
  }

  for (const blob of blobs) {
    const centre = { lat: (blob.bbox.south + blob.bbox.north) / 2, lng: (blob.bbox.west + blob.bbox.east) / 2 };
    const { level, resolution } = levelForArea(blob.areaM2);
    writes.push({
      ref: db.collection(COLLECTIONS.territoryBlobs).doc(docId(layer, uid, blob.id)),
      data: {
        layer,
        owner: uid,
        level,
        tile: latLngToCell(centre.lat, centre.lng, resolution),
        areaM2: blob.areaM2,
        cellCount: blob.cellCount,
        south: blob.bbox.south,
        west: blob.bbox.west,
        north: blob.bbox.north,
        east: blob.bbox.east,
        /**
         * ⚠️ JSON SZÖVEGKÉNT, nem tömbként. A Firestore NEM enged tömböt
         * tömbben, a körvonal viszont eleve [gyűrű][pont][lng,lat] alakú.
         * A mező úgysem szűrhető, tehát semmit nem veszítünk vele.
         */
        rings: JSON.stringify(blob.rings),
        updatedAt: now,
      },
    });
  }

  // A Firestore köteg 500 műveletig bír; a felhasználónak ennél több foltja
  // gyakorlatilag nem lehet, de a darabolás olcsó biztosíték.
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const write of writes.slice(i, i + 400)) {
      if (write.data) batch.set(write.ref, write.data, { merge: false });
      else batch.delete(write.ref);
    }
    await batch.commit();
  }

  return blobs.length;
}

/** Több felhasználó egyszerre — a támadó és az áldozatai egy mentés után. */
export async function recomputeTerritoryBlobsFor(uids: Iterable<string>, layer: Layer): Promise<void> {
  const unique = [...new Set([...uids].filter(Boolean))];
  // Sorosan: a mentési úton fut, és nem akarunk egyszerre több száz
  // blokkolvasást indítani egyetlen kérés miatt.
  for (const uid of unique) {
    await recomputeTerritoryBlobs(uid, layer);
  }
}

/** A nézetet lefedő csempék egy adott szinten. */
function tilesForView(resolution: number, acrossKm: number, view: ViewBox): string[] {
  const centerLat = (view.north + view.south) / 2;
  const centerLng = (view.east + view.west) / 2;
  const heightKm = (view.north - view.south) * 111.32;
  const widthKm = viewWidthKm(view);
  const radiusKm = Math.hypot(heightKm, widthKm) / 2;

  const rings = Math.min(MAX_TILE_RINGS, Math.max(1, Math.ceil(radiusKm / acrossKm) + 1));
  return gridDisk(latLngToCell(centerLat, centerLng, resolution), rings);
}

function intersects(blob: { south: number; west: number; north: number; east: number }, view: ViewBox): boolean {
  return !(blob.north < view.south || blob.south > view.north || blob.east < view.west || blob.west > view.east);
}

/**
 * A nézetben LÁTHATÓ foltok.
 *
 * A méretküszöböt a szerver alkalmazza, nem a kliens: így a válasz mérete
 * nem függ a nagyítástól, és a két oldal biztosan ugyanazt a szabályt
 * követi (`territoryScale.ts`).
 */
export async function loadBlobsForView(
  layer: Layer,
  view: ViewBox,
): Promise<{ blobs: StoredBlob[]; minAreaM2: number; truncated: boolean }> {
  const minAreaM2 = minVisibleAreaM2(viewWidthKm(view));

  const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [];
  for (const { level, resolution, acrossKm, maxAreaM2 } of LEVELS) {
    // A szint minden foltja a küszöb alatt van — rá sem kérdezünk.
    if (maxAreaM2 <= minAreaM2) continue;

    const tiles = tilesForView(resolution, acrossKm, view);
    for (let i = 0; i < tiles.length; i += IN_CHUNK) {
      queries.push(
        db
          .collection(COLLECTIONS.territoryBlobs)
          .where('layer', '==', layer)
          .where('level', '==', level)
          .where('tile', 'in', tiles.slice(i, i + IN_CHUNK))
          .where('areaM2', '>=', minAreaM2)
          .orderBy('areaM2', 'desc')
          .limit(MAX_BLOBS_PER_VIEW)
          .get(),
      );
    }
  }

  const snapshots = await Promise.all(queries);
  const seen = new Set<string>();
  const blobs: StoredBlob[] = [];

  for (const snapshot of snapshots) {
    for (const doc of snapshot.docs) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);

      const data = doc.data() as {
        owner: string;
        areaM2: number;
        cellCount: number;
        rings: string;
        south: number;
        west: number;
        north: number;
        east: number;
      };

      const bbox = { south: data.south, west: data.west, north: data.north, east: data.east };
      // A csempe durvább a nézetnél (a legfelső szinten több száz km), ezért
      // a valódi metszést itt döntjük el.
      if (!intersects(bbox, view)) continue;

      let rings: BlobRings;
      try {
        rings = JSON.parse(data.rings) as BlobRings;
      } catch {
        continue;
      }

      blobs.push({
        id: doc.id,
        owner: data.owner,
        areaM2: data.areaM2,
        cellCount: data.cellCount,
        rings,
        bbox,
      });
    }
  }

  blobs.sort((a, b) => b.areaM2 - a.areaM2);
  return {
    blobs: blobs.slice(0, MAX_BLOBS_PER_VIEW),
    minAreaM2,
    truncated: blobs.length > MAX_BLOBS_PER_VIEW,
  };
}

/** A folt közepe — a térkép ráugrásához és a teszteléshez. */
export function blobCentre(blob: StoredBlob): { lat: number; lng: number } {
  return {
    lat: (blob.bbox.south + blob.bbox.north) / 2,
    lng: (blob.bbox.west + blob.bbox.east) / 2,
  };
}

/** Csak a teszteléshez: a szintdefiníciók kiolvasása. */
export const TERRITORY_BLOB_LEVELS = LEVELS;

/** Egy cella közepe — a visszatöltés ellenőrzéséhez. */
export function cellCentre(cell: CellId): { lat: number; lng: number } {
  const [lat, lng] = cellToLatLng(cell);
  return { lat, lng };
}
