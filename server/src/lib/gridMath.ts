/**
 * A rács tiszta logikája — Firestore NÉLKÜL.
 *
 * Miért külön fájl? Mert a `grid.ts` behúzza a `firebase-admin`-t, ami csak a
 * szerver telepítésében létezik. A védelem elévülése viszont a játék
 * egyensúlyának a gerince, és élesben gyakorlatilag tesztelhetetlen: napok
 * múlását kellene kivárni hozzá. Itt viszont pontosan előállítható.
 *
 * Semmilyen I/O nincs benne, csak számítás.
 */

import { cellToParent } from 'h3-js';
import type { CellId, Layer } from '../../../src/types';

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
export interface StoredCell {
  /** owner — tulajdonos uid */
  o: string;
  /** defense — védelmi szint 1–5, AHOGY MEGSZEREZTÉK */
  d: number;
  /** updated day — a szerzés napja, korszaknaptól számított napszámként */
  u: number;
}

/**
 * A védelem elévülése — ütemezett job NÉLKÜL.
 *
 * A SZABÁLY: naponta egy szintet veszít, de sosem esik 1 alá. A tulajdonos
 * nem változik az elévüléstől — a cella a tiéd marad, csak egyre könnyebb
 * elvenni. Amit meg akarsz tartani erősen, azt rendszeresen újra kell futnod.
 *
 * Miért nem napi nullázás? Mert az egyetlen kihagyott nap miatt is teljesen
 * kinyitná a területet, és a napi megfelelést jutalmazná a rendszeres mozgás
 * helyett. Az egyesével csökkenő szint fokozatos: egy 5-ös védelmű folt négy
 * napig még ad valamit.
 *
 * Miért nincs ütemezett job? Egy naponta futó „mindent visszaír" feladat több
 * tízezer dokumentumot írna át, csak hogy egy számot csökkentsen — drága,
 * lassú, és félúton el is hasalhat, amitől a rács fele elévülne, a másik fele
 * nem. Ehelyett a cellához odaírjuk a szerzés napját, és OLVASÁSKOR számolunk.
 * Nulla írás, nincs ütemezés, nincs félbemaradt állapot.
 *
 * MELYIK NAP? Egyetlen, rögzített időzóna szerint — nem a felhasználó helyi
 * ideje szerint. A streaknél a helyi idő a helyes (az a felhasználó napja),
 * de egy CELLÁNAK nincs időzónája: a tulajdonos és a támadó lehet két külön
 * kontinensen, és akkor a védelem attól függne, ki nézi. Ráadásul utazással
 * vagy órát állítva lehetne napot váltani, ami támadási felület.
 */
const GAME_TIMEZONE = 'Europe/Budapest';

const MS_PER_DAY = 86_400_000;

/**
 * A játék napja, korszaknaptól számított NAPSZÁMKÉNT.
 *
 * Miért nem `20260816` alakban? Mert abból nem lehet napokat kivonni: a
 * 20260901 és a 20260831 különbsége 70 lenne, nem 1. A napszám viszont
 * egyszerű egész, és az elévülés pontosan egy kivonás.
 */
export function gameDay(date: Date): number {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: GAME_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .split('-')
    .map(Number) as [number, number, number];
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** Az érvényes védelem: naponta egy szint, de sosem kevesebb 1-nél. */
export function effectiveDefense(stored: StoredCell, today: number): number {
  const daysElapsed = today - stored.u;
  if (!Number.isFinite(daysElapsed) || daysElapsed <= 0) return stored.d;
  return Math.max(1, stored.d - daysElapsed);
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

