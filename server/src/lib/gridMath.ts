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

import { cellToChildren, cellToChildrenSize, cellToParent } from 'h3-js';
import type { CellId, Layer } from '../../../src/types';

/** A blokk felbontása. NEM a cellák felbontása (az res 12). */
export const BLOCK_RESOLUTION = 9;

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
  return localDay(date, GAME_TIMEZONE);
}

/**
 * Ugyanaz a napszám, de TETSZŐLEGES időzónában.
 *
 * A cellák elévülése a rögzített `GAME_TIMEZONE` szerint megy (lásd fent), a
 * SOROZAT és a napi forduló viszont a felhasználó helyi ideje szerint — az
 * tényleg az ő napja. A `gameDay` ennek a rögzített időzónás esete, hogy a két
 * számítás soha ne csússzon szét egymástól: egy dátumkezelés, két hívó.
 *
 * Érvénytelen időzónánál a rögzített játékidőzónára esünk vissza. Egy elgépelt
 * `users.timezone` mező nem állíthatja meg a napi fordulót — a felhasználó
 * legrosszabb esetben egy másik órában fordul, de fordul.
 */
export function localDay(date: Date, timeZone: string): number {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .split('-')
    .map(Number) as [number, number, number];
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** A helyi óra (0–23) az adott időzónában — a forduló ebből tudja, mikor van éjfél. */
export function localHour(date: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: safeTimeZone(timeZone),
      hour: '2-digit',
      hour12: false,
    }).format(date),
  );
}

const validatedZones = new Map<string, string>();

function safeTimeZone(timeZone: string): string {
  if (!timeZone) return GAME_TIMEZONE;
  const cached = validatedZones.get(timeZone);
  if (cached) return cached;
  let resolved = GAME_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
    resolved = timeZone;
  } catch {
    resolved = GAME_TIMEZONE;
  }
  validatedZones.set(timeZone, resolved);
  return resolved;
}

/**
 * A KÖVETKEZŐ helyi éjfél időpontja.
 *
 * Ebből lesz a `users.rollover.nextDueAt`, amire a napi forduló lekérdezése
 * megy — így nem kell óránként végigolvasni az összes felhasználót.
 *
 * Miért felezés, és miért nem „a mai nap plusz 24 óra"? Mert a nyári időszámítás
 * váltásakor a helyi nap 23 vagy 25 órás. A felezés az egyetlen olyan megoldás,
 * ami a `localDay` DEFINÍCIÓJÁBÓL dolgozik, nem egy párhuzamos időzóna-modellből
 * — így a két számítás nem tud szétcsúszni egymástól. Az éjfél mindig egész
 * percre esik, tehát a perces pontosság itt egzakt.
 */
export function nextLocalMidnight(date: Date, timeZone: string): Date {
  const MINUTE = 60_000;

  /**
   * PERCRE IGAZÍTVA keresünk. Az éjfél mindig egész percre esik, tehát ha a
   * keresés minden lépése percalapú, a végén `high` PONTOSAN az éjfél — nem
   * „valahol az utolsó percen belül". Az igazítás lefelé történik, így ha a
   * hívás épp az éjfél percében, de már utána érkezik, a percnyitás az új
   * naphoz tartozik, és helyesen a KÖVETKEZŐ éjfelet adjuk vissza.
   */
  let low = Math.floor(date.getTime() / MINUTE) * MINUTE;
  const today = localDay(new Date(low), timeZone);

  let high = low + 26 * 60 * MINUTE;
  while (localDay(new Date(high), timeZone) <= today) high += 60 * MINUTE;

  while (high - low > MINUTE) {
    const steps = Math.floor((high - low) / (2 * MINUTE));
    const mid = low + steps * MINUTE;
    if (mid === low) break;
    if (localDay(new Date(mid), timeZone) > today) high = mid;
    else low = mid;
  }
  return new Date(high);
}

