/**
 * H3 SZOMSZÉDSÁG — egyszer kiszámolva, sokszor felhasználva.
 *
 * ── MIÉRT VAN EZ A MODUL ───────────────────────────────────────────────
 *
 * A `gridDisk(cell, 1)` a h3-js-en át egy WASM-hívás, ami hét ÚJ stringet
 * foglal. Önmagában olcsó (~1-2 µs), csak épp a motor legforgalmasabb
 * művelete: a kitöltés, a hurokdetektor, a körüljárási szám és a
 * foltépítés is cellánként hívja, gyakran ugyanarra a cellára.
 *
 * MÉRVE (2026-09-02, 55 km-es városi rács, 3 515 cellás nyomvonal): a
 * hurokdetektor 430-szor hívta a `buildLoopInterior`-t, ÖSSZESEN 87 072
 * ms-ot töltve benne — hívásonként 202 ms-ot. A 430 jelölt nagyjából
 * ugyanazon a néhány tízezer cellás területen dolgozik, tehát ugyanazoknak
 * a celláknak a szomszédságát a motor több százszor számolta ki újra.
 *
 * A gyorsítótár ezt egyszeri költséggé teszi. NEM közelítés: a H3
 * szomszédság a cellaazonosító tiszta függvénye, tehát nincs elavulás —
 * csak memória, és azt a `MAX_CACHED_CELLS` fogja.
 *
 * ── HASZNÁLAT ──────────────────────────────────────────────────────────
 *
 * A visszaadott tömb MEGOSZTOTT és CSAK OLVASHATÓ. Aki módosítaná (rendezés,
 * `splice`), az minden későbbi hívónak elrontja — ezért a típusa `readonly`.
 * Szűrni továbbra is szabad: a `.filter()` új tömböt ad.
 *
 * ⚠️ CSAK az 1-es sugárra való. A nagyobb gyűrűk (`gridDisk(cell, 2)`)
 * ritkábbak és nagyobbak, ott a gyorsítótár többet ártana a memóriának,
 * mint amennyit a futásidőn nyerne.
 *
 * KÖZÖS MODUL: se DOM, se Firebase, se Node API.
 */

import { cellToChildren, cellToParent, gridDisk } from 'h3-js';
import type { CellId } from '@/types';

/**
 * Ennyi cella szomszédságát tartjuk meg.
 *
 * Bejegyzésenként hét azonosító a tömb és a `Map` terhével együtt nagyjából
 * fél kilobájt, tehát a plafonon ~100 MB. A három gyorsítótár (szomszédság,
 * szülő, gyerekek) együtt is ~150 MB körül tetőzik, ami belefér a Cloud Run
 * 2 GiB-jébe a foglalás-számítás ~920 MB-os csúcsa mellett is (lásd
 * `loops.ts` `MAX_CLAIM_CELLS`).
 *
 * A korlát elérésekor a teljes tartalmat eldobjuk, nem egyenként avulunk.
 * Egy LRU könyvelése cellánként több időbe kerülne, mint amennyit a
 * megtartott bejegyzések megspórolnak — a nyereség úgyis abból jön, hogy
 * EGY aktivitás feldolgozása alatt ugyanaz a néhány tízezer cella
 * ismétlődik, és az sosem éri el ezt a plafont.
 */
const MAX_CACHED_CELLS = 250_000;

const cache = new Map<CellId, readonly CellId[]>();

/**
 * A cella és a hat élszomszédja — ugyanaz, amit a `gridDisk(cell, 1)` ad.
 *
 * A tömb első eleme maga a cella, ahogy a h3-js-nél is; a hívók ezért
 * ugyanúgy szűrik ki magukat, mint eddig.
 */
export function ringOf(cell: CellId): readonly CellId[] {
  const cached = cache.get(cell);
  if (cached !== undefined) return cached;

  const ring = gridDisk(cell, 1) as CellId[];
  if (cache.size >= MAX_CACHED_CELLS) cache.clear();
  cache.set(cell, ring);
  return ring;
}

/**
 * FELBONTÁSVÁLTÁS — ugyanezért, ugyanígy.
 *
 * Az adaptív kitöltés (`loops.ts` `floodFillInteriorAdaptive`) a falat két
 * felbontással feljebb viszi, majd a határsávot visszabontja: hívásonként
 * egy `cellToParent` minden falcellára és egy 49 elemű `cellToChildren`
 * minden durva cellára. A hurokdetektor ezt jelöltenként újra elvégzi
 * ugyanazokon a cellákon — pontosan az az ismétlés, amit a `ringOf` már
 * megszüntetett a szomszédságnál.
 *
 * A kulcsba a felbontás is bele kell hogy kerüljön: ugyanaz a cella
 * különböző célfelbontásokon más eredményt ad.
 */
const parents = new Map<string, CellId>();
const children = new Map<string, readonly CellId[]>();

/** `cellToParent(cell, resolution)`, memoizálva. */
export function parentOf(cell: CellId, resolution: number): CellId {
  const key = `${resolution}:${cell}`;
  const cached = parents.get(key);
  if (cached !== undefined) return cached;

  const parent = cellToParent(cell, resolution) as CellId;
  if (parents.size >= MAX_CACHED_CELLS) parents.clear();
  parents.set(key, parent);
  return parent;
}

/**
 * `cellToChildren(cell, resolution)`, memoizálva.
 *
 * ⚠️ A visszaadott tömb MEGOSZTOTT és CSAK OLVASHATÓ — ugyanaz a szabály,
 * mint a `ringOf`-nál.
 *
 * A bejegyzés itt 49 azonosító (két felbontásnyi ugrás), tehát hétszer
 * nagyobb, mint a szomszédságnál — ezért kap hetedakkora plafont.
 */
export function childrenOf(cell: CellId, resolution: number): readonly CellId[] {
  const key = `${resolution}:${cell}`;
  const cached = children.get(key);
  if (cached !== undefined) return cached;

  const list = cellToChildren(cell, resolution) as CellId[];
  if (children.size >= MAX_CACHED_CELLS / 7) children.clear();
  children.set(key, list);
  return list;
}

/**
 * A gyorsítótárak ürítése — teszteknek és hosszan futó folyamatoknak.
 *
 * A helyességhez SOHA nem kell (sem a szomszédság, sem a felbontásváltás nem
 * avul el); kizárólag a memória visszaadására való.
 */
export function clearNeighbourCache(): void {
  cache.clear();
  parents.clear();
  children.clear();
}

/** Hány cella szomszédsága van most eltárolva — méréshez. */
export function neighbourCacheSize(): number {
  return cache.size;
}
