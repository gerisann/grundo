/**
 * A rivalitás tükör-írása valódi Firestore ellen.
 *
 * A `recordRivalry` két dokumentumot ír egy batch-ben (`gainedCells` /
 * `lostCells` tükörpár) — pontosan az a fajta kód, amit típusellenőrzés nem
 * fog meg, ha a tükrözés valahol elszámolja magát. Ez a teszt ezt bizonyítja,
 * valamint az `existingRivals` sorrend-függő viselkedését (lásd a fejlécét
 * a `rivals.ts`-ben: MINDIG a `recordRivalry` ELŐTT kell hívni).
 *
 * FUTTATÁS (a repo gyökeréből): `npm.cmd run test:emulator`
 * Emulátor nélkül a fájl MAGÁTÓL KIMARAD.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const A = 'rival-teszt-a';
const B = 'rival-teszt-b';
const C = 'rival-teszt-c';

describe.skipIf(!EMULATOR)('rivals — valódi Firestore ellen', () => {
  let db: FirebaseFirestore.Firestore;
  let recordRivalry: typeof import('./rivals').recordRivalry;
  let existingRivals: typeof import('./rivals').existingRivals;
  let rivalIds: typeof import('./rivals').rivalIds;
  let toRivalRecord: typeof import('./rivals').toRivalRecord;

  beforeAll(async () => {
    const firebase = await import('./firebase');
    db = firebase.db;
    const rivals = await import('./rivals');
    recordRivalry = rivals.recordRivalry;
    existingRivals = rivals.existingRivals;
    rivalIds = rivals.rivalIds;
    toRivalRecord = rivals.toRivalRecord;
  });

  afterAll(async () => {
    // Semmi teendő — az emulátor a futás végén magától leáll.
  });

  beforeEach(async () => {
    for (const uid of [A, B, C]) {
      const snap = await db.collection('users').doc(uid).collection('rivals').get();
      for (const doc of snap.docs) await doc.ref.delete();
    }
  });

  it('a tükör pontosan fordított: A gainedCells == B lostCells', async () => {
    await recordRivalry(A, { [B]: 10 });

    const aSide = await db.collection('users').doc(A).collection('rivals').doc(B).get();
    const bSide = await db.collection('users').doc(B).collection('rivals').doc(A).get();

    expect(toRivalRecord(aSide.data())).toMatchObject({
      gainedCells: 10,
      lostCells: 0,
      exchangedCells: 10,
      gainedEvents: 1,
      lostEvents: 0,
    });
    expect(toRivalRecord(bSide.data())).toMatchObject({
      gainedCells: 0,
      lostCells: 10,
      exchangedCells: 10,
      gainedEvents: 0,
      lostEvents: 1,
    });
  });

  it('ismételt összecsapás összeadódik, mindkét oldalon', async () => {
    await recordRivalry(A, { [B]: 10 });
    await recordRivalry(B, { [A]: 4 });

    const aSide = await db.collection('users').doc(A).collection('rivals').doc(B).get();
    const bSide = await db.collection('users').doc(B).collection('rivals').doc(A).get();

    expect(toRivalRecord(aSide.data())).toMatchObject({
      gainedCells: 10,
      lostCells: 4,
      exchangedCells: 14,
      gainedEvents: 1,
      lostEvents: 1,
    });
    expect(toRivalRecord(bSide.data())).toMatchObject({
      gainedCells: 4,
      lostCells: 10,
      exchangedCells: 14,
      gainedEvents: 1,
      lostEvents: 1,
    });
  });

  it('nulla, negatív és önmagától lopás nem hoz létre rekordot', async () => {
    await recordRivalry(A, { [B]: 0, [C]: -5, [A]: 3 });

    const bSide = await db.collection('users').doc(A).collection('rivals').doc(B).get();
    const cSide = await db.collection('users').doc(A).collection('rivals').doc(C).get();
    const selfSide = await db.collection('users').doc(A).collection('rivals').doc(A).get();

    expect(bSide.exists).toBe(false);
    expect(cSide.exists).toBe(false);
    expect(selfSide.exists).toBe(false);
  });

  it('existingRivals csak a MÁR EDDIG IS meglévőket adja — a recordRivalry előtt hívva', async () => {
    await recordRivalry(A, { [B]: 5 });

    // C még sosem csapott össze A-val, B már igen.
    const before = await existingRivals(A, [B, C]);
    expect(before).toEqual(new Set([B]));

    // Az első összecsapás C-vel: még nem volt rivális, amikor a hívás történt.
    await recordRivalry(A, { [C]: 2 });
    const after = await existingRivals(A, [B, C]);
    expect(after).toEqual(new Set([B, C]));
  });

  it('rivalIds a kicserélt mezők szerint csökkenő sorrendben ad azonosítókat', async () => {
    await recordRivalry(A, { [B]: 3 });
    await recordRivalry(A, { [C]: 9 });

    expect(await rivalIds(A, 10)).toEqual([C, B]);
    expect(await rivalIds(A, 1)).toEqual([C]);
  });
});
