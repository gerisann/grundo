/**
 * Riválisok — akiktől területet vettél el, vagy akik tőled.
 *
 * A rivalitás nem kérés és nem elfogadás kérdése, mint a követés: MEGTÖRTÉNIK.
 * Egyetlen forrása van, a területrablás — ha A elvesz B-től akár egy mezőt is,
 * a kettejük neve összekapcsolódik, és onnantól mindkettejüknél ott a másik.
 *
 * ⚠️ A KAPCSOLAT SZIMMETRIKUS, A TÁROLÁS NEM. Két dokumentum keletkezik,
 * mindkettő a SAJÁT felhasználójáé — `users/{A}/rivals/{B}` és
 * `users/{B}/rivals/{A}` —, tükörképi számokkal: ami az egyiknél `gainedCells`,
 * az a másiknál `lostCells`. Így a „kik az én riválisaim" kérdés EGY
 * alkollekció-lekérdezés, nem a teljes bázis átfésülése. Ugyanaz a minta,
 * mint a `blocks`/`blockedBy` tükörnél.
 *
 * A RANGSOR ALAPJA a kicserélt mezők száma (`exchangedCells` = szerzett +
 * vesztett). Geri döntése (2026-08-22): „ha valaki 1×10 cellát lopott tőlünk,
 * az ugyanannyit ér, mintha valaki 10×1 cellát vesz el" — vagyis az alkalmak
 * száma önmagában NEM súlyoz, csak a mezők összege. Az alkalmakat ettől még
 * számoljuk, mert a felületen elmondható („12 összecsapás"), és utólag már nem
 * lenne visszamenőleg kiszámolható.
 *
 * ⚠️ A TILTÁS NEM ITT SZŰR, hanem OLVASÁSKOR. Ha a tiltás pillanatában
 * törölnénk a rivális-rekordot, a feloldás után nem lehetne visszaállítani —
 * az adat elveszne. Így viszont a tiltás pontosan azt csinálja, amit ígér:
 * elrejt, nem töröl.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, db } from './firebase';

/** Egy rivális nyers számai, ahogy a Firestore-ban állnak. */
export interface RivalRecord {
  /** Mezők, amiket ÉN vettem el TŐLE. */
  gainedCells: number;
  /** Mezők, amiket Ő vett el TŐLEM. */
  lostCells: number;
  /** `gainedCells + lostCells` — a rangsor ezen megy, ezért külön mező. */
  exchangedCells: number;
  /** Hány külön alkalommal vettem el tőle. */
  gainedEvents: number;
  /** Hány külön alkalommal vett el tőlem. */
  lostEvents: number;
}

/**
 * ⚠️ NINCS `firstAt` MEZŐ, és ez szándékos.
 *
 * Kézenfekvő lett volna az első összecsapás idejét is eltenni — de a
 * `set(..., { merge: true })` MINDEN alkalommal felülírná, tehát valójában az
 * utolsó időpontot tárolná „első" néven. Feltétel nélküli első-írásra
 * tranzakció kellene (olvasás, majd írás) minden áldozatra külön, ami egy
 * aktivitás mentését érdemben lassítaná — egy olyan adatért, amit a felület
 * nem is kér. A `lastAt` viszont pontosan azt jelenti, aminek látszik.
 */

/**
 * Rivalitás rögzítése egy aktivitás lopásaiból.
 *
 * A `stolenFrom` alakja `{ áldozat uid: elvett mezők }` — pontosan az, amit a
 * `resolveClaim` ad, és amit az aktivitás dokumentuma is eltesz. Ez utóbbi
 * fontos: ha ez a hívás valaha elhasal, az adat NEM vész el véglegesen,
 * mert az aktivitásokból újraszámolható (`scripts/backfillRivals.ts`).
 *
 * SOSE DOB — az értesítések és a jelvények mintájára. Egy elmaradt
 * rivális-bejegyzés kellemetlen; egy emiatt elhasalt aktivitás-mentés nem
 * elfogadható.
 */
