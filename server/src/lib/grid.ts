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

import { cellToParent } from 'h3-js';
import type { CellId, CellOwnership, Layer, OwnershipMap } from '../../../src/types';
import { db, COLLECTIONS } from './firebase';

/** A blokk felbontása. NEM a cellák felbontása (az res 12). */
const BLOCK_RESOLUTION = 9;

/**
 * A cella kulcsa a blokkon belül: az index utolsó 6 karaktere.
 *
 * Miért nem a teljes index? Mert a szülő minden gyerekének ugyanaz az eleje,
 * és 343 cellánál a 15 karakteres kulcsok több kilobájtnyi ismétlést
 * jelentenének dokumentumonként. A teljes index sosem kell visszafejteni:
 * olvasáskor is, íráskor is a kezünkben van.
 */
export function cellKey(cell: CellId): string {
  return cell.slice(-6);
}

export function blockIdFor(layer: Layer, cell: CellId): string {
  return `${layer}_${cellToParent(cell, BLOCK_RESOLUTION)}`;
}

/** Tárolt alak — rövid kulcsok, mert 343-szor ismétlődnek. */
interface StoredCell {
  /** owner — tulajdonos uid */
  o: string;
  /** defense — védelmi szint 1–5 */
  d: number;
}

export interface GridBlock {
  layer: Layer;
  parent: string;
  cells: Record<string, StoredCell>;
  ownerCounts: Record<string, number>;
  version: number;
}

/** Mely blokkokat érinti ez a cellahalmaz? */
export function blocksFor(layer: Layer, cells: Iterable<CellId>): Map<string, CellId[]> {
  const blocks = new Map<string, CellId[]>();
  for (const cell of cells) {
    const id = blockIdFor(layer, cell);
    const list = blocks.get(id);
    if (list) list.push(cell);
    else blocks.set(id, [cell]);
  }
  return blocks;
}

/**
 * A cellák JELENLEGI tulajdonosa.
 *
 * A hiányzó cella nem hiba: az még senkié. A motor üres bejegyzést szabad
 * területként értelmez.
 */
export async function loadOwnership(layer: Layer, cells: Iterable<CellId>): Promise<OwnershipMap> {
  const blocks = blocksFor(layer, cells);
  const ownership: OwnershipMap = new Map();
  if (blocks.size === 0) return ownership;

  const refs = [...blocks.keys()].map((id) => db.collection(COLLECTIONS.grid).doc(id));
  const snapshots = await db.getAll(...refs);

  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;
    const block = snapshot.data() as GridBlock;
    for (const cell of blocks.get(snapshot.id) ?? []) {
      const stored = block.cells?.[cellKey(cell)];
      if (stored) ownership.set(cell, { owner: stored.o, defense: stored.d });
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
): void {
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

      cellMap[key] = { o: next.owner, d: next.defense };
    }

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
