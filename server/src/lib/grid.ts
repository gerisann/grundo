/**
 * A cellatulajdonlás tárolása — a rendszer szíve.
 *
 * A birtoklás cellánként ÉL, de nem cellánként TÁROLÓDIK. Egy dokumentum
 * cellánként kezelhetetlen írásszámot adna: egy 1 km²-es foglalás ~3 257
 * dokumentumot írna. Blokkokban tárolva ugyanez 10–15 dokumentum.
 *
 * Egy blokk = egy H3 res 9 szülőcella, benne a 343 db res 12 gyerekcella
 * tulajdonviszonya. A dokumentum azonosítója `{réteg}_{res9index}`, mert a két
 * réteg (gyalogos és bringás) külön játék: ugyanazt a cellát két különböző
 * ember birtokolhatja a két rétegben.
 *
 * Miért res 9, és nem res 8? A res 8 blokk négyszer nagyobb, tehát négyszer
 * olcsóbb — de egy sűrűn játszott városrészben a nagy blokkok folyamatos
 * tranzakció-ütközést okoznának. A res 9 a kompromisszum: 240× írásmegtakarítás
 * úgy, hogy az ütközés ritka marad.
 *
 * Részletes indoklás: docs/05-adatmodell.md → `grid/{h3res9}`
 */

import { FieldValue } from 'firebase-admin/firestore';
import { cellToChildren } from 'h3-js';
import { GAMEPLAY } from '../../../src/config/gameplay';
import type { CellId, CellOwnership, Layer, OwnershipMap } from '../../../src/types';
import { db, COLLECTIONS } from './firebase';
import {
  blockCellCount,
  blocksFor,
  cellFromBlock,
  cellKey,
  effectiveDefense,
  gameDay,
  uniformStateOf,
  type GridBlock,
  type StoredCell,
} from './gridMath';

// A tiszta logika a `gridMath`-ban él (tesztelhetőség miatt); innen is
// elérhető, hogy a hívóknak ne kelljen két helyről importálniuk.
export {
  BLOCK_RESOLUTION,
  blockIdFor,
  blocksFor,
  cellFromBlock,
  cellKey,
  effectiveDefense,
  expandBlock,
  gameDay,
  localDay,
  localHour,
  monthOf,
  nextLocalMidnight,
  weekOf,
} from './gridMath';

/**
 * A blokk-mutató alkollekciója.
 *
 * SZÁNDÉKOSAN NEM `blocks`: azt a nevet a felhasználó-tiltás foglalja
 * (`users/{uid}/blocks/{tiltottUid}`), és a kettő egy névtérben ütközne.
 */
export const BLOCK_INDEX_COLLECTION = 'blockIndex';
export type { GridBlock } from './gridMath';

/**
 * A cellák JELENLEGI tulajdonosa.
 *
 * A hiányzó cella nem hiba: az még senkié. A motor üres bejegyzést szabad
 * területként értelmez.
 */
export async function loadOwnership(
  layer: Layer,
  cells: Iterable<CellId>,
  today = gameDay(new Date()),
): Promise<OwnershipMap> {
  const candidateCells = [...cells];
  const blocks = blocksFor(layer, candidateCells);
  if (blocks.size === 0) return new Map();

  const refs = [...blocks.keys()].map((id) => db.collection(COLLECTIONS.grid).doc(id));
  const snapshots = await db.getAll(...refs);

  const storedBlocks = new Map<string, GridBlock | null>();
  for (const snapshot of snapshots) {
    storedBlocks.set(snapshot.id, snapshot.exists ? (snapshot.data() as GridBlock) : null);
  }
  return ownershipFromBlocks(layer, candidateCells, storedBlocks, today);
}

/**
 * OwnershipMap összeállítása már beolvasott grid blokkokból.
 *
 * A tranzakciós aktivitásmentés ezt használja, hogy a Firestore retry minden
 * alkalommal az éppen aktuális blokkverziókból számolja újra a foglalást.
 * A `cells` a teljes candidate halmaz: hurokfal ÉS belső cellák.
 */
export function ownershipFromBlocks(
  layer: Layer,
  cells: Iterable<CellId>,
  storedBlocks: ReadonlyMap<string, GridBlock | null>,
  today = gameDay(new Date()),
): OwnershipMap {
  const grouped = blocksFor(layer, cells);
  const ownership: OwnershipMap = new Map();

  for (const [blockId, blockCells] of grouped) {
    const block = storedBlocks.get(blockId);
    if (!block) continue;
    for (const cell of blockCells) {
      // `cellFromBlock` mindkét alakot kezeli — az uniformot és az explicitet.
      const stored = cellFromBlock(block, cell);
      if (stored) {
        ownership.set(cell, { owner: stored.o, defense: effectiveDefense(stored, today) });
      }
    }
  }

  return ownership;
}

/**
 * A birtokváltozások kiírása, blokkonként.
 *
 * TRANZAKCIÓBAN kell hívni, és a tranzakciónak előbb OLVASNIA kell a
 * blokkokat (`readBlocks`) — a Firestore megköveteli, hogy minden olvasás
 * megelőzze az írásokat. Ezért van a két lépés szétválasztva.
 */
