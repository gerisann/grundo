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

import type { CellId, CellOwnership, Layer, OwnershipMap } from '../../../src/types';
import { db, COLLECTIONS } from './firebase';
import {
  blocksFor,
  cellKey,
  effectiveDefense,
  gameDay,
  type GridBlock,
  type StoredCell,
} from './gridMath';

// A tiszta logika a `gridMath`-ban él (tesztelhetőség miatt); innen is
// elérhető, hogy a hívóknak ne kelljen két helyről importálniuk.
export { BLOCK_RESOLUTION, blockIdFor, blocksFor, cellKey, effectiveDefense, gameDay } from './gridMath';
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
      const stored = block.cells?.[cellKey(cell)];
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

    const cellMap: Record<string, StoredCell> = { ...(current?.cells ?? {}) };
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
     * Mutató a felhasználó blokkjairól.
     *
     * A Firestore nem tud térkép-KULCSOKRA keresni, tehát azt a kérdést, hogy
     * „mely blokkokban van cellája ennek a felhasználónak", a rácsból nem
     * lehet megválaszolni. Ezért vezetünk külön mutatót. Elavulhat (a
     * felhasználó elveszítheti az összes celláját egy blokkban) — ezt
     * olvasáskor szűrjük, nem törléssel, mert a törlés minden károsultnál
     * további írásokat jelentene.
     */
    tx.set(
      db.collection(COLLECTIONS.users).doc(actorId).collection('blocks').doc(blockId),
      { layer, parent, updatedAt: now },
      { merge: true },
    );

    tx.set(
      db.collection(COLLECTIONS.grid).doc(blockId),
      {
        layer,
        parent,
        cells: cellMap,
        ownerCounts,
        version: (current?.version ?? 0) + 1,
        updatedAt: now,
      },
      { merge: false },
    );
  }
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
