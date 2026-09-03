/**
 * MEKKORA VALÓJÁBAN AZ AKTIVITÁS-ADATLAP VÁLASZA, és mi csökkentené?
 *
 * MIÉRT KELL? A HANDOFF évek óta viszi tovább, hogy „az adatlap válasza 767 kB
 * egy nagy körön (42 666 cellaazonosító) — érdemes lehet az `activityCells`-t
 * is compactolva küldeni. MÉG NEM MÉRVE, mennyit érne." Ez a script méri meg,
 * mielőtt bárki hozzányúlna a mentési formátumhoz.
 *
 * HÁROM SZÁMOT ÁLLÍT SZEMBE dokumentumonként:
 *   1. a MAI válasz nyers mérete (amit a kliens ténylegesen letölt),
 *   2. ugyanez gzip-pel (a szerver ma NEM tömörít — mérve, 2026-09-03:
 *      az `/api/rules` `Accept-Encoding: gzip` mellett is `Content-Encoding`
 *      nélkül, tömörítetlenül jön vissza a Cloud Runról),
 *   3. az `activityCells` H3-compactolt változata (a HANDOFF ötlete).
 *
 * A kettő NEM ugyanazt támadja: a gzip a szövegismétlést, a H3-compact a
 * cellák számát. Egymás mellett is mérjük, hogy látszódjon, melyik hoz többet
 * és éri-e meg a kockázatot.
 *
 * ⚠️ CSAK OLVAS. Egyetlen dokumentumot sem ír.
 *
 * HASZNÁLAT (a `server` mappából):
 *   $env:GOOGLE_CLOUD_PROJECT="grundo"; npx.cmd tsx src/scripts/inspectActivityPayload.ts
 *   ... -- --top 5      → csak a legnagyobb 5 aktivitást részletezi
 */
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { compactCells, getResolution } from 'h3-js';
import { FieldPath } from 'firebase-admin/firestore';
import { adminApp, COLLECTIONS, db } from '../lib/firebase';

const args = process.argv.slice(2);
const top = numberFlag('--top') ?? 8;

const configuredProject = adminApp.options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? '';
if (!configuredProject) {
  throw new Error('Állítsd be a GOOGLE_CLOUD_PROJECT környezeti változót a futtatás előtt.');
}
console.log(`Projekt: ${configuredProject}\n`);

/** Ugyanazok a plafonok, mint az API-ban (`routes/activities.ts`). */
const MAX_ACTIVITY_CELLS = 20_000;
const MAX_ACTIVITY_CELL_PARENTS = 4_000;

interface Row {
  id: string;
  /** Hány cella VÉSZ EL ma a 20 000-es plafon miatt a kliens térképéről. */
  truncatedBy: number;
  /** Hány index kellene a TELJES foglaláshoz H3-compactolva. */
  compactAllCount: number;
  cells: number;
  parents: number;
  cellsCapped: number;
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
  compactCellCount: number;
  compactRawBytes: number;
  compactGzipBytes: number;
}

const rows: Row[] = [];
let scanned = 0;
let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;

do {
  let query = db
    .collection(COLLECTIONS.activities)
    .orderBy(FieldPath.documentId())
    .limit(50);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  if (page.empty) break;

  for (const doc of page.docs) {
    scanned += 1;
    const data = doc.data() as Record<string, unknown>;
    const cells = cellList(data.activityCells, MAX_ACTIVITY_CELLS);
    const parents = cellList(data.activityCellParents, MAX_ACTIVITY_CELL_PARENTS);
    if (cells.length === 0 && parents.length === 0) continue;

    /*
      A VÁLASZ KÖZELÍTÉSE. Nem a teljes adatlapot építjük fel (ahhoz szerző,
      kedvelés és fotó-URL is kellene), hanem azt a részt, ami a mérethez
      érdemben hozzájár: a két cellalistát és a kódolt nyomvonalat. A többi
      mező együtt néhány száz bájt — a nagyságrenden nem változtat.
    */
    const payload = {
      activityCells: cells,
      activityCellParents: parents,
      route: String(data.route ?? ''),
    };
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');

    /*
      A H3-COMPACT CSAK AZONOS FELBONTÁSÚ HALMAZON értelmes. Az `activityCells`
      elvben végig res12, de idegen adatként kezeljük: ha bármi más csúszott
      bele, a compactot kihagyjuk, nem pedig hibás számot írunk ki.
    */
    let compacted: string[] = [];
    try {
      const uniform = cells.length > 0 && cells.every((c) => getResolution(c) === getResolution(cells[0]!));
      compacted = uniform ? compactCells(cells) : [];
    } catch {
      compacted = [];
    }
    const compactPayload = {
      activityCells: compacted,
      activityCellParents: parents,
      route: String(data.route ?? ''),
    };
    const compactRaw = Buffer.from(JSON.stringify(compactPayload), 'utf8');

    /*
      A PLAFON NÉLKÜLI compact — ez mondja meg, mekkora plafon KELL ahhoz,
      hogy a nagy körök térképe ne csonkuljon. A fenti `compacted` a MAI,
      20 000-nél elvágott listából készül, tehát önmagában nem árulja el,
      hány index kellene a TELJES foglaláshoz.
    */
    const allCells = cellList(data.activityCells, Number.POSITIVE_INFINITY);
    let compactedAll: string[] = [];
    try {
      const uniform =
        allCells.length > 0 &&
        allCells.every((c) => getResolution(c) === getResolution(allCells[0]!));
      compactedAll = uniform ? compactCells(allCells) : [];
    } catch {
      compactedAll = [];
    }

    rows.push({
      id: doc.id,
      truncatedBy: Math.max(0, allCells.length - MAX_ACTIVITY_CELLS),
      compactAllCount: compactedAll.length,
      cells: Array.isArray(data.activityCells) ? data.activityCells.length : 0,
      parents: Array.isArray(data.activityCellParents) ? data.activityCellParents.length : 0,
      cellsCapped: cells.length,
      rawBytes: raw.byteLength,
      gzipBytes: gzipSync(raw, { level: 6 }).byteLength,
      brotliBytes: brotliCompressSync(raw, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
      }).byteLength,
      compactCellCount: compacted.length,
      compactRawBytes: compactRaw.byteLength,
      compactGzipBytes: gzipSync(compactRaw, { level: 6 }).byteLength,
    });
  }

  cursor = page.docs[page.docs.length - 1];
} while (cursor);

