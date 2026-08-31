import { Router } from 'express';
import { type DocumentReference, type Query } from 'firebase-admin/firestore';
import { COLLECTIONS, db, FIREBASE_STORAGE_BUCKET, storage } from '../lib/firebase';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { distanceM } from '../../../src/game/geo';
import { activityTitle } from '../../../src/lib/format';
import { GAMEPLAY } from '../../../src/config/gameplay';
import type { ActivityType, TracePoint } from '../../../src/types';
import type { AuthedRequest } from '../../server';
import {
  buildPublicRoutePatch,
  buildOwnerRouteView,
  normalizePrivacy,
  publicRouteNeedsRebuild,
  PUBLIC_ROUTE_VERSION,
} from '../lib/publicRoute';
/**
 * A MENTÉS logikája külön modulban él.
 *
 * Ez a fájl a HTTP-felület: útvonalak, bemenet-ellenőrzés, válaszformátum. A
 * területfoglalás, a pontszámítás és a tranzakció az `activityCommit`-ban van
 * — lásd az ottani fejlécet arról, miért pont ott húzódik a határ.
 */
import {
  commitActivity,
  fitsOneTransaction,
  planActivity,
  sanitizePublicSummary,
} from '../lib/activityCommit';
import { commitChunkedActivity } from '../lib/activityChunked';
import { requiresChunkedClaim } from '../lib/activityRouting';
import { evaluateAndAwardBadges } from '../lib/badges';
import {
  notifyActivityLiked,
  notifyBadgesAwarded,
  notifyCommentPosted,
  notifyFollowedActivity,
  notifyGpActivity,
  notifyTerritoryDefended,
  notifyTerritoryStolen,
} from '../lib/notifications';
import { existingRivals, recordRivalry, toRivalRecord, type RivalRecord } from '../lib/rivals';
import { scheduleTerritoryBlobRecompute } from '../lib/territoryBlobStore';
import { layerOf } from '../../../src/game/cells';

export const activitiesRouter = Router();

/**
 * Legfeljebb ennyi pontot fogadunk el egy aktivitásból.
 *
 * Egy négyórás bringázás másodpercenkénti mintavétellel is 14 400 pont, de a
 * szűrés után jóval kevesebb marad. A 20 000 bőven fedi a valós használatot, és
 * megvéd attól, hogy valaki egy több millió pontos kéréssel fojtsa meg a
 * szolgáltatást.
 */
const MAX_POINTS = 20_000;

/** Ennél régebbi aktivitást nem fogadunk el — az óra elállítása gyanús. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Egy szerző a feedben, az aktivitás-részletekben és a hozzászólásoknál.
 *
 * ⚠️ AZ `uid` 2026-08-22 ÓTA VAN BENNE. Korábban csak a név és a kép ment
 * ki, amivel a felület nem tudta AZONOSÍTANI a szerzőt — csak megjeleníteni.
 * A „RIVÁLIS" címkéhez viszont pontosan erre van szükség: a kliens a saját
 * rivális-halmazát uid szerint tartja. Névre illeszteni törékenyebb lett
 * volna (átnevezés után némán rossz eredményt ad), az uid viszont állandó.
 */
interface Author {
  uid: string;
  username: string;
  photoURL: string | null;
  /**
   * A választott cellaszín KULCSA (lásd `src/lib/cellColors.ts`), ha a
   * felhasználó állított magának. A rivális-sáv ebből színezi a két felet —
   * mindenki a saját színén, ugyanúgy, mint a térképen (Geri kérése,
   * 2026-08-29).
   *
   * ⚠️ HIÁNYZÓ MEZŐ ≠ ALAPÉRTELMEZETT SZÍN. Ha a felhasználó nem választott,
   * `null` megy ki, és a felület a MOSTANI lila-magenta párost tartja meg. A
   * `cellColorHex()` ilyenkor a paletta alapszínét adná, ami itt hazugság
   * lenne: nem tudnánk megkülönböztetni a „nem választott" esetet attól, aki
   * történetesen a bézst választotta.
   */
  cellColor: string | null;
}

/** Törölt vagy hiányzó felhasználó — a sor ettől még megjeleníthető. */
function unknownAuthor(uid: string): Author {
  return { uid, username: 'ismeretlen', photoURL: null, cellColor: null };
}

/** A user dokumentumból kiolvasott cellaszín-kulcs, ha van. */
function cellColorOf(data: { cellColor?: unknown } | undefined): string | null {
  return typeof data?.cellColor === 'string' && data.cellColor ? data.cellColor : null;
}


interface UploadBody {
  activityId?: unknown;
  type?: unknown;
  points?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  movingMs?: unknown;
}

/**
 * POST /api/activities — egy befejezett aktivitás feldolgozása.
 *
 * A LEGFONTOSABB SZABÁLY: a klienstől érkező SEMMILYEN származtatott érték
 * nem elfogadható. A táv, a cellalánc, a bezárt terület és a pont mind itt
 * számolódik újra, a nyers nyomvonalból. A kliens ugyanezt kiszámolja, de az
 * csak előnézet — ha a kettő eltér, a szerveré az igazság.
 *
 * Ha ez nem így lenne, a foglalás egyetlen módosított kéréssel hamisítható
 * volna, és a játéknak vége.
 *
 * IDEMPOTENS: az `activityId`-t a kliens adja, még a rögzítés indulásakor. Ha
 * a hálózat elszáll és a kliens újrapróbál, ugyanaz az aktivitás nem íródik be
 * kétszer — a terület és a pont nem duplázódik.
 *
 * A Trust Score, a területvesztés-események és a napi GP-plafon MÁR ITT VAN,
 * mind a mentés tranzakciójában. Ami még hiányzik: a zónák újraszámolása, az
 * előnézeti térképkép, és a nagy foglalások sorbaállítása — az utóbbi a
 * jelenlegi egyetlen valódi méretkorlát (lásd FIRESTORE_MAX_TRANSACTION_WRITES).
 */
activitiesRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const uid = req.uid!;
    const body = req.body as UploadBody;

    const activityId = String(body.activityId ?? '').trim();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(activityId)) {
      throw badRequest('invalid_activity_id', 'Hiányzó vagy hibás aktivitás-azonosító.');
    }

    const type = body.type as ActivityType;
    if (type !== 'run' && type !== 'walk' && type !== 'ride') {
      throw badRequest('invalid_type', 'Ismeretlen mozgásforma.');
    }

    const points = parsePoints(body.points);
    const startedAt = Number(body.startedAt);
    const endedAt = Number(body.endedAt);
    const movingMs = Math.max(0, Number(body.movingMs) || 0);

    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
      throw badRequest('invalid_time', 'Hibás időadatok.');
    }
    if (Date.now() - startedAt > MAX_AGE_MS) {
      throw badRequest('too_old', 'Ez az aktivitás túl régi ahhoz, hogy feldolgozzuk.');
    }

    /**
     * Előszűrés — a MUNKA megspórolására, nem az idempotencia biztosítására.
     *
     * A valódi védelem a tranzakción belül van (`commitActivity`): ez itt csak
     * annyit ér el, hogy egy nyilvánvaló ismétlésnél ne fussunk le a teljes
     * motoron és a rács-olvasáson.
     */
    const preflight = await db.collection(COLLECTIONS.activities).doc(activityId).get();
    if (preflight.exists) {
      const data = preflight.data() as { userId?: string; summary?: unknown };
      if (data.userId !== uid) {
        throw badRequest('activity_conflict', 'Ez az azonosító már foglalt.');
      }
      return res.json({ activityId, summary: sanitizePublicSummary(data.summary), duplicate: true });
    }

    // Geometria és méretellenőrzés — determinisztikus, tranzakción kívül.
    const plan = planActivity({ activityId, uid, type, points, startedAt, endedAt, movingMs });

    /**
     * A birtokviszonytól függő rész — KÉT ÚT KÖZÜL AZ EGYIKEN.
     *
     * A hétköznapi aktivitás elfér egyetlen tranzakcióban, és azon a gyors
     * úton megy: ütközéskor a Firestore újrafuttatja a callbacket, friss
     * állapotból. Ami nem fér bele — nagyjából 26 km kerületű kör fölött —,
     * az a darabolt úton, blokkcsoportonként egy tranzakcióval.
     *
     * A méret önmagában tehát SOHA nem ok arra, hogy elvesszen a kör.
     *
     * ⚠️ AZ ÍRÁSSZÁM ÖNMAGÁBAN NEM ELÉG a döntéshez. A compact hurok belseje
     * parentekben van, nem res12 cellákban, ezért egy több tíz km²-es kör
     * blokkszáma is bőven a korlát alatt maradhat — a gyors út viszont a
     * shared motort hívná valódi ownershippel, ami compact hurokra
     * SZÁNDÉKOSAN dob (`processActivityGeometry` őre). A `requiresChunkedClaim`
     * ezért a geometriát is nézi, nem csak a méretet.
     */
    const committed = requiresChunkedClaim(plan.loops, fitsOneTransaction(plan))
      ? await commitChunkedActivity(plan)
      : await db.runTransaction((tx) => commitActivity(tx, plan));

    if (committed.duplicate) {
      return res.json({ activityId, summary: committed.summary, duplicate: true });
    }

    const stolenFrom = Object.entries(committed.stolenFrom ?? {}).filter(([, count]) => count > 0);
    const breakthroughFrom = Object.entries(committed.breakthroughFrom ?? {}).filter(([, count]) => count > 0);

    /**
     * A rivalitás a válasz előtt létrejön.
     *
     * Korábban ez a tűzz-és-felejtsd értesítési blokkban futott, ezért az
     * aktivitás mentése után azonnal megnyitott profil még üres rivális-listát
     * kaphatott. A rivális badge kiértékelése is csak a következő aktivitásnál
     * látta volna a kapcsolatot. Az „eddig is rivális volt-e” halmazt továbbra
     * a tükörírás ELŐTT olvassuk, hogy az első támadás semleges maradjon.
     */
    const alreadyRivals = stolenFrom.length > 0
      ? await existingRivals(uid, stolenFrom.map(([victimId]) => victimId))
      : new Set<string>();
    if (stolenFrom.length > 0) {
      await recordRivalry(uid, Object.fromEntries(stolenFrom));
    }

    /**
     * A TÉRKÉP TERÜLETFOLTJAINAK ÚJRASZÁMOLÁSA — a támadóra és az áldozataira.
     *
     * A foltok előszámolt, nézettől független egységek (lásd
     * `territoryBlobStore.ts`), ezért a birtokviszony minden változása után
     * frissülniük kell. Az ÁLDOZATOK is kellenek: ha valakinek a területe
     * közepét vették el, a foltja kettévált, és ezt csak az ő
     * újraszámolása látja.
     *
     * ⚠️ NEM VÁRJUK MEG. Mérve (2026-08-28): egy ~80 000 cellás terület
     * újraszámolása ~2,1 másodperc, és egy aktivitás jellemzően 4-5
     * felhasználót érint — a mentés így ~9 másodpercet állt volna egy
     * MEGJELENÍTÉSI adat kedvéért. A háttérsor ezt leveszi a kérésről, és
     * az ugyanarra a felhasználóra érkező igényeket is összevonja.
     */
    scheduleTerritoryBlobRecompute([uid, ...stolenFrom.map(([victimId]) => victimId)], layerOf(type));

    /**
     * A jelvény-kiértékelés a FŐ TRANZAKCIÓN KÍVÜL fut, de a válasz ELŐTT,
     * bevárva.
     *
     * ⚠️ EZ SZÁNDÉKOSAN NEM TŰZZ-ÉS-FELEJTSD, az `auth.ts` regisztrációs
     * levelével ellentétben. Ott a mellékhatás (e-mail) semmilyen később
     * olvasott állapotot nem érint. Itt viszont a jelvény-jutalom UGYANAZT a
     * `gpTotal` mezőt írja, amit a hívó a válasz UTÁN azonnal visszaolvashat
     * — egy `void`-dal indított háttérírás versenyhelyzetbe kerülne ezzel:
     * az `activities.emulator.test.ts` egy tesztje a badge-írás előtti VAGY
     * utáni `gpTotal`-t is láthatná, időzítéstől függően. A bevárás ezt
     * kizárja, és mivel `evaluateAndAwardBadges` sose dob, a mentés sikere
     * nem függ a jelvény-kiértékelés kimenetelétől.
     *
     * (A `dailyRollover.ts`-ből EGYÁLTALÁN NEM hívjuk — lásd
     * `server/src/lib/badges.ts` fejlécét: ott a badge-GP MÉRVE megbuktatott
     * két emulátoros tesztet, mert azok a jutalom-GP-t pontos értékkel
     * ellenőrzik.)
     */
    const awardedBadges = await evaluateAndAwardBadges(uid);

    /**
     * Az összes ÉRTESÍTÉS a VÁLASZ UTÁN indul, tűzz-és-felejtsd módon.
     *
     * Ezek — a jelvényektől eltérően — SEMMILYEN mezőt nem írnak, amit a
     * hívó a válasz után visszaolvasna (se `gpTotal`-t, se mást a saját
     * profilján), tehát a fenti versenyhelyzet itt nem áll fenn.
     */
    void (async () => {
      const summary = committed.summary as { gp?: number; areaGainedM2?: number } | undefined;
      if (summary) {
        notifyGpActivity(uid, activityId, Number(summary.gp ?? 0), Number(summary.areaGainedM2 ?? 0));
      }
      if (awardedBadges.length > 0) notifyBadgesAwarded(uid, awardedBadges);

      if (stolenFrom.length > 0 || breakthroughFrom.length > 0) {
        const actor = await db.collection(COLLECTIONS.users).doc(uid).get();
        const username = String((actor.data() as { username?: string })?.username ?? 'Valaki');

        /*
          A RIVALITÁS A LOPÁSBÓL KELETKEZIK, ÉS EZ AZ EGYETLEN FORRÁSA.

          ⚠️ Az ÁTTÖRÉS (`breakthroughFrom`) NEM csinál riválist: az egy
          MEGVÉDETT támadás, tehát egyetlen mező sem cserélt gazdát. Aki nem
          vett el semmit, azzal nincs mit „kicserélni".

          ⚠️ A SORREND KÖTÖTT: előbb megkérdezzük, ki volt MÁR EDDIG IS
          rivális, és csak UTÁNA rögzítünk. Fordítva a kérdés értelmét
          vesztené — a rögzítés után minden áldozat rivális, tehát mindenki a
          rivális-hangnemű értesítést kapná, az első összecsapásnál is.
        */
        for (const [victimId, count] of stolenFrom) {
          notifyTerritoryStolen(
            victimId,
            username,
            count,
            count * GAMEPLAY.CELL_AREA_M2,
            alreadyRivals.has(victimId),
          );
        }
        for (const [victimId, count] of breakthroughFrom) {
          notifyTerritoryDefended(victimId, count);
        }
      }

      /**
       * A KÖVETŐK — legfeljebb 300, ugyanaz a felső korlát, mint a `following`
       * feed-nézetnél (`following` alkollekció, lásd `routes/users.ts`).
       */
      const followers = await db
        .collection(COLLECTIONS.users)
        .doc(uid)
        .collection('followers')
        .limit(300)
        .select()
        .get();
      if (!followers.empty) {
        const actor = await db.collection(COLLECTIONS.users).doc(uid).get();
        const username = String((actor.data() as { username?: string })?.username ?? 'Valaki');
        // A mentés `title: null`-lal jön létre, tehát itt mindig az
        // automatikus, napszak + mozgásforma alakú cím a helyes.
        notifyFollowedActivity(
          followers.docs.map((doc) => doc.id),
          username,
          activityId,
          activityTitle(type, startedAt),
        );
      }
    })().catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[activities] aktivitás utáni értesítések elhasaltak', error);
    });

    res.status(201).json({ activityId, summary: committed.summary });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/activities — a feed.
 *
 * Nézetek (`scope`):
 *   mine      — a sajátjaim
 *   world     — mindenki, időrendben
 *   local     — mindenki, de csak a közelben (lat/lng/radiusKm kell hozzá)
 *   following — akiket követek
 *   user      — egyetlen felhasználó nyilvános aktivitásai (`userId` kell hozzá)
 *
 * A KÖVETÉS a `users/{uid}/following` alkollekcióból dolgozik. A Firestore
 * `in` szűrője EGYSZERRE 30 értéket enged, ezért a listát darabokra bontjuk,
 * és a darabok eredményét itt fésüljük össze. A `FOLLOWING_CHUNKS` felső
 * korlát azt fogja meg, hogy egy sok száz embert követő fiók feedje ne
 * jelentsen tucatnyi lekérdezést minden görgetésnél.
 *
 * A HELYI nézet földrajzi szűrése ITT történik, nem a lekérdezésben: a
 * Firestore nem tud „adott ponttól x km-en belül" kérdést. A rendes megoldás
 * geohash-tartományok lennének; addig a friss aktivitásokat kérjük le, és
 * távolság szerint szűrünk.
 *
 * MIKOR KELL CSERÉLNI? Amikor a napi aktivitások száma meghaladja a
 * `LOCAL_SCAN_LIMIT`-et — onnantól egy távoli város aktivitásai kiszoríthatják
 * a közelieket a vizsgált halmazból, és a helyi feed hiányosan töltődne.
 */
