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

import { gridDisk } from 'h3-js';
import type { CellId } from '@/types';

/**
 * Ennyi cella szomszédságát tartjuk meg.
 *
 * Bejegyzésenként hét azonosító, nagyjából 250 bájt — 250 000 cellánál ez
 * ~60 MB, ami bőven belefér a Cloud Run 2 GiB-jébe a foglalás-számítás
 * ~920 MB-os csúcsa mellett is (lásd `loops.ts` `MAX_CLAIM_CELLS`).
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
 * A gyorsítótár ürítése — teszteknek és hosszan futó folyamatoknak.
 *
 * A helyességhez SOHA nem kell (a szomszédság nem avul el); kizárólag a
 * memória visszaadására való.
 */
export function clearNeighbourCache(): void {
  cache.clear();
}

/** Hány cella szomszédsága van most eltárolva — méréshez. */
export function neighbourCacheSize(): number {
  return cache.size;
}