export function writeOwnership(
  tx: FirebaseFirestore.Transaction,
  layer: Layer,
  updates: Map<CellId, CellOwnership>,
  existing: Map<string, GridBlock | null>,
  now: Date,
  actorId: string,
): void {
  const today = gameDay(now);
  const blocks = blocksFor(layer, updates.keys());

  for (const [blockId, cells] of blocks) {
    const current = existing.get(blockId) ?? null;
    const parent = blockId.slice(layer.length + 1);

    /**
     * A TÁROLT alak kibontása, hogy a részleges frissítés alkalmazható legyen.
     *
     * Ha a blokk uniform volt, most 343 bejegyzéssé bomlik — de csak a
     * memóriában, és csak addig, amíg el nem dől, hogy a frissítés után
     * megint egységes-e. A visszatömörítés lentebb, ugyanebben a lépésben.
     */
    const cellMap: Record<string, StoredCell> = current?.uniform
      ? Object.fromEntries(
          cellToChildren(parent, GAMEPLAY.H3_RESOLUTION).map((child) => [
            cellKey(child),
            { ...current.uniform! },
          ]),
        )
      : { ...(current?.cells ?? {}) };
    const ownerCounts: Record<string, number> = { ...(current?.ownerCounts ?? {}) };

    for (const cell of cells) {
      const key = cellKey(cell);
      const next = updates.get(cell)!;
      const previous = cellMap[key];

      // A tulajdonosonkénti darabszám a gyors összegzéshez kell (ranglista,
      // profil). Kézzel vezetjük, mert újraszámolni 343 cellát minden
      // írásnál pazarlás lenne.
      if (previous) {
        ownerCounts[previous.o] = Math.max(0, (ownerCounts[previous.o] ?? 1) - 1);
        if (ownerCounts[previous.o] === 0) delete ownerCounts[previous.o];
      }
      ownerCounts[next.owner] = (ownerCounts[next.owner] ?? 0) + 1;

      cellMap[key] = { o: next.owner, d: next.defense, u: today };
    }

    /**
     * VISSZATÖMÖRÍTÉS — az írás pillanatában, nem külön jobban.
     *
     * Így nincs második írófél a rácson, nincs ütemezés, ami elhasalhat, és
     * nincs olyan állapot, amiben a blokk félig tömörített. A vizsgálat
     * ingyen van: a cellatérkép már a kezünkben van.
     *
     * A `blockCellCount` a pentagonokat is helyesen kezeli — azoknak
     * kevesebb gyerekük van, és uniformnak minősülnének, ha 343-mal
     * hasonlítanánk össze.
     */
    const uniform = uniformStateOf(cellMap, blockCellCount(parent, GAMEPLAY.H3_RESOLUTION));

    /**
     * TELJES FELÜLÍRÁS (`merge: false`), ezért a mező ELHAGYÁSA maga a törlés.
     *
     * `FieldValue.delete()` itt nem használható — a Firestore csak `update()`
     * vagy `merge: true` mellett fogadja el. Ha egy blokk uniformból vegyessé
     * válik, a régi `uniform` mező attól tűnik el, hogy nem írjuk bele az új
     * dokumentumba.
     */
    const payload: Record<string, unknown> = {
      layer,
      parent,
      // A két alak SOSEM él együtt: amelyik érvényes, a másik üres.
      cells: uniform ? {} : cellMap,
      ownerCounts,
      version: (current?.version ?? 0) + 1,
      updatedAt: now,
    };
    if (uniform) payload.uniform = uniform;

    tx.set(db.collection(COLLECTIONS.grid).doc(blockId), payload, { merge: false });
  }

  /**
   * Mutató a felhasználó blokkjairól — RÉTEGENKÉNT EGY DOKUMENTUM.
   *
   * A Firestore nem tud térkép-KULCSOKRA keresni, tehát azt a kérdést, hogy
   * „mely blokkokban van cellája ennek a felhasználónak", magából a rácsból
   * nem lehet megválaszolni. Ezért vezetünk külön mutatót.
   *
   * KORÁBBAN BLOKKONKÉNT EGY DOKUMENTUM VOLT, és ez két bajt okozott:
   *
   *   1. Megduplázta a tranzakció írásszámát. Egy foglalás blokkonként két
   *      írást jelentett (rács + mutató), így a Firestore 500-as korlátjába
   *      fele akkora körnél ütköztünk bele, mint kellett volna.
   *   2. A `users/{uid}/blocks/` alkollekciót a felhasználó-TILTÁS is
   *      használja (lásd `blockedBetween` a firestore.rules-ban), és azt a
   *      felhasználó maga írhatja. Vagyis a saját rács-mutatóit letörölhette
   *      volna, amitől a területe eltűnik a saját térképéről.
   *
   * Az `arrayUnion` olvasás nélkül, atomikusan fűz hozzá, és a duplikátumot
   * magától kiszűri — tehát ismételt köröknél sem nő a lista.
   *
   * ELAVULHAT: a felhasználó elveszítheti az összes celláját egy blokkban, a
   * blokk azonosítója viszont bent marad. Ezt olvasáskor szűrjük, nem
   * törléssel — a törlés minden károsultnál további írásokat jelentene.
   *
   * MÉRETKORLÁT: egy Firestore-dokumentum 1 MB. Egy blokkazonosító ~23 bájt,
   * tehát a lista nagyságrendileg 40 000 blokknál (≈4 200 km²) telik be. Ez
   * messze a valós használat fölött van, de ha valaha közelítenénk, a
   * megoldás a lista rétegenkénti darabolása.
   */
  if (blocks.size > 0) {
    tx.set(
      db
        .collection(COLLECTIONS.users)
        .doc(actorId)
        .collection(BLOCK_INDEX_COLLECTION)
        .doc(layer),
      { layer, blocks: FieldValue.arrayUnion(...blocks.keys()), updatedAt: now },
      { merge: true },
    );
  }
}