const LOCAL_SCAN_LIMIT = 300;

/** A Firestore `in` szűrője egyszerre ennyi értéket enged. */
const IN_CHUNK = 30;

/** Legfeljebb ennyi darabban kérdezünk rá a követettekre (30 × 10 = 300 fő). */
const FOLLOWING_CHUNKS = 10;

type Scope = 'mine' | 'world' | 'local' | 'following' | 'user';

activitiesRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const scope = parseScope(req.query.scope);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const dateFrom = parseFeedDate(req.query.dateFrom, 'dateFrom');
    const dateTo = parseFeedDate(req.query.dateTo, 'dateTo');
    if (dateFrom !== null && dateTo !== null && dateFrom > dateTo) {
      throw badRequest('invalid_date_range', 'Az időszak kezdete nem lehet később a végénél.');
    }

    const collection = db.collection(COLLECTIONS.activities);
    const perQueryLimit =
      scope === 'local' ? LOCAL_SCAN_LIMIT : scope === 'mine' ? Math.min(150, limit * 3) : limit;

    /** A dátumszűrő és a rendezés minden nézetre ugyanaz — egy helyen. */
    const finish = (query: Query): Query => {
      let next = query;
      if (dateFrom !== null) next = next.where('startedAt', '>=', new Date(dateFrom));
      if (dateTo !== null) next = next.where('startedAt', '<=', new Date(dateTo));
      // A saját listában a 30 napig tárolt soft-delete dokumentumokat csak a
      // lekérés után tudjuk kiszűrni, ezért kis ráhagyással olvasunk.
      return next.orderBy('startedAt', 'desc').limit(perQueryLimit);
    };

    const queries: Query[] = [];
    if (scope === 'mine') {
      queries.push(finish(collection.where('userId', '==', req.uid!)));
    } else if (scope === 'user') {
      const target = String(req.query.userId ?? '');
      if (!target) throw badRequest('missing_user', 'Hiányzik a felhasználó azonosítója.');
      /**
       * A SAJÁT profilom is ezen a nézeten megy — ott viszont a rejtett
       * aktivitásokat is látnom kell, hiszen az enyémek. Idegen profilnál
       * csak a `visibility: 'everyone'` megy ki; a `followers` láthatóság
       * szűrése akkor kerül ide, amikor a Feed is tud vele mit kezdeni.
       */
      queries.push(
        finish(
          target === req.uid
            ? collection.where('userId', '==', target)
            : collection.where('userId', '==', target).where('visibility', '==', 'everyone'),
        ),
      );
    } else if (scope === 'following') {
      const following = await db
        .collection(COLLECTIONS.users)
        .doc(req.uid!)
        .collection('following')
        .limit(IN_CHUNK * FOLLOWING_CHUNKS)
        .get();
      const ids = following.docs.map((doc) => doc.id);
      if (ids.length === 0) {
        return res.json({ activities: [], truncated: false });
      }
      for (let index = 0; index < ids.length; index += IN_CHUNK) {
        queries.push(
          finish(
            collection
              .where('userId', 'in', ids.slice(index, index + IN_CHUNK))
              .where('visibility', '==', 'everyone'),
          ),
        );
      }
    } else {
      queries.push(finish(collection.where('visibility', '==', 'everyone')));
    }

    const snapshots = await Promise.all(queries.map((query) => query.get()));
    /**
     * Több darab esetén az egyesített halmazt ÚJRA RENDEZNI kell: külön-külön
     * mindegyik időrendben jön, együtt viszont nem. Rendezés nélkül a feed
     * darabonként csoportosítva mutatná a bejegyzéseket.
     */
    const docs = snapshots
      .flatMap((snapshot) => snapshot.docs)
      .sort((a, b) => toMillis(b.data().startedAt) - toMillis(a.data().startedAt))
      .slice(0, scope === 'local' ? LOCAL_SCAN_LIMIT : perQueryLimit);

    const repairLimit = scope === 'local' ? Math.min(50, docs.length) : docs.length;
    const documents = await Promise.all(
      docs.map(async (doc, index) => {
        const data = doc.data() as Record<string, unknown>;
        if (index >= repairLimit || data.deletedAt != null) return data;
        return repairActivityRoute(doc.ref, data);
      }),
    );
    /**
     * A TILTOTT FELHASZNÁLÓK aktivitásai KIESNEK a feedből — MINDKÉT IRÁNYBAN.
     *
     * ⚠️ Ez a szűrés a lekérdezés UTÁN történik, nem benne. A Firestore-nak
     * nincs „nem egyenlő ezekkel a uid-ekkel" szűrője (a `not-in` legfeljebb
     * 10 értéket enged, és nem kombinálható a meglévő rendezéssel), ezért a
     * sorokat itt dobjuk el. Ennek ÁRA van: egy sok embert letiltó
     * felhasználónál a feed rövidebb lehet a kért `limit`-nél. Ez a helyes
     * csere — inkább kevesebb sor, mint egy letiltott ember bejegyzése.
     *
     * A KÉT IRÁNY KÉT ALKOLLEKCIÓ, és mindkettő a SAJÁT felhasználómé:
     *
     *   - `blocks` — kit tiltottam én,
     *   - `blockedBy` — ki tiltott engem (a szerver által írt tükör, lásd
     *     `routes/users.ts` → block).
     *
     * A tükör nélkül a második irányhoz minden szerző `blocks`
     * alkollekcióját külön kellene olvasni soronként; így két olcsó,
     * párhuzamos lekérdezés adja mindkettőt. (`docs/05` → „sem a tiltó, sem
     * a tiltott nem látja a másikat".)
     */
    const own = db.collection(COLLECTIONS.users).doc(req.uid!);
    const [blocked, blockedBy] = await Promise.all([
      own.collection('blocks').select().get(),
      own.collection('blockedBy').select().get(),
    ]);
    const blockedIds = new Set([
      ...blocked.docs.map((doc) => doc.id),
      ...blockedBy.docs.map((doc) => doc.id),
    ]);

    let rows = documents
      .map((data, index) => ({ data, doc: docs[index]! }))
      .filter(({ data }) => data.deletedAt == null)
      .map(({ data, doc }) => toFeedRow(doc.id, data))
      .filter((row) => !blockedIds.has(row.userId));
    rows = await withOwnerFullRoutes(rows, req.uid!);
    if (scope === 'mine' || scope === 'user' || scope === 'following') rows = rows.slice(0, limit);

    let truncated = false;
    if (scope === 'local') {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const radiusKm = Math.min(200, Math.max(1, Number(req.query.radiusKm) || 10));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw badRequest('missing_position', 'A helyi nézethez meg kell adni a pozíciót.');
      }
      rows = rows
        .filter((row) => row.center !== null && distanceM({ lat, lng }, row.center) <= radiusKm * 1000)
        .slice(0, limit);
      truncated = docs.length >= LOCAL_SCAN_LIMIT;
    }

    const authored = await withAuthors(rows, req.uid!);
    res.json({ activities: await withLegacyPhotoUrls(authored), truncated });
  } catch (error) {
    next(error);
  }
});

function parseScope(raw: unknown): Scope {
  const value = String(raw ?? 'mine');
  if (
    value === 'mine' ||
    value === 'world' ||
    value === 'local' ||
    value === 'following' ||
    value === 'user'
  ) {
    return value;
  }
  throw badRequest('invalid_scope', 'Ismeretlen nézet.');
}

interface FeedRow {
  id: string;
  userId: string;
  type: unknown;
  layer: unknown;
  startedAt: number;
  distanceM: number;
  movingS: number;
  areaGainedM2: number;
  gp: number;
  /** A nyomvonal közepe — a helyi szűréshez és a térképhez. */
  center: { lat: number; lng: number } | null;
  /** A levágott, kódolt nyomvonal a kártya térképéhez. */
  route: string;
  /** Üres a nyomvonal, mert a privát zóna teljesen lefedte? */
  routeHidden: boolean;
  title: string | null;
  photos: ActivityPhoto[];
  likeCount: number;
  commentCount: number;
  activityCells: string[];
  /**
   * A nagy (compact) hurkok belseje, H3-compactolt — a kliens bontja ki
   * res12-re. Lásd `ActivityPlan.candidateCellParents`: enélkül a nagy hurkok
   * közepe üresen maradt a térképen.
   */
  activityCellParents: string[];
  /** Hány cellát szerzett az aktivitás: szabad földről + máshonnan elvéve. */
  cellsGained: number;
  /** Ebből mennyi jött MÁS JÁTÉKOSTÓL — a kártya rivális-sávjának korall fele. */
  cellsStolen: number;
  /** uid → tőle elvett cellák. A nevet/képet a `withAuthors` teszi hozzá. */
  stolenFrom: Record<string, number>;
}