/**
 * A napszámból hétfő-kezdetű hét sorszáma.
 *
 * A napszám nullapontja (1970-01-01) csütörtök volt, innen a +3 eltolás. Ebből
 * a heti ablak zárása egyetlen összehasonlítás: ha a hét sorszáma nagyobb, mint
 * a legutóbbi fordulóé, új hét kezdődött.
 */
export function weekOf(day: number): number {
  return Math.floor((day + 3) / 7);
}

/** A napszámhoz tartozó naptári hónap kulcsa, `év * 12 + hónap` alakban. */
export function monthOf(day: number): number {
  const date = new Date(day * MS_PER_DAY);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
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
  /**
   * EGYSÉGES BLOKK — ha minden cellája ugyanabban az állapotban van.
   *
   * Egy 343 cellás blokk JSON-ben ~23 kB, amiből ~9 kB puszta uid-ismétlés.
   * Ha az egész blokk ugyanazé, ugyanazon a védelmi szinten, ugyanazon a
   * napon szerezve, akkor egyetlen rekord elég: **152-szer kisebb**.
   *
   * Miért számít? Egy nagy foglalás belseje jellemzően pontosan ilyen: egyben
   * szerzett, homogén terület. A Balaton-kör ~5 700 blokkjából ~5 100 ilyen
   * lenne — 133 MB helyett ~15 MB.
   *
   * Ha `uniform` van, a `cells` ÜRES. A kettő sosem él együtt: az olvasók az
   * `expandBlock`-ot használják, és nem kell tudniuk, melyik alakban érkezett.
   */
  uniform?: StoredCell;
}

/** Hány res 12 cella van ebben a res 9 blokkban? (Pentagonnál kevesebb.) */
export function blockCellCount(parent: string, resolution: number): number {
  return cellToChildrenSize(parent, resolution);
}

/**
 * Egy blokk cellája — akármelyik alakban is érkezett.
 *
 * Ez az EGYETLEN hely, ahol az uniform és az explicit alak különbsége
 * megjelenik. Minden olvasó ezen keresztül kérdez, ezért a tömörítés a
 * hívóknak láthatatlan.
 */
export function cellFromBlock(
  block: GridBlock | null | undefined,
  cell: CellId,
): StoredCell | undefined {
  if (!block) return undefined;
  if (block.uniform) return block.uniform;
  return block.cells?.[cellKey(cell)];
}

/**
 * Egy blokk ÖSSZES cellája, akármelyik alakban is érkezett.
 *
 * A megjelenítő végpontok ezt használják. Enélkül egy uniform blokk üres
 * térképszakaszként jelenne meg — a felhasználó azt látná, hogy eltűnt a
 * területe, pedig csak tömörítve van.
 */
export function expandBlock(
  block: GridBlock,
  resolution: number,
): [CellId, StoredCell][] {
  if (block.uniform) {
    const state = block.uniform;
    return cellToChildren(block.parent, resolution).map(
      (child) => [child, state] as [CellId, StoredCell],
    );
  }

  const byKey = new Map<string, CellId>();
  for (const child of cellToChildren(block.parent, resolution)) byKey.set(cellKey(child), child);

  const out: [CellId, StoredCell][] = [];
  for (const [key, stored] of Object.entries(block.cells ?? {})) {
    const cell = byKey.get(key);
    if (cell) out.push([cell, stored]);
  }
  return out;
}

/**
 * Egységes-e a blokk a frissítés után?
 *
 * Három feltétel: minden cella jelen van, mind ugyanazé, és mind ugyanazon a
 * védelmi szinten és napon áll. A nap is számít — enélkül két különböző napon
 * szerzett cella egyformának látszana, pedig az elévülésük eltér.
 */
export function uniformStateOf(
  cells: Record<string, StoredCell>,
  expectedCount: number,
): StoredCell | null {
  const keys = Object.keys(cells);
  if (keys.length !== expectedCount || expectedCount === 0) return null;
  const first = cells[keys[0]!]!;
  for (const key of keys) {
    const cell = cells[key]!;
    if (cell.o !== first.o || cell.d !== first.d || cell.u !== first.u) return null;
  }
  return { ...first };
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