export async function recordRivalry(
  actorId: string,
  stolenFrom: Readonly<Record<string, number>>,
): Promise<void> {
  try {
    const users = db.collection(COLLECTIONS.users);
    const batch = db.batch();
    const now = FieldValue.serverTimestamp();
    let writes = 0;

    for (const [victimId, raw] of Object.entries(stolenFrom)) {
      const cells = Math.round(Number(raw));
      // A nulla vagy negatív bejegyzés nem összecsapás; a saját magától
      // „lopás" pedig egy visszafoglalás, nem rivalitás.
      if (!(cells > 0) || victimId === actorId) continue;

      // A támadó oldala: ő SZERZETT.
      batch.set(
        users.doc(actorId).collection('rivals').doc(victimId),
        {
          gainedCells: FieldValue.increment(cells),
          exchangedCells: FieldValue.increment(cells),
          gainedEvents: FieldValue.increment(1),
          lastAt: now,
        },
        { merge: true },
      );

      // Az áldozat oldala: ő VESZTETT. Ugyanaz a szám, tükrözve.
      batch.set(
        users.doc(victimId).collection('rivals').doc(actorId),
        {
          lostCells: FieldValue.increment(cells),
          exchangedCells: FieldValue.increment(cells),
          lostEvents: FieldValue.increment(1),
          lastAt: now,
        },
        { merge: true },
      );
      writes += 2;
    }

    if (writes > 0) await batch.commit();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[rivals] a rivalitás rögzítése elhasalt', error);
  }
}

/**
 * A megadottak közül kik voltak MÁR EDDIG IS a riválisaim?
 *
 * ⚠️ EZT A `recordRivalry` ELŐTT KELL HÍVNI, különben mindig mindenkire igazat
 * ad. A rivalitást ugyanis maga a lopás hozza létre: aki után rögzítettünk, az
 * definíció szerint rivális. A felületen viszont pontosan az a kérdés, hogy a
 * támadó KORÁBBAN is az volt-e — az első összecsapás még semleges hangot kap
 * („Elvették a grundod"), a visszatérő ellenfél már nem.
 *
 * Célzott olvasás, nem az egész lista: annyi dokumentumot kérünk, ahány
 * áldozat van, így egy több száz riválissal rendelkező felhasználónál sem
 * csúszhat ki senki egy limit alól.
 */
export async function existingRivals(
  uid: string,
  otherIds: readonly string[],
): Promise<Set<string>> {
  if (otherIds.length === 0) return new Set();
  const rivals = db.collection(COLLECTIONS.users).doc(uid).collection('rivals');
  const docs = await db.getAll(...otherIds.map((id) => rivals.doc(id)), {
    // Csak a létezés kérdés, a mezők nem — a `fieldMask` üresre állítása
    // a legolcsóbb alak.
    fieldMask: [],
  });
  return new Set(docs.filter((doc) => doc.exists).map((doc) => doc.id));
}

/**
 * Kik a riválisaim — CSAK az azonosítók.
 *
 * Ebből lesz a felületen a név melletti „RIVÁLIS" címke, tehát minden
 * képernyőnek kellhet. Ezért `select()`: a mezőket nem olvassuk be, csak a
 * dokumentum-azonosítókat — így a lekérdezés akkor is olcsó marad, ha valaki
 * több száz emberrel csapott már össze.
 */
export async function rivalIds(uid: string, limit: number): Promise<string[]> {
  const snapshot = await db
    .collection(COLLECTIONS.users)
    .doc(uid)
    .collection('rivals')
    .orderBy('exchangedCells', 'desc')
    .limit(limit)
    .select()
    .get();
  return snapshot.docs.map((doc) => doc.id);
}

/** A dokumentum mezői számmá alakítva, hiányzó mezőkkel is helyesen. */
export function toRivalRecord(data: Record<string, unknown> | undefined): RivalRecord {
  const gainedCells = Math.max(0, Number(data?.gainedCells ?? 0));
  const lostCells = Math.max(0, Number(data?.lostCells ?? 0));
  return {
    gainedCells,
    lostCells,
    // Nem a tárolt `exchangedCells`-t hisszük el: ha egy régi vagy félbemaradt
    // írás miatt eltérne a két résztől, a felületen összeadás-hiba látszana.
    exchangedCells: gainedCells + lostCells,
    gainedEvents: Math.max(0, Number(data?.gainedEvents ?? 0)),
    lostEvents: Math.max(0, Number(data?.lostEvents ?? 0)),
  };
}