export interface ActivityPhoto {
  /** A Storage-beli útvonal; a képet hitelesített API-végpont szolgálja ki. */
  path: string;
}

/** Idegen forrásból jövő térkép — a kulcs uid, az érték cellaszám. */
function parseStolenFrom(raw: unknown): Record<string, number> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [uid, value] of Object.entries(raw as Record<string, unknown>)) {
    const count = Number(value);
    if (Number.isFinite(count) && count > 0) out[uid] = Math.round(count);
  }
  return out;
}

/**
 * A rivális-sáv két száma.
 *
 * ⚠️ A `reclaimed` NEM SZERZÉS. A saját, már birtokolt cella újbóli
 * bejárása védelmet épít, de nem növeli a területet — a motor is így
 * számol (`claim.ts`: csak a `free` és a `stolen` ad `gainedM2`-t). Ha
 * beleszámítanánk, a kártyán nagyobb szám állna, mint amennyivel a grund
 * ténylegesen nőtt.
 *
 * KÉT ÚT VAN, és a régi aktivitásoké sem becslés:
 *
 * 1. `claimCounts` — a mentés 2026-08-26 óta kiírja, ez az elsődleges.
 * 2. Hiányában a `stolenFrom` (a `backfillActivityRivals` szkript tölti
 *    vissza a `territoryEvents` történetből) és az `areaGainedM2`.
 *
 * A visszaosztás EGZAKT, nem közelítés: az `areaGainedM2` definíció szerint
 * `gainedCells × CELL_AREA_M2`, tehát a hányados egész. Éles adaton
 * ellenőrizve (2026-08-26, mind a 27 aktivitás): egyetlen törtrészes eset
 * sincs, és sehol nem jön ki negatív szabad terület.
 */
function claimCountsOf(data: Record<string, unknown>): { gained: number; stolen: number } {
  const counts = data.claimCounts as Record<string, unknown> | undefined;
  if (counts) {
    const free = Number(counts.free ?? 0);
    const stolen = Number(counts.stolen ?? 0);
    return { gained: free + stolen, stolen };
  }

  const stolen = Object.values(parseStolenFrom(data.stolenFrom)).reduce((sum, n) => sum + n, 0);
  const gained = Math.round(Number(data.areaGainedM2 ?? 0) / GAMEPLAY.CELL_AREA_M2);
  // Az elvett mezők a szerzés RÉSZE, tehát a szerzés soha nem lehet kevesebb.
  // Mérve nem fordul elő; a `max` csak azért van itt, hogy egy sérült régi
  // dokumentum se tudjon negatív szabad területet mutatni a sávon.
  return { gained: Math.max(gained, stolen), stolen };
}

/**
 * Cellalista a dokumentumból, plafonnal.
 *
 * ⚠️ A PLAFON A VÁLASZMÉRETET VÉDI, de nem lehet olyan szűk, hogy a területet
 * csonkolja. Az `activityCells` korábban 5 000-nél volt elvágva — egy éles,
 * háromhurkos aktivitásnál a tárolt 6 582 celláját is megnyirbálta
 * (2026-08-29). A 20 000 azért elég, mert a hurok belseje 40 000 cella fölött
 * úgyis a compact ágra kerül, és onnan a `activityCellParents` hozza.
 */
function parseCellList(raw: unknown, max: number): string[] {
  return Array.isArray(raw) ? raw.map(String).slice(0, max) : [];
}

const MAX_ACTIVITY_CELLS = 20_000;
/** Egy parent ~49 res12 cellát képvisel, tehát ez bőven lefed egy nagy kört. */
const MAX_ACTIVITY_CELL_PARENTS = 4_000;

function toFeedRow(id: string, data: Record<string, unknown>): FeedRow {
  const bounds = data.bounds as
    | { north: number; south: number; east: number; west: number }
    | undefined;
  const claimCounts = claimCountsOf(data);
  const userId = String(data.userId ?? '');
  return {
    cellsGained: claimCounts.gained,
    cellsStolen: claimCounts.stolen,
    stolenFrom: parseStolenFrom(data.stolenFrom),
    id,
    userId,
    type: data.type,
    layer: data.layer,
    startedAt: toMillis(data.startedAt),
    distanceM: Number(data.distanceM ?? 0),
    movingS: Number(data.movingS ?? 0),
    areaGainedM2: Number(data.areaGainedM2 ?? 0),
    gp: (data.gp as { total?: number } | undefined)?.total ?? 0,
    // Ez már levágott nyomvonal (lásd a feltöltésnél), tehát mindenkinek
    // kiadható, aki magát az aktivitást láthatja.
    route: String(data.route ?? ''),
    routeHidden: data.routeHidden === true,
    title: (data.title as string | undefined) || null,
    photos: parseStoredPhotos(data.photos, userId, id),
    likeCount: Number(data.likeCount ?? 0),
    commentCount: Number(data.commentCount ?? 0),
    activityCells: parseCellList(data.activityCells, MAX_ACTIVITY_CELLS),
    activityCellParents: parseCellList(data.activityCellParents, MAX_ACTIVITY_CELL_PARENTS),
    center: bounds
      ? { lat: (bounds.north + bounds.south) / 2, lng: (bounds.east + bounds.west) / 2 }
      : null,
  };
}

/**
 * A szerzők nevének hozzáfűzése.
 *
 * Az aktivitás csak `userId`-t tárol. Név nélkül a globális feed névtelen
 * sorok listája lenne, ami használhatatlan. A neveket kötegelve olvassuk, és
 * csak az EGYEDI szerzőkre — húsz aktivitás jellemzően néhány embertől van.
 */
async function withAuthors(rows: FeedRow[], viewerUid: string) {
  /*
    A SZERZŐK ÉS A KÁROSULTAK EGYETLEN OLVASÁSBAN jönnek le.

    A rivális-sávhoz a károsultak neve és képe is kell, ők pedig gyakran
    ugyanazok, akik máshol szerzők — külön kötegben olvasva ugyanazt a
    dokumentumot kétszer kérnénk le. Egy halmaz, egy `getAll`.
  */
  const ids = [
    ...new Set(
      [
        ...rows.map((row) => row.userId),
        ...rows.flatMap((row) => Object.keys(row.stolenFrom)),
      ].filter(Boolean),
    ),
  ];
  const authors = new Map<string, Author>();

  if (ids.length > 0) {
    const refs = ids.map((id) => db.collection(COLLECTIONS.users).doc(id));
    for (const snapshot of await db.getAll(...refs)) {
      if (!snapshot.exists) continue;
      const data = snapshot.data() as { username?: string; photoURL?: string | null; cellColor?: unknown };
      authors.set(snapshot.id, {
        uid: snapshot.id,
        username: data.username ?? 'ismeretlen',
        photoURL: data.photoURL ?? null,
        cellColor: cellColorOf(data),
      });
    }
  }

  /**
   * „Én kedveltem-e?" — KÖTEGELVE, nem soronként.
   *
   * A kedvelés a `likes/{uid}` aldokumentum LÉTEZÉSE. Húsz kártyánál ez húsz
   * dokumentum, de egyetlen `getAll` hívásban: soronkénti lekérdezésnél a feed
   * betöltése húsz körbefordulóval lassulna.
   */
  const likeRefs = rows.map((row) =>
    db.collection(COLLECTIONS.activities).doc(row.id).collection('likes').doc(viewerUid),
  );
  const liked = new Set<string>();
  if (likeRefs.length > 0) {
    const snapshots = await db.getAll(...likeRefs);
    snapshots.forEach((snapshot, index) => {
      if (snapshot.exists) liked.add(rows[index]!.id);
    });
  }

  /*
    A KÁRTYA RIVÁLIS-SÁVJA A TELJES RIVALITÁST MUTATJA, nem az aktivitásét.

    Geri pontosítása (2026-08-26): a sáv ugyanaz a rivális-kártya, ami a
    profilon és a `/profil/rivalisok` fülön van — a HALMOZOTT mérleg (pl.
    +189 / −295, 9× összecsapás) —, és csak EGY új adattal bővül: hány mezőt
    vett el ebben a konkrét körben.

    Ezért kell a `users/{szerző}/rivals/{károsult}` tükördokumentum. Kötegelve
    olvassuk, ugyanabban a körben, mint a neveket: soronként külön lekérdezés
    egy húszas feednél húsz körbefordulót jelentene.

    Az aktivitás fő károsultja adja, KIVEL való mérleget mutatjuk — akitől a
    legtöbbet vette el. Lopás nélkül nincs kit mutatni, ilyenkor `null`.
  */
  const topVictimOf = (stolenFrom: Record<string, number>): string | null =>
    Object.entries(stolenFrom).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const mirrorKeys = rows
    .map((row) => {
      const victim = topVictimOf(row.stolenFrom);
      return victim ? { activityId: row.id, uid: row.userId, victim } : null;
    })
    .filter((entry): entry is { activityId: string; uid: string; victim: string } => entry !== null);

  const mirrors = new Map<string, RivalRecord>();
  if (mirrorKeys.length > 0) {
    const snapshots = await db.getAll(
      ...mirrorKeys.map((entry) =>
        db.collection(COLLECTIONS.users).doc(entry.uid).collection('rivals').doc(entry.victim),
      ),
    );
    snapshots.forEach((snapshot, index) => {
      mirrors.set(mirrorKeys[index]!.activityId, toRivalRecord(snapshot.data()));
    });
  }

  const cellM2 = GAMEPLAY.CELL_AREA_M2;

  return rows.map(({ userId, center, stolenFrom, ...rest }) => {
    const ordered = Object.entries(stolenFrom).sort((a, b) => b[1] - a[1]);
    const [top, ...others] = ordered;
    const record = mirrors.get(rest.id);

    return {
      ...rest,
      center,
      likedByMe: liked.has(rest.id),
      author: authors.get(userId) ?? unknownAuthor(userId),
      rival:
        top && record
          ? {
              ...(authors.get(top[0]) ?? unknownAuthor(top[0])),
              ...record,
              exchangedM2: record.exchangedCells * cellM2,
              gainedM2: record.gainedCells * cellM2,
              lostM2: record.lostCells * cellM2,
              /** Amit EBBEN a körben vett el tőle — a sáv bal felső pirulája. */
              cellsThisActivity: top[1],
              /** A kör többi károsultja, jelvényként a fő kép sarkában. */
              others: others.map(([uid]) => authors.get(uid) ?? unknownAuthor(uid)),
            }
          : null,
    };
  });
}