/**
 * KÉSZ blokkalakok kiírása — a compact út írófele.
 *
 * MIÉRT KÜLÖN A `writeOwnership`-től? Mert a két úton más a bemenet
 * természete. A `writeOwnership` CELLÁNKÉNTI változásokat kap, és neki kell a
 * blokkot kibontania, módosítania, majd visszatömörítenie. A compact út ezt
 * már elvégezte blokkonként (`resolveCompactBlockClaim`) — méghozzá úgy, hogy
 * a homogén blokkot SOHA nem bontotta ki 343 cellára. Ha itt újra
 * cellatérképen keresztül írnánk, pontosan azt a materializációt hoznánk
 * vissza, amiért az egész compact ág létezik.
 *
 * A `version` a hívótól jön (a beolvasott blokk `version + 1`-e), ezért az
 * ütközésvédelem ugyanaz marad, mint a másik úton.
 */
export function writeBlocks(
  tx: FirebaseFirestore.Transaction,
  layer: Layer,
  blocks: ReadonlyMap<string, GridBlock>,
  now: Date,
  actorId: string,
): void {
  for (const [blockId, block] of blocks) {
    /**
     * TELJES FELÜLÍRÁS (`merge: false`) — ugyanaz a szabály, mint fent: a
     * `uniform` mező elhagyása maga a törlés, amikor a blokk vegyessé válik.
     */
    const payload: Record<string, unknown> = {
      layer: block.layer,
      parent: block.parent,
      cells: block.uniform ? {} : block.cells,
      ownerCounts: block.ownerCounts,
      version: block.version,
      updatedAt: now,
    };
    if (block.uniform) payload.uniform = block.uniform;
    tx.set(db.collection(COLLECTIONS.grid).doc(blockId), payload, { merge: false });
  }

  if (blocks.size > 0) {
    tx.set(
      db
        .collection(COLLECTIONS.users)
        .doc(actorId)
        .collection(BLOCK_INDEX_COLLECTION)
        .doc(layer),
      { layer, blocks: FieldValue.arrayUnion(...blocks.keys()), updatedAt: now },
      { merge: true },
    );
  }
}

/**
 * A felhasználó blokkjainak azonosítói.
 *
 * Visszaesés a RÉGI, blokkonkénti alkollekcióra: a migráció előtt mentett
 * felhasználóknak még nincs index-dokumentumuk, és nem akarjuk, hogy a
 * területük eltűnjön a térképről, amíg a migráció le nem fut.
 */
export async function loadUserBlockIds(
  uid: string,
  layer: Layer,
  limit: number,
): Promise<{ blockIds: string[]; truncated: boolean; legacy: boolean }> {
  const indexRef = db
    .collection(COLLECTIONS.users)
    .doc(uid)
    .collection(BLOCK_INDEX_COLLECTION)
    .doc(layer);
  const index = await indexRef.get();

  if (index.exists) {
    const all = ((index.data() as { blocks?: string[] }).blocks ?? []).filter(
      (id) => typeof id === 'string',
    );
    return { blockIds: all.slice(0, limit), truncated: all.length > limit, legacy: false };
  }

  const legacy = await db
    .collection(COLLECTIONS.users)
    .doc(uid)
    .collection('blocks')
    .where('layer', '==', layer)
    .limit(limit)
    .get();

  return {
    blockIds: legacy.docs.map((doc) => doc.id),
    truncated: legacy.size >= limit,
    legacy: true,
  };
}

/** A tranzakción belüli olvasás — az írás előtt, egyben. */
export async function readBlocks(
  tx: FirebaseFirestore.Transaction,
  blockIds: Iterable<string>,
): Promise<Map<string, GridBlock | null>> {
  const ids = [...blockIds];
  const result = new Map<string, GridBlock | null>();
  if (ids.length === 0) return result;

  const refs = ids.map((id) => db.collection(COLLECTIONS.grid).doc(id));
  const snapshots = await tx.getAll(...refs);
  for (const snapshot of snapshots) {
    result.set(snapshot.id, snapshot.exists ? (snapshot.data() as GridBlock) : null);
  }
  return result;
}