rows.sort((a, b) => b.rawBytes - a.rawBytes);

console.log(`Átnézve: ${scanned} aktivitás, ebből ${rows.length} hordoz cellaadatot.\n`);
console.log(`A ${Math.min(top, rows.length)} legnagyobb:\n`);

for (const row of rows.slice(0, top)) {
  console.log(`  ${row.id}`);
  console.log(
    `    cellák: ${row.cells} (plafonolva ${row.cellsCapped}) · parentek: ${row.parents}`,
  );
  console.log(`    MA (nyers):        ${kb(row.rawBytes)}`);
  console.log(
    `    gzip:              ${kb(row.gzipBytes)}  (${pct(row.gzipBytes, row.rawBytes)} megtakarítás)`,
  );
  console.log(
    `    brotli:            ${kb(row.brotliBytes)}  (${pct(row.brotliBytes, row.rawBytes)} megtakarítás)`,
  );
  console.log(
    `    H3-compact nyers:  ${kb(row.compactRawBytes)}  (${pct(row.compactRawBytes, row.rawBytes)} megtakarítás, ${row.cellsCapped} → ${row.compactCellCount} index)`,
  );
  console.log(
    `    H3-compact+gzip:   ${kb(row.compactGzipBytes)}  (${pct(row.compactGzipBytes, row.rawBytes)} megtakarítás)`,
  );
  if (row.truncatedBy > 0) {
    console.log(
      `    ⚠️ CSONKUL MA: ${row.truncatedBy} cella nem jut el a klienshez (a teljes foglalás compactolva ${row.compactAllCount} index lenne)`,
    );
  }
  console.log('');
}

const totals = rows.reduce(
  (acc, row) => ({
    raw: acc.raw + row.rawBytes,
    gzip: acc.gzip + row.gzipBytes,
    brotli: acc.brotli + row.brotliBytes,
    compactRaw: acc.compactRaw + row.compactRawBytes,
    compactGzip: acc.compactGzip + row.compactGzipBytes,
  }),
  { raw: 0, gzip: 0, brotli: 0, compactRaw: 0, compactGzip: 0 },
);

console.log('ÖSSZESEN (minden cellaadatot hordozó aktivitás):');
console.log(`  MA (nyers):        ${kb(totals.raw)}`);
console.log(`  gzip:              ${kb(totals.gzip)}  (${pct(totals.gzip, totals.raw)})`);
console.log(`  brotli:            ${kb(totals.brotli)}  (${pct(totals.brotli, totals.raw)})`);
console.log(`  H3-compact nyers:  ${kb(totals.compactRaw)}  (${pct(totals.compactRaw, totals.raw)})`);
console.log(`  H3-compact+gzip:   ${kb(totals.compactGzip)}  (${pct(totals.compactGzip, totals.raw)})`);

process.exit(0);

function cellList(raw: unknown, max: number): string[] {
  return Array.isArray(raw) ? raw.map(String).slice(0, max) : [];
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`.padStart(10);
}

function pct(part: number, whole: number): string {
  if (whole === 0) return '0%';
  return `${(100 - (part / whole) * 100).toFixed(1)}%`;
}

function numberFlag(name: string): number | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : undefined;
}