/** Kedvelte-e ez a felhasználó ezt az aktivitást? */
async function hasLiked(activityId: string, uid: string): Promise<boolean> {
  const snapshot = await db
    .collection(COLLECTIONS.activities)
    .doc(activityId)
    .collection('likes')
    .doc(uid)
    .get();
  return snapshot.exists;
}

/**
 * A tárolt fotólista beolvasása.
 *
 * Védekező: a mező régi aktivitásoknál hiányzik, és sosem szabad megbízni
 * abban, hogy a szerkezete ép — egy hibás elem miatt ne dőljön el a feed.
 */
function parseStoredPhotos(raw: unknown, ownerUid: string, activityId: string): ActivityPhoto[] {
  if (!Array.isArray(raw)) return [];
  const prefix = `activities/${ownerUid}/${activityId}/`;
  return raw
    .filter((item): item is { path: string } => {
      const photo = item as { path?: unknown };
      if (typeof photo?.path !== 'string' || !photo.path.startsWith(prefix)) return false;
      return /^[A-Za-z0-9._-]+$/.test(photo.path.slice(prefix.length));
    })
    .slice(0, MAX_PHOTOS)
    .map((photo) => ({ path: photo.path }));
}

interface LegacyActivityPhoto extends ActivityPhoto {
  /**
   * Átmeneti kompatibilitási mező a már telepített natív klienseknek.
   * Rövid életű V4 Storage URL; Firestore-ba soha nem kerül vissza.
   */
  url: string;
}

const LEGACY_PHOTO_URL_TTL_MS = 15 * 60 * 1000;
const LEGACY_PHOTO_URL_REFRESH_MS = 2 * 60 * 1000;
const LEGACY_PHOTO_URL_CACHE_MAX = 1_000;
const legacyPhotoUrlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * A régi iOS/Android build `photo.url` mezőt vár, míg az új kliens a
 * hitelesített fotóvégpontot használja. A rövid életű, csak egyetlen objektum
 * olvasására jogosító URL tartja életben a régi buildet anélkül, hogy a régi
 * korlátlan Firebase download tokeneket továbbadnánk.
 */
async function legacyPhotoUrl(path: string, now = Date.now()): Promise<string> {
  const cached = legacyPhotoUrlCache.get(path);
  if (cached && cached.expiresAt - now > LEGACY_PHOTO_URL_REFRESH_MS) return cached.url;

  const expiresAt = now + LEGACY_PHOTO_URL_TTL_MS;
  const [url] = await storage.bucket(FIREBASE_STORAGE_BUCKET).file(path).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: expiresAt,
  });

  if (legacyPhotoUrlCache.size >= LEGACY_PHOTO_URL_CACHE_MAX) {
    const oldest = legacyPhotoUrlCache.keys().next().value as string | undefined;
    if (oldest) legacyPhotoUrlCache.delete(oldest);
  }
  legacyPhotoUrlCache.set(path, { url, expiresAt });
  return url;
}

async function withLegacyPhotoUrls<T extends { photos: ActivityPhoto[] }>(
  items: readonly T[],
): Promise<Array<Omit<T, 'photos'> & { photos: LegacyActivityPhoto[] }>> {
  return Promise.all(
    items.map(async ({ photos, ...item }) => ({
      ...item,
      photos: await Promise.all(
        photos.map(async (photo) => ({ ...photo, url: await legacyPhotoUrl(photo.path) })),
      ),
    })),
  );
}

/**
 * Egy aktivitás és a hozzá tartozó közösségi műveletek közös hozzáférési kapuja.
 *
 * A 404 szándékos: privát vagy tiltott aktivitásnál az azonosító létezése sem
 * publikus. Mindkét tiltási irányt az eredeti `blocks` dokumentumokból nézzük,
 * így a jogosultság nem függ a kényelmi `blockedBy` tükör naprakészségétől.
 */
