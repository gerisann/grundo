/**
 * Riválisok — a saját listám.
 *
 * ⚠️ CSAK A SAJÁT LISTA LÉTEZIK, `/api/rivals`, nincs `/:username/rivals`.
 * Az, hogy kivel csaptál össze és mennyit vesztettél, a SAJÁT ügyed: egy
 * idegen rivális-listája megmutatná, kitől szokott veszíteni — vagyis
 * készen adna egy célpontlistát. A követők listája publikus, ez nem az.
 *
 * MIÉRT SZERVEROLDALON? Ugyanazért, mint a követő-listánál: az alkollekció
 * csak azonosítókat tárol, a névhez és a képhez felhasználónként külön
 * olvasás kellene a kliensről. Itt egy `getAll` hozza mind.
 *
 * A NEVEKET NEM MÁSOLJUK a rivális-rekordba. Kézenfekvő lenne (egy olvasással
 * kevesebb), de a felhasználónév változhat, és egy elavult név a listában
 * rosszabb, mint egy extra lekérdezés — a rivális pont az az ember, akit fel
 * kell ismerni.
 */

import { Router, type Response } from 'express';
import { COLLECTIONS, db } from '../lib/firebase';
import { rivalIds, toRivalRecord } from '../lib/rivals';
import { GAMEPLAY } from '../../../src/config/gameplay';
import type { AuthedRequest } from '../../server';

export const rivalsRouter = Router();

/**
 * Ennyi rivális megy ki egy kérésre.
 *
 * A követő-listánál (100) nagyobb, mert ez a lista KERESHETŐ: a keresés a
 * betöltött halmazon fut a kliensen, tehát amit nem küldtünk ki, azt nem is
 * lehet megtalálni. A `hasMore` őszintén megmondja, ha valaki ennél is
 * többel csapott már össze.
 */
const RIVAL_LIMIT = 200;

/** Ennyi rivális kerül ki kiemelten a profilra. */
export const TOP_RIVALS = 3;

export interface RivalItem {
  uid: string;
  username: string;
  photoURL: string | null;
  /** Összes gazdát cserélt mező — a rangsor alapja, ez a fő szám. */
  exchangedCells: number;
  /** Amit ÉN vettem el TŐLE (zölddel). */
  gainedCells: number;
  /** Amit Ő vett el TŐLEM (pirossal). */
  lostCells: number;
  gainedEvents: number;
  lostEvents: number;
  exchangedM2: number;
  gainedM2: number;
  lostM2: number;
}

/* ═══════════════════════════════════════════════════════════════════
   GET /api/rivals — a teljes lista, rangsorolva
   ═══════════════════════════════════════════════════════════════════ */

rivalsRouter.get('/', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const own = db.collection(COLLECTIONS.users).doc(uid);

    const [snapshot, blocked, blockedBy] = await Promise.all([
      own
        .collection('rivals')
        .orderBy('exchangedCells', 'desc')
        .limit(RIVAL_LIMIT + 1)
        .get(),
      own.collection('blocks').select().get(),
      own.collection('blockedBy').select().get(),
    ]);

    /*
      A TILTÁS OLVASÁSKOR SZŰR, nem íráskor (lásd `lib/rivals.ts`). Mindkét
      irány kizár: akit én tiltottam, és aki engem tiltott — ugyanaz a
      halmaz, mint a feednél és a keresésnél (docs/05: „sem a tiltó, sem a
      tiltott nem látja a másikat").
    */
    const hidden = new Set([
      ...blocked.docs.map((doc) => doc.id),
      ...blockedBy.docs.map((doc) => doc.id),
    ]);

    const visible = snapshot.docs.filter((doc) => !hidden.has(doc.id));
    const hasMore = visible.length > RIVAL_LIMIT;
    const page = visible.slice(0, RIVAL_LIMIT);

    // Egy körben minden felhasználó dokumentuma — nem azonosítónként külön.
    const users = page.length
      ? await db.getAll(...page.map((doc) => db.collection(COLLECTIONS.users).doc(doc.id)))
      : [];
    const byId = new Map(users.filter((doc) => doc.exists).map((doc) => [doc.id, doc]));

    const cellM2 = GAMEPLAY.CELL_AREA_M2;
    const items: RivalItem[] = [];
    for (const doc of page) {
      const user = byId.get(doc.id);
      if (!user) continue;
      const username = String((user.data() as Record<string, unknown>)?.username ?? '');
      // Felhasználónév nélkül nincs hova navigálni — az ilyen sor csak zavarna.
      if (!username) continue;

      const record = toRivalRecord(doc.data() as Record<string, unknown>);
      // A nulla mezős rivális nem összecsapás; ilyet csak sérült adat adhat.
      if (record.exchangedCells <= 0) continue;

      items.push({
        uid: doc.id,
        username,
        photoURL: ((user.data() as Record<string, unknown>)?.photoURL as string | null) ?? null,
        ...record,
        exchangedM2: record.exchangedCells * cellM2,
        gainedM2: record.gainedCells * cellM2,
        lostM2: record.lostCells * cellM2,
      });
    }

    res.json({ items, hasMore, top: TOP_RIVALS });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   GET /api/rivals/ids — csak az azonosítók, a „RIVÁLIS" címkékhez
   ═══════════════════════════════════════════════════════════════════ */

/**
 * A címke a NEVEK MELLETT jelenik meg, mindenhol: feedben, hozzászólásnál,
 * ranglistán, keresésben. A felületnek tehát egyetlen kérdést kell tudnia
 * gyorsan megválaszolnia — „rivális-e ez az uid?" —, és ehhez a puszta
 * halmaz elég. Nevek és számok nélkül ez egy `select()`-es lekérdezés.
 *
 * ⚠️ A TILTOTTAK ITT IS KIMARADNAK. Ha nem így lenne, a letiltott ember neve
 * ugyan sehol nem jelenne meg, de ahol mégis átcsúszik (például egy régi
 * hozzászólás-idézetben), ott még címkét is kapna.
 */
rivalsRouter.get('/ids', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const own = db.collection(COLLECTIONS.users).doc(uid);

    const [ids, blocked, blockedBy] = await Promise.all([
      rivalIds(uid, RIVAL_LIMIT),
      own.collection('blocks').select().get(),
      own.collection('blockedBy').select().get(),
    ]);

    const hidden = new Set([
      ...blocked.docs.map((doc) => doc.id),
      ...blockedBy.docs.map((doc) => doc.id),
    ]);

    res.json({ ids: ids.filter((id) => !hidden.has(id)) });
  } catch (error) {
    next(error);
  }
});