async function loadReadableActivity(activityId: string, viewerUid: string) {
  const ref = db.collection(COLLECTIONS.activities).doc(activityId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');

  const data = snapshot.data() as Record<string, unknown>;
  if (data.deletedAt != null) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');

  const ownerUid = String(data.userId ?? '');
  const mine = ownerUid === viewerUid;
  if (!ownerUid) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');

  if (!mine) {
    const viewer = db.collection(COLLECTIONS.users).doc(viewerUid);
    const owner = db.collection(COLLECTIONS.users).doc(ownerUid);
    const accessDocs = await db.getAll(
      viewer.collection('blocks').doc(ownerUid),
      owner.collection('blocks').doc(viewerUid),
      viewer.collection('following').doc(ownerUid),
    );
    const blockedOwner = accessDocs[0]!;
    const blockedViewer = accessDocs[1]!;
    const followsOwner = accessDocs[2]!;
    const visibility = String(data.visibility ?? 'only_me');
    const visible =
      !blockedOwner.exists &&
      !blockedViewer.exists &&
      (visibility === 'everyone' || (visibility === 'followers' && followsOwner.exists));
    if (!visible) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
  }

  return { ref, snapshot, data, mine, ownerUid };
}

/**
 * GET /api/activities/:id — egy aktivitás részletei.
 *
 * A nyomvonal itt a LEVÁGOTT, nyilvános változat. A tulajdonos a teljes
 * nyomvonalat a `/:id/track` végpontról kapja meg, és a felület jelzi neki,
 * hogy a két vég mások elől rejtve van.
 */
activitiesRouter.get('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const readable = await loadReadableActivity(String(req.params.id), req.uid!);
    const { snapshot, mine, ownerUid: owner } = readable;
    let { data } = readable;

    // A publikus útvonalat a szerver a privát teljes nyomból javítja. Ez
    // minden nézőnél biztonságos: a teljes nyom soha nem kerül a válaszba.
    data = await repairActivityRoute(snapshot.ref, data);

    const summary = (data.summary ?? {}) as Record<string, unknown>;
    const author = await loadAuthor(owner);

    const [activity] = await withLegacyPhotoUrls([
      {
        id: snapshot.id,
        mine,
        type: data.type,
        layer: data.layer,
        title: (data.title as string | undefined) || null,
        description: (data.description as string | undefined) || null,
        photos: parseStoredPhotos(data.photos, owner, snapshot.id),
        likeCount: Number(data.likeCount ?? 0),
        commentCount: Number(data.commentCount ?? 0),
        activityCells: parseCellList(data.activityCells, MAX_ACTIVITY_CELLS),
        activityCellParents: parseCellList(data.activityCellParents, MAX_ACTIVITY_CELL_PARENTS),
        likedByMe: await hasLiked(snapshot.id, req.uid!),
        startedAt: toMillis(data.startedAt),
        endedAt: toMillis(data.endedAt),
        distanceM: Number(data.distanceM ?? 0),
        durationS: Number(data.durationS ?? 0),
        movingS: Number(data.movingS ?? 0),
        areaGainedM2: Number(data.areaGainedM2 ?? 0),
        gp: (data.gp ?? { total: 0 }) as Record<string, number>,
        cellCount: Number(data.cellCount ?? 0),
        loops: Number(summary.loops ?? 0),
        claimedCells: Number(summary.claimedCells ?? 0),
        route: String(data.route ?? ''),
        routeHidden: data.routeHidden === true,
        bounds: data.bounds ?? null,
        author,
        // Csak a saját aktivitás verdiktje látható. A diagnosztika és a
        // pontszám admin-only `activityTrust` dokumentumban marad.
        ...(mine
          ? {
              trustVerdict: data.trustVerdict ?? 'trusted',
            }
          : {}),
      },
    ]);
    res.json({ activity: activity! });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/activities/:id/photos/:fileName — láthatóságvédett aktivitásfotó.
 *
 * A kliens nem kap tartós Firebase letöltési tokent. A szerver előbb ugyanazt
 * a közösségi jogosultságot ellenőrzi, mint az aktivitás adatlapjánál, majd
 * kizárólag a dokumentumban ténylegesen hivatkozott objektumot adja vissza.
 */
activitiesRouter.get('/:id/photos/:fileName', async (req: AuthedRequest, res, next) => {
  try {
    const activityId = String(req.params.id);
    const fileName = String(req.params.fileName);
    if (!/^[A-Za-z0-9._-]+$/.test(fileName)) {
      throw notFound('photo_missing', 'Nincs ilyen kép.');
    }

    const { data, ownerUid } = await loadReadableActivity(activityId, req.uid!);
    const path = `activities/${ownerUid}/${activityId}/${fileName}`;
    if (!parseStoredPhotos(data.photos, ownerUid, activityId).some((photo) => photo.path === path)) {
      throw notFound('photo_missing', 'Nincs ilyen kép.');
    }

    const file = storage.bucket(FIREBASE_STORAGE_BUCKET).file(path);
    let contentType: string;
    let contents: Buffer;
    try {
      // A metadata-lekérés egyben a létezést is igazolja; külön `exists()`
      // minden megjelenített képnél egy felesleges Storage-kör lenne.
      const [metadata] = await file.getMetadata();
      contentType = metadata.contentType ?? '';
      if (!contentType.startsWith('image/')) {
        throw notFound('photo_missing', 'Nincs ilyen kép.');
      }
      [contents] = await file.download();
    } catch (error) {
      if (Number((error as { code?: unknown }).code) === 404) {
        throw notFound('photo_missing', 'Nincs ilyen kép.');
      }
      throw error;
    }

    res.set({
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(contents);
  } catch (error) {
    next(error);
  }
});

/** GET /api/activities/:id/track — a teljes nyomvonal, csak a tulajdonosnak. */
activitiesRouter.get('/:id/track', async (req: AuthedRequest, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.activities).doc(String(req.params.id));
    const snapshot = await ref.get();
    if (!snapshot.exists) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
    const activity = snapshot.data() as { userId?: string; deletedAt?: unknown };
    if (activity.deletedAt != null || activity.userId !== req.uid) {
      throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
    }
    const track = await ref.collection('private').doc('track').get();
    res.json({ points: track.exists ? (track.data() as { points: TracePoint[] }).points : [] });
  } catch (error) {
    next(error);
  }
});

/* ══════════════════════════════════════════════════════════════════
   Szerkesztés — cím, leírás, fotók
   ══════════════════════════════════════════════════════════════════ */

/** Ennyi fotó tartozhat egy aktivitáshoz. */
const MAX_PHOTOS = 5;
const MAX_TITLE = 80;
const MAX_DESCRIPTION = 2000;

/**
 * PATCH /api/activities/:id — a leíró mezők szerkesztése.
 *
 * CSAK a leíró mezők: cím, leírás, fotók. A metrikák, a nyomvonal, a foglalás
 * és a pont szerveroldali számítás eredménye — ha ezek a klienstől jöhetnének,
 * a játék egyetlen kéréssel hamisítható volna.
 *
 * A fotókat a kliens tölti fel közvetlenül a Storage-ba (a szabályok csak a
 * saját mappájába engedik), és csak a HIVATKOZÁST küldi ide. A több
 * megabájtos képeket értelmetlen lenne a Cloud Runon átereszteni.
 */
activitiesRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const uid = req.uid!;
    const ref = db.collection(COLLECTIONS.activities).doc(String(req.params.id));
    const snapshot = await ref.get();
    if (!snapshot.exists) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
    const stored = snapshot.data() as Record<string, unknown>;
    if (stored.deletedAt != null || stored.userId !== uid) {
      throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
    }

    const body = req.body as { title?: unknown; description?: unknown; photos?: unknown };
    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (body.title !== undefined) {
      const title = String(body.title ?? '').trim();
      if (title.length > MAX_TITLE) {
        throw badRequest('title_too_long', `A név legfeljebb ${MAX_TITLE} karakter lehet.`);
      }
      // Az ÜRES cím nem hiba, hanem visszatérés az automatikus névhez
      // („Délutáni bringázás"). Ezt a `null` fejezi ki, nem az üres sztring.
      patch.title = title.length > 0 ? title : null;
    }

    if (body.description !== undefined) {
      const description = String(body.description ?? '').trim();
      if (description.length > MAX_DESCRIPTION) {
        throw badRequest(
          'description_too_long',
          `A leírás legfeljebb ${MAX_DESCRIPTION} karakter lehet.`,
        );
      }
      patch.description = description.length > 0 ? description : null;
    }

    if (body.photos !== undefined) {
      patch.photos = parsePhotos(body.photos, uid, ref.id);
    }

    /**
     * Régi aktivitásoknál a nyilvános útvonal hiányozhat, illetve a korábbi
     * vágó a zárt hurkot tévesen teljesen elrejthette. Az első szerkesztés
     * ilyenkor migráció is: a privát teljes nyomból, a felhasználó AKTUÁLIS
     * privátzóna-beállításával állítjuk elő ugyanazt a levágott útvonalat,
     * amelyből a kliens a Mapbox statikus előnézetét rajzolja.
     *
     * A verziójel megakadályozza, hogy egy valóban, helyesen rejtett rövid
     * aktivitást minden későbbi szerkesztés újra meg újra feldolgozzunk.
     */
    const routePatch = await buildRoutePatchIfNeeded(ref, stored);
    if (routePatch) Object.assign(patch, routePatch);

    await ref.set(patch, { merge: true });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/activities/:id — tulajdonosi, 30 napos soft-delete.
 *
 * A publikus tartalom azonnal eltűnik, de a dokumentum és a privát nyomvonal
 * 30 napig megmarad egy későbbi visszaállítás/GDPR-folyamat számára. A már
 * kiosztott GP-t és a globális területállapotot nem tekerjük vissza: azokat
 * csak moderátori, auditált helyreállítás módosíthatja biztonságosan.
 */
activitiesRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const uid = req.uid!;
    const ref = db.collection(COLLECTIONS.activities).doc(String(req.params.id));
    const userRef = db.collection(COLLECTIONS.users).doc(uid);
    const now = new Date();
    const purgeAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await db.runTransaction(async (tx) => {
      const activity = await tx.get(ref);
      if (!activity.exists) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
      const data = activity.data() as Record<string, unknown>;
      if (data.userId !== uid) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
      if (data.deletedAt != null) return;

      const user = await tx.get(userRef);
      const profile = user.data() as {
        counters?: {
          activities?: number;
          distanceKm?: Partial<Record<ActivityType, number>>;
        };
      } | undefined;
      const counted = data.trustVerdict === 'trusted';
      const type = data.type as ActivityType;
      const distanceKm = Number(data.distanceM ?? 0) / 1000;

      tx.set(ref, {
        previousVisibility: data.visibility ?? 'everyone',
        visibility: 'only_me',
        deletedAt: now,
        purgeAt,
        deletedBy: 'owner',
        updatedAt: now,
      }, { merge: true });

      if (counted && user.exists && (type === 'run' || type === 'walk' || type === 'ride')) {
        tx.update(userRef, {
          'counters.activities': Math.max(0, Number(profile?.counters?.activities ?? 0) - 1),
          [`counters.distanceKm.${type}`]: Math.max(
            0,
            Number(profile?.counters?.distanceKm?.[type] ?? 0) - distanceKm,
          ),
          updatedAt: now,
        });
      }
    });

    res.json({ ok: true, purgeAt: purgeAt.getTime() });
  } catch (error) {
    next(error);
  }
});

/**
 * A fotóhivatkozások ellenőrzése.
 *
 * A LÉNYEG az útvonal-előtag vizsgálata. A kliens tetszőleges sztringet
 * küldhetne, és ha elfogadnánk, egy felhasználó BEHIVATKOZHATNÁ más
 * felhasználó fájljait a saját aktivitásába. A Storage-szabály csak az
 * ÍRÁST korlátozza a saját mappára; a hivatkozást itt kell megkötni.
 */
function parsePhotos(raw: unknown, uid: string, activityId: string) {
  if (!Array.isArray(raw)) throw badRequest('invalid_photos', 'Hibás fotólista.');
  if (raw.length > MAX_PHOTOS) {
    throw badRequest('too_many_photos', `Legfeljebb ${MAX_PHOTOS} kép tartozhat egy aktivitáshoz.`);
  }

  const prefix = `activities/${uid}/${activityId}/`;
  return raw.map((item) => {
    const photo = item as { path?: unknown };
    const path = String(photo?.path ?? '');
    const fileName = path.slice(prefix.length);

    if (!path.startsWith(prefix) || !/^[A-Za-z0-9._-]+$/.test(fileName)) {
      throw badRequest('invalid_photo_path', 'Ez a kép nem ehhez az aktivitáshoz tartozik.');
    }
    return { path };
  });
}

/* ══════════════════════════════════════════════════════════════════
   Kedvelés
   ══════════════════════════════════════════════════════════════════ */

/**
 * POST/DELETE /api/activities/:id/like
 *
 * MIÉRT A SZERVEREN, ha a `firestore.rules` a kedvelést közvetlenül is
 * engedélyezné? Mert a SZÁMLÁLÓ nem: a `likeCount` az aktivitás
 * dokumentumán van, amit a kliens nem írhat. Számláló nélkül minden kártya
 * külön lekérdezést igényelne csak azért, hogy megtudjuk, hányan kedvelték.
 *
 * Idempotens: a kétszer elküldött kedvelés nem növeli kétszer a számlálót.
 * A tranzakción belüli olvasás dönti el, van-e valódi változás.
 */
async function setLike(activityId: string, uid: string, liked: boolean) {
  const activityRef = db.collection(COLLECTIONS.activities).doc(activityId);
  const likeRef = activityRef.collection('likes').doc(uid);

  return db.runTransaction(async (tx) => {
    const activity = await tx.get(activityRef);
    const existing = await tx.get(likeRef);
    if (!activity.exists) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');

    const activityData = activity.data() as {
      likeCount?: number;
      userId?: string;
      title?: string | null;
      type?: 'run' | 'walk' | 'ride';
      startedAt?: unknown;
    };
    const count = Number(activityData.likeCount ?? 0);
    const ownerId = String(activityData.userId ?? '');
    // Az értesítés középső sora ez lesz; a saját név nyer, különben a
    // napszak + mozgásforma alakú automatikus cím — ugyanaz, amit a kártya mutat.
    const title =
      activityData.title ||
      activityTitle(activityData.type ?? 'run', toMillis(activityData.startedAt));
    if (existing.exists === liked) {
      return { likeCount: count, likedByMe: liked, ownerId, title, isNew: false };
    }

    if (liked) tx.set(likeRef, { createdAt: new Date() });
    else tx.delete(likeRef);

    const next = Math.max(0, count + (liked ? 1 : -1));
    tx.set(activityRef, { likeCount: next }, { merge: true });
    return { likeCount: next, likedByMe: liked, ownerId, title, isNew: true };
  });
}

activitiesRouter.post('/:id/like', async (req: AuthedRequest, res, next) => {
  try {
    const activityId = String(req.params.id);
    const uid = req.uid!;
    await loadReadableActivity(activityId, uid);
    const result = await setLike(activityId, uid, true);
    const { ownerId, isNew, title, ...body } = result;

    // Csak VALÓDI, új kedvelésnél értesítünk — a saját aktivitásod
    // kedvelése pedig magától értetődően nem szól neked.
    if (isNew && ownerId && ownerId !== uid) {
      const actor = await db.collection(COLLECTIONS.users).doc(uid).get();
      const username = String((actor.data() as { username?: string })?.username ?? 'Valaki');
      notifyActivityLiked(ownerId, username, activityId, title);
    }

    res.json(body);
  } catch (error) {
    next(error);
  }
});

activitiesRouter.delete('/:id/like', async (req: AuthedRequest, res, next) => {
  try {
    await loadReadableActivity(String(req.params.id), req.uid!);
    // A `title` csak az értesítéshez kellett — a válaszban nincs keresnivalója.
    const { ownerId, isNew, title, ...body } = await setLike(String(req.params.id), req.uid!, false);
    res.json(body);
  } catch (error) {
    next(error);
  }
});

/* ══════════════════════════════════════════════════════════════════
   Hozzászólások
   ══════════════════════════════════════════════════════════════════ */

const MAX_COMMENT = 1000;
const COMMENT_PAGE = 100;

/** GET /api/activities/:id/comments — időrendben, a legrégebbi elöl. */
activitiesRouter.get('/:id/comments', async (req: AuthedRequest, res, next) => {
  try {
    const { ref: activityRef } = await loadReadableActivity(String(req.params.id), req.uid!);

    /**
     * A beszélgetés a LEGRÉGEBBIVEL kezdődik, nem a legfrissebbel.
     *
     * Egy hozzászólás-szál nem hírfolyam: fordított sorrendben olvashatatlan,
     * mert a válaszok a kérdéseik előtt állnának.
     */
    const snapshot = await activityRef
      .collection('comments')
      .orderBy('createdAt', 'asc')
      .limit(COMMENT_PAGE)
      .get();

    const rows = snapshot.docs.map((doc) => {
      const comment = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        userId: String(comment.userId ?? ''),
        text: String(comment.text ?? ''),
        createdAt: toMillis(comment.createdAt),
        replyToId: (comment.replyToId as string | undefined) ?? null,
        // A megcélzott felhasználónév DENORMALIZÁLVA van a komment dokumentumon
        // (lásd a POST kezelőt) — a lista lekérdezés így nem kér külön olvasást
        // minden egyes válaszhoz.
        replyToUsername: (comment.replyToUsername as string | undefined) ?? null,
      };
    });

    const authorIds = [...new Set(rows.map((row) => row.userId).filter(Boolean))];
    const authors = new Map<string, Author>();
    if (authorIds.length > 0) {
      const refs = authorIds.map((id) => db.collection(COLLECTIONS.users).doc(id));
      for (const doc of await db.getAll(...refs)) {
        const user = doc.data() as
          | { username?: string; photoURL?: string | null; cellColor?: unknown }
          | undefined;
        authors.set(doc.id, {
          uid: doc.id,
          username: user?.username ?? 'ismeretlen',
          photoURL: user?.photoURL ?? null,
          cellColor: cellColorOf(user),
        });
      }
    }

    res.json({
      comments: rows.map(({ userId, ...rest }) => ({
        ...rest,
        mine: userId === req.uid,
        author: authors.get(userId) ?? unknownAuthor(userId),
      })),
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/activities/:id/comments */
activitiesRouter.post('/:id/comments', async (req: AuthedRequest, res, next) => {
  try {
    const text = String((req.body as { text?: unknown }).text ?? '').trim();
    if (text.length === 0) throw badRequest('empty_comment', 'Írj valamit a hozzászólásba.');
    if (text.length > MAX_COMMENT) {
      throw badRequest('comment_too_long', `A hozzászólás legfeljebb ${MAX_COMMENT} karakter.`);
    }
    const replyToId = String((req.body as { replyToId?: unknown }).replyToId ?? '') || null;

    const { ref: activityRef } = await loadReadableActivity(String(req.params.id), req.uid!);
    const commentRef = activityRef.collection('comments').doc();
    const now = new Date();

    /**
     * A VÁLASZ CÉLSZEMÉLYE denormalizálva kerül a komment dokumentumára
     * (`replyToUserId`, `replyToUsername`) — a lista lekérdezés így nem kér
     * külön olvasást minden egyes válaszhoz, és az értesítés is ebből tudja,
     * kinek szól.
     */
    let replyTo: { userId: string; username: string; commentId: string } | null = null;
    if (replyToId) {
      const target = await activityRef.collection('comments').doc(replyToId).get();
      if (target.exists) {
        const targetUserId = String((target.data() as { userId?: string }).userId ?? '');
        if (targetUserId && targetUserId !== req.uid) {
          const author = await db.collection(COLLECTIONS.users).doc(targetUserId).get();
          replyTo = {
            userId: targetUserId,
            username: String((author.data() as { username?: string })?.username ?? 'ismeretlen'),
            // Az ÚJ komment azonosítója, nem a megválaszolté: az értesítésre
            // koppintva a VÁLASZT akarjuk kiemelni, nem azt, amire válaszolt.
            commentId: commentRef.id,
          };
        }
      }
    }

    let activityOwnerId = '';
    await db.runTransaction(async (tx) => {
      const activity = await tx.get(activityRef);
      if (!activity.exists) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');

      const data = activity.data() as {
        userId?: string;
        visibility?: string;
        deletedAt?: unknown;
        allowComments?: boolean;
        commentCount?: number;
      };
      if (data.deletedAt != null) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
      // A szerző kikapcsolhatja a hozzászólásokat; ez nem hiba, hanem döntés.
      if (data.allowComments === false) {
        throw forbidden('Ehhez az aktivitáshoz nem lehet hozzászólni.');
      }
      activityOwnerId = String(data.userId ?? '');

      tx.set(commentRef, {
        userId: req.uid,
        text,
        createdAt: now,
        ...(replyTo ? { replyToId, replyToUserId: replyTo.userId, replyToUsername: replyTo.username } : {}),
      });
      tx.set(activityRef, { commentCount: Number(data.commentCount ?? 0) + 1 }, { merge: true });
    });

    /**
     * Két KÜLÖNBÖZŐ értesítés-cél, és nem esnek egybe automatikusan: az
     * aktivitás szerzője ("valaki kommentelt nálad") és a válasz címzettje
     * ("válaszoltak a hozzászólásodra") két másik ember is lehet — pl. Anna
     * aktivitásán Béla ír, Cili pedig Béla kommentjére válaszol: ekkor Anna
     * ÉS Béla is külön értesítést kap, a kommentelő (Cili) pedig egyiket sem.
     */
    void notifyCommentPosted({
      activityId: activityRef.id,
      actorId: req.uid!,
      activityOwnerId,
      replyTo,
      text,
    });

    res.status(201).json({
      id: commentRef.id,
      text,
      createdAt: now.getTime(),
      replyToId,
      replyToUsername: replyTo?.username ?? null,
    });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/activities/:id/comments/:commentId — csak a sajátodat. */
activitiesRouter.delete('/:id/comments/:commentId', async (req: AuthedRequest, res, next) => {
  try {
    const activityRef = db.collection(COLLECTIONS.activities).doc(String(req.params.id));
    const commentRef = activityRef.collection('comments').doc(String(req.params.commentId));

    await db.runTransaction(async (tx) => {
      const activity = await tx.get(activityRef);
      const comment = await tx.get(commentRef);
      if (!comment.exists) throw notFound('comment_missing', 'Nincs ilyen hozzászólás.');

      const data = activity.data() as { userId?: string; commentCount?: number } | undefined;
      const author = (comment.data() as { userId?: string }).userId;
      // A saját hozzászólásodat te törölheted, az aktivitásodon lévőt
      // szerzőként szintén — a saját posztod alatt moderálhatsz.
      if (author !== req.uid && data?.userId !== req.uid) {
        throw forbidden('Ezt a hozzászólást nem törölheted.');
      }

      tx.delete(commentRef);
      tx.set(
        activityRef,
        { commentCount: Math.max(0, Number(data?.commentCount ?? 0) - 1) },
        { merge: true },
      );
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/** POST /api/activities/:id/report — bejelentés (technikai vagy tartalmi ág). */
activitiesRouter.post('/:id/report', async (_req: AuthedRequest, res) => {
  res.status(501).json({ message: 'Még nincs implementálva.' });
});

/* ═══════════════════════════════════════════════════════════════════
   Segédek
   ═══════════════════════════════════════════════════════════════════ */

async function buildRoutePatchIfNeeded(
  ref: DocumentReference,
  data: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const uid = String(data.userId ?? '');
  if (!uid || data.deletedAt != null) return null;
  // A privacy-módosító végpont `routePending` állapotot hagy maga után, ha a
  // tömeges újravágás félbeszakad. Minden más naprakész route-nál megspóroljuk
  // a profil plusz Firestore-olvasását a feed minden kártyáján.
  if (Number(data.routeVersion ?? 0) >= PUBLIC_ROUTE_VERSION && data.routePending !== true) {
    return null;
  }
  const user = await db.collection(COLLECTIONS.users).doc(uid).get();
  const privacy = normalizePrivacy((user.data() as { privacy?: unknown } | undefined)?.privacy);
  if (!publicRouteNeedsRebuild(data, privacy)) return null;
  return buildPublicRoutePatch(ref, uid, privacy);
}

/**
 * A specifikáció szerint a tulajdonos MINDEN saját nézetben a teljes
 * nyomvonalat látja, nem csak az aktivitás adatlapján. A fő dokumentumban
 * továbbra is kizárólag a levágott route marad; ezt a teljes változatot csak
 * a hitelesített tulajdonos konkrét API-válaszába tesszük bele.
 */
async function withOwnerFullRoutes(rows: FeedRow[], viewerUid: string): Promise<FeedRow[]> {
  const owned = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.userId === viewerUid);
  if (owned.length === 0) return rows;

  const refs = owned.map(({ row }) =>
    db.collection(COLLECTIONS.activities).doc(row.id).collection('private').doc('track'),
  );
  const tracks = await db.getAll(...refs);
  const replacements = new Map<number, FeedRow>();

  tracks.forEach((snapshot, ownedIndex) => {
    const target = owned[ownedIndex];
    if (!target || !snapshot.exists) return;
    const view = buildOwnerRouteView((snapshot.data() as { points?: unknown }).points);
    if (!view) return;
    replacements.set(target.index, {
      ...target.row,
      route: view.route,
      routeHidden: view.routeHidden,
      center: {
        lat: (view.bounds.north + view.bounds.south) / 2,
        lng: (view.bounds.east + view.bounds.west) / 2,
      },
    });
  });

  return rows.map((row, index) => replacements.get(index) ?? row);
}

async function repairActivityRoute(
  ref: DocumentReference,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const patch = await buildRoutePatchIfNeeded(ref, data);
  if (!patch) return data;
  await ref.set(patch, { merge: true });
  return { ...data, ...patch };
}

async function loadAuthor(uid: string): Promise<Author> {
  if (!uid) return unknownAuthor(uid);
  const snapshot = await db.collection(COLLECTIONS.users).doc(uid).get();
  const data = snapshot.data() as
    | { username?: string; photoURL?: string | null; cellColor?: unknown }
    | undefined;
  return {
    uid,
    username: data?.username ?? 'ismeretlen',
    photoURL: data?.photoURL ?? null,
    cellColor: cellColorOf(data),
  };
}

function parsePoints(raw: unknown): TracePoint[] {
  if (!Array.isArray(raw)) throw badRequest('invalid_points', 'Hiányzó nyomvonal.');
  if (raw.length < 2) throw badRequest('invalid_points', 'A nyomvonal túl rövid.');
  if (raw.length > MAX_POINTS) throw badRequest('too_many_points', 'A nyomvonal túl hosszú.');

  const points: TracePoint[] = [];
  let previousT = -Infinity;

  for (const item of raw) {
    const p = item as Partial<TracePoint>;
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    const t = Number(p.t);

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw badRequest('invalid_points', 'Hibás koordináta a nyomvonalban.');
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw badRequest('invalid_points', 'Hibás koordináta a nyomvonalban.');
    }
    // A növekvő idő nem formaság: erre épül a hurokfelismerés és a
    // sebességszámítás. Rendezetlen nyomvonalból értelmetlen terület jönne.
    if (!Number.isFinite(t) || t < previousT) {
      throw badRequest('invalid_points', 'A nyomvonal időrendje hibás.');
    }
    previousT = t;

    points.push({
      lat,
      lng,
      t,
      ...(Number.isFinite(Number(p.accuracy)) ? { accuracy: Number(p.accuracy) } : {}),
      ...(Number.isFinite(Number(p.elevation)) ? { elevation: Number(p.elevation) } : {}),
    });
  }

  return points;
}




function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const stamp = value as { toMillis?: () => number } | undefined;
  return typeof stamp?.toMillis === 'function' ? stamp.toMillis() : 0;
}


function parseFeedDate(raw: unknown, field: string): number | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 8_640_000_000_000_000) {
    throw badRequest('invalid_date', `Hibás ${field} időbélyeg.`);
  }
  return value;
}

