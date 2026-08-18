/**
 * Az aktivitásmentés — TERV és COMMIT szétválasztva.
 *
 * MIÉRT KÜLÖN MODUL? Mert a mentés két, élesen eltérő természetű részből áll,
 * és a kettőt a Firestore-tranzakció határa választja el:
 *
 *   `planActivity()`  — tisztán GEOMETRIA és determinisztikus számítás. Nem
 *   olvas adatbázist, és ugyanarra a nyomvonalra mindig ugyanazt adja:
 *   cellalánc, hurkok, jelöltcellák, érintett blokkok. Ezért futhat a
 *   tranzakción KÍVÜL — egy retry nem változtatna rajta semmit.
 *
 *   `commitActivity()` — minden, ami az ADATBÁZIS ÁLLAPOTÁTÓL függ: a
 *   birtokviszony beolvasása, a foglalás újraszámítása belőle, a pont, az
 *   összesítők és az események kiírása. Ez a tranzakció törzse, és a Firestore
 *   újrapróbálásakor a teljes egészében újrafut — friss állapotból.
 *
 * EZ A HATÁR NEM STÍLUSKÉRDÉS. A 200 km-es körökhöz a foglalást több
 * tranzakcióra kell bontani (lásd docs/05-adatmodell.md → „Nagy foglalások"),
 * és a darabolás pontosan itt fog beékelődni: a terv marad egy darabban, a
 * commit pedig blokkcsoportonként ismétlődik. Amíg ez a két rész egyetlen
 * route-kezelőben élt, a bontás nem volt elkezdhető.
 *
 * A modul nem tud a HTTP-ről: kérést, választ és státuszkódot nem lát. A
 * bemenet ellenőrzése (`parsePoints`, azonosító-formátum, időablak) a
 * route dolga marad.
 */

import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { gridDisk } from 'h3-js';
import { COLLECTIONS, db } from './firebase';
import { badRequest, notFound } from './errors';
import { blocksFor, gameDay, ownershipFromBlocks, readBlocks, writeOwnership } from './grid';
import { buildActivityAudit } from './activityAudit';
import {
  encodePublicRoute,
  normalizePrivacy,
  publicBounds,
  PUBLIC_ROUTE_VERSION,
} from './publicRoute';
import { computeTrustScore } from '../trust/score';
import { processActivity } from '../../../src/game';
import { layerOf } from '../../../src/game/cells';
import { levelFor } from '../../../src/game/levels';
import { distanceM } from '../../../src/game/geo';
import { trimPrivateEnds, type PrivacySettings } from '../../../src/game/privacy';
import { GAMEPLAY } from '../../../src/config/gameplay';
import type { ActivityType, CellId, Layer, TracePoint } from '../../../src/types';

/**
 * A Firestore KEMÉNY korlátja: egy tranzakció legfeljebb 500 írást tartalmazhat.
 *
 * Ez NEM termékdöntés, és nem is hangolható — a platform mondja ki. Korábban
 * álltak itt saját, jóval szigorúbb korlátok is (12 000 cella, 80 blokk), de
 * azok egy hétköznapi, 8 km-nél hosszabb körfutást is elutasítottak, méghozzá
 * úgy, hogy az aktivitás EGYÁLTALÁN nem mentődött el. Ezeket kivettük: a méret
 * önmagában nem lehet ok arra, hogy valakinek elvesszen a futása.
 *
 * Ami marad, az a platform határának őszinte megjelenítése. Egy blokk két
 * írást jelent (a rács-dokumentum és a felhasználó blokk-mutatója), tehát a
 * gyakorlati plafon ~246 blokk ≈ 18 km-es kör. Efölött ma tiszta magyar
 * hibaüzenet jön, nem nyers Firestore-kivétel.
 *
 * ⚠️ EZ ÍGY NEM VÉGLEGES. A 200 km-es körökhöz (a Balaton-kör ~5 700 blokk)
 * a tranzakció darabolása vagy sorbaállítása kell — lásd docs/05-adatmodell.md
 * → „Nagy foglalások". Addig a nagyon nagy kör hibaüzenetet kap, de nem
 * mentődik el félig: a tranzakció mindent eldob.
 */
const FIRESTORE_MAX_TRANSACTION_WRITES = 500;

/**
 * Az aktivitásonként MINDIG megírt dokumentumok száma.
 *
 * Aktivitás, teljes nyomvonal, trust, audit, GP-főkönyv, napi GP, profil, és
 * a felhasználó blokk-indexe (rétegenként egy dokumentum). A károsultak ezen
 * felül jönnek, fejenként kettővel.
 */
const FIXED_ACTIVITY_WRITES = 8;

/**
 * Belefér-e ennyi blokk és károsult egyetlen tranzakcióba?
 *
 * BLOKKONKÉNT EGY ÍRÁS. Korábban kettő volt (rács-dokumentum + blokkonkénti
 * mutató a felhasználónál), és emiatt fele akkora körnél ütköztünk a
 * Firestore 500-as korlátjába. A mutató mostantól rétegenként EGYETLEN,
 * `arrayUnion`-nel bővített dokumentum — lásd `writeOwnership`.
 */
function transactionWrites(blockCount: number, victimCount: number): number {
  return FIXED_ACTIVITY_WRITES + blockCount + victimCount * 2;
}

function expandCellScope(cells: Iterable<string>, rings: number): Set<string> {
  const expanded = new Set<string>();
  for (const cell of cells) {
    for (const near of gridDisk(cell, rings)) expanded.add(near);
  }
  return expanded;
}

  export interface CommitSummary {
    distanceM: number;
    durationS: number;
    movingS: number;
    cellCount: number;
    loops: number;
    claimedCells: number;
    areaGainedM2: number;
    gp: number;
    /**
     * Hány bezárás esett ki azért, mert nagyobb volt a motor
     * `MAX_LOOP_BBOX_CELLS` plafonjánál (~143 km²).
     *
     * Ez eddig NYOMTALANUL eltűnt: a `detectLoopsDetailed` elkapja a
     * `LoopTooLargeError`-t és kihagyja a hurkot, tehát a felhasználó nulla
     * területet kapott mindenféle magyarázat nélkül. Amíg a felület nem
     * mondja meg neki, legalább mérhető legyen, hogy élesben előfordul-e.
     */
    oversizedLoops: number;
    trustVerdict: 'trusted' | 'pending_review' | 'rejected';
  };


/** Amit a route ellenőrzött és átad. */
export interface ActivityInput {
  activityId: string;
  uid: string;
  type: ActivityType;
  points: TracePoint[];
  startedAt: number;
  endedAt: number;
  movingMs: number;
}

/**
 * A determinisztikus előszámítás eredménye.
 *
 * Minden mezője kizárólag a nyomvonalból következik — adatbázistól független,
 * tehát a tranzakció újrapróbálásakor sem változik. A `now` és a `today`
 * SZÁNDÉKOSAN itt dől el: így egy retry ugyanazt az időbélyeget írja, és a
 * dokumentumok tartalma próbálkozásonként azonos marad.
 */
export interface ActivityPlan extends ActivityInput {
  layer: Layer;
  distanceM: number;
  candidateCells: CellId[];
  orphanScope: Set<CellId>;
  blockIds: string[];
  now: Date;
  today: number;
}

export interface CommitOutcome {
  duplicate: boolean;
  summary: CommitSummary | unknown;
}


/**
 * A tranzakción KÍVÜL elvégezhető rész.
 *
 * Dob, ha az aktivitás túl rövid, vagy ha a foglalás már a károsultak nélkül
 * sem férne bele egyetlen tranzakcióba — akkor felesleges elindítani.
 */
export function planActivity(input: ActivityInput): ActivityPlan {
  const { uid, type, points } = input;

  /* ── Újraszámolás a nyers nyomvonalból ─────────────────────── */

  const serverDistanceM = totalDistance(points);
  if (serverDistanceM < GAMEPLAY.MIN_DISTANCE_M) {
    throw badRequest(
      'too_short',
      `Legalább ${GAMEPLAY.MIN_DISTANCE_M} méter kell ahhoz, hogy az aktivitás számítson.`,
    );
  }

  const layer = layerOf(type);
  const probe = processActivity({
    points,
    type,
    distanceKm: serverDistanceM / 1000,
    actorId: uid,
    ownership: new Map(),
    streakDays: 0,
    gpEarnedToday: 0,
  });

  // Nem csak a nyomvonalat olvassuk: a hurok teljes belseje is ownership-
  // függő. Ez a halmaz kizárólag geometria, ezért tranzakción kívül maradhat.
  const candidateCells = [...probe.claimedCells];
  // Egy potenciális egycellás maradvány teljes szomszédságának ismeretéhez
  // két H3-gyűrű kell a geometriai claim körül. Ugyanezek a blokkok kerülnek
  // a tranzakcióba, ezért konkurens mentésnél a Firestore friss állapottal
  // próbálja újra az árva mező szabályát is.
  const orphanScope = expandCellScope(candidateCells, 2);
  const blockIds = [...blocksFor(layer, orphanScope).keys()];
  /**
   * A blokkszám a tranzakció méretének DÖNTŐ tényezője, és már itt ismert —
   * a károsultak még nem. Ezért itt károsultak nélkül számolunk: ha már így
   * sem fér bele, felesleges elindítani a tranzakciót. A pontos, károsultakat
   * is tartalmazó ellenőrzés a tranzakción belül van.
   */
  if (transactionWrites(blockIds.length, 0) > FIRESTORE_MAX_TRANSACTION_WRITES) {
    throw badRequest(
      'activity_too_large',
      'Ez a kör akkora területet zár be, amit egyetlen mentésben még nem tudunk elszámolni. Az aktivitás adatai megvannak — szólj nekünk, és feldolgozzuk.',
    );
  }

  const now = new Date();
  const today = gameDay(now);

  return {
    ...input,
    layer,
    distanceM: serverDistanceM,
    candidateCells,
    orphanScope,
    blockIds,
    now,
    today,
  };
}


/**
 * A tranzakció törzse.
 *
 * ⚠️ EZ A FÜGGVÉNY TÖBBSZÖR IS LEFUTHAT ugyanarra a mentésre: a Firestore
 * ütközéskor automatikusan újrapróbálja. Ezért nem tartalmazhat mellékhatást
 * a tranzakción kívül (hálózati hívás, értesítésküldés), és minden általa írt
 * dokumentum azonosítója determinisztikus.
 */
export async function commitActivity(
  tx: Transaction,
  plan: ActivityPlan,
): Promise<CommitOutcome> {
  const { activityId, uid, type, layer, points, startedAt, endedAt, movingMs } = plan;
  const { orphanScope, blockIds, now, today } = plan;
  const serverDistanceM = plan.distanceM;

  const activityRef = db.collection(COLLECTIONS.activities).doc(activityId);
  const userRef = db.collection(COLLECTIONS.users).doc(uid);
  const dailyGpRef = db.collection(COLLECTIONS.dailyGp).doc(`${uid}_${today}`);
  const ledgerRef = db.collection(COLLECTIONS.gpLedger).doc(`activity_${activityId}`);
  const trustRef = db.collection(COLLECTIONS.activityTrust).doc(activityId);
  const auditRef = db.collection(COLLECTIONS.activityAudits).doc(activityId);

  // Az idempotencia dokumentuma minden más olvasás előtt jön.
  const existing = await tx.get(activityRef);
  if (existing.exists) {
    const data = existing.data() as { userId?: string; summary?: unknown };
    if (data.userId !== uid) {
      throw badRequest('activity_conflict', 'Ez az azonosító már foglalt.');
    }
    return { duplicate: true, summary: sanitizePublicSummary(data.summary) };
  }

  // Minden Firestore-olvasás megelőzi az első írást. Retry esetén ezek a
  // snapshotok frissek lesznek, és a motor új eredményt számol belőlük.
  const userNow = await tx.get(userRef);
  if (!userNow.exists) throw notFound('profile_missing', 'Még nincs GRUNDO-profilod.');
  const dailyGpNow = await tx.get(dailyGpRef);
  const blocks = await readBlocks(tx, blockIds);

  const user = userNow.data() as {
    gpTotal?: number;
    streak?: StoredStreak;
    trust?: { cleanActivities?: number; upheldReports?: number };
    privacy?: Partial<PrivacySettings>;
  };
  const earnedToday = Number((dailyGpNow.data() as { total?: number } | undefined)?.total ?? 0);
  const ownership = ownershipFromBlocks(layer, orphanScope, blocks, today);
  const result = processActivity({
    points,
    type,
    distanceKm: serverDistanceM / 1000,
    actorId: uid,
    ownership,
    streakDays: user.streak?.current ?? 0,
    gpEarnedToday: earnedToday,
    orphanScope,
  });

  const trust = computeTrustScore({
    points,
    type,
    distanceKm: serverDistanceM / 1000,
    durationS: Math.max(1, (endedAt - startedAt) / 1000),
    history: {
      cleanActivities: user.trust?.cleanActivities ?? 0,
      upheldReports: user.trust?.upheldReports ?? 0,
    },
    credibleReports: 0,
    largeGaps: result.diagnostics.largeGaps,
  });
  const appliedToGameplay = GAMEPLAY.TRUST_OBSERVE_ONLY || trust.verdict === 'trusted';
  const publicTrustVerdict = appliedToGameplay ? 'trusted' : trust.verdict;
  // A maximális, 5→5 állapot audit- és pontozási esemény marad, de nem
  // írjuk vissza változatlanul a gridbe. Ez jelentősen csökkenti az
  // ismételt körök Firestore-írásait anélkül, hogy a GP megváltozna.
  const claimUpdates = new Map(
    [...(result.claim?.updates ?? new Map())].filter(([cell, next]) => {
      const previous = ownership.get(cell);
      return previous?.owner !== next.owner || previous?.defense !== next.defense;
    }),
  );
  const victims = Object.entries(result.claim?.stolenFrom ?? {}).filter(([, count]) => count > 0);

  /**
   * A pontos méretellenőrzés — most már a károsultakkal együtt.
   *
   * Felfelé konzervatív: a `blockIds` az orphan-scope minden blokkját
   * tartalmazza, a `writeOwnership` viszont csak a ténylegesen változó
   * cellák blokkjait írja. Inkább utasítsunk el egy határesetet, mint hogy
   * a Firestore szakítsa félbe a commitot.
   *
   * Ha ez eldobódik, a tranzakció MINDEN írása eldobódik vele — részleges
   * mentés nem keletkezhet.
   */
  if (
    transactionWrites(blockIds.length, victims.length) > FIRESTORE_MAX_TRANSACTION_WRITES
  ) {
    throw badRequest(
      'activity_too_large',
      'Ez a kör egyszerre túl sok játékos területét érinti ahhoz, hogy egy mentésben elszámoljuk. Szólj nekünk, és feldolgozzuk.',
    );
  }

  const victimRefs = victims.map(([victimId]) => db.collection(COLLECTIONS.users).doc(victimId));
  const victimSnaps = victimRefs.length > 0 ? await tx.getAll(...victimRefs) : [];

  const privacy = normalizePrivacy(user.privacy);
  const publicPoints = trimPrivateEnds(points, privacy).points;
  const publicRoute = encodePublicRoute(publicPoints);
  const summary: CommitSummary = {
    distanceM: Math.round(serverDistanceM),
    durationS: Math.round((endedAt - startedAt) / 1000),
    movingS: Math.round(movingMs / 1000),
    cellCount: result.cellPath.length,
    loops: result.loops.length,
    claimedCells: result.claimedCells.size,
    areaGainedM2: result.areaGainedM2,
    gp: result.gp.total,
    oversizedLoops: result.diagnostics.loops.rejected.filter(
      (loop) => loop.reason === 'too_large',
    ).length,
    trustVerdict: publicTrustVerdict,
  };

  if (appliedToGameplay && claimUpdates.size > 0) {
    writeOwnership(tx, layer, claimUpdates, blocks, now, uid);
  }

  tx.set(activityRef, {
    userId: uid,
    type,
    layer,
    startedAt: new Date(startedAt),
    endedAt: new Date(endedAt),
    distanceM: summary.distanceM,
    durationS: summary.durationS,
    movingS: summary.movingS,
    areaGainedM2: result.areaGainedM2,
    gp: result.gp,
    cellCount: result.cellPath.length,
    pointCount: points.length,
    summary,
    bounds: publicBounds(publicPoints),
    route: publicRoute,
    routeHidden: publicRoute.length === 0,
    routeVersion: PUBLIC_ROUTE_VERSION,
    routePrivacyRevision: privacy.routeRevision,
    routePending: false,
    visibility: 'everyone',
    title: null,
    description: null,
    photos: [],
    likeCount: 0,
    commentCount: 0,
    allowComments: true,
    // A publikus dokumentumba kizárólag a verdikt kerülhet.
    trustVerdict: publicTrustVerdict,
    createdAt: now,
    updatedAt: now,
  });

  tx.set(activityRef.collection('private').doc('track'), {
    points,
    bounds: boundsOf(points),
    createdAt: now,
  });
  tx.set(trustRef, {
    activityId,
    userId: uid,
    score: trust.score,
    signals: trust.signals,
    reasons: trust.reasons,
    measuredVerdict: trust.verdict,
    appliedGameplayDecision: appliedToGameplay ? 'applied' : 'withheld',
    observeOnly: GAMEPLAY.TRUST_OBSERVE_ONLY,
    createdAt: now,
  });
  tx.set(auditRef, {
    activityId,
    userId: uid,
    type,
    layer,
    startedAt: new Date(startedAt),
    createdAt: now,
    ...buildActivityAudit(result, ownership, uid, points.length, appliedToGameplay),
  });

  // Nem hiteles aktivitás látható marad, de nem ír gridet, GP-t vagy
  // profilösszesítőt. Observe-only módban az appliedToGameplay továbbra is igaz.
  if (!appliedToGameplay) return { duplicate: false, summary };

  tx.set(ledgerRef, {
    userId: uid,
    activityId,
    source: 'activity',
    gp: result.gp,
    amount: result.gp.total,
    at: now,
    day: today,
  });
  tx.set(dailyGpRef, {
    userId: uid,
    day: today,
    total: earnedToday + result.gp.total,
    updatedAt: now,
  });

  const gainedCells = (result.claim?.counts.free ?? 0) + (result.claim?.counts.stolen ?? 0);
  const gainedAreaM2 = gainedCells * GAMEPLAY.CELL_AREA_M2;
  const gpAfter = Number(user.gpTotal ?? 0) + result.gp.total;
  tx.set(
    userRef,
    {
      gpTotal: gpAfter,
      gpWeek: FieldValue.increment(result.gp.total),
      gpMonth: FieldValue.increment(result.gp.total),
      level: levelFor(gpAfter),
      territoryM2: { [layer]: FieldValue.increment(gainedAreaM2) },
      cellCount: { [layer]: FieldValue.increment(gainedCells) },
      counters: {
        activities: FieldValue.increment(1),
        distanceKm: { [type]: FieldValue.increment(serverDistanceM / 1000) },
      },
      streak: advanceStreak(user.streak, today),
      trust: {
        cleanActivities: FieldValue.increment(trust.verdict === 'trusted' ? 1 : 0),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  for (let index = 0; index < victims.length; index += 1) {
    const [victimId, stolenCells] = victims[index]!;
    const victimSnap = victimSnaps[index];
    if (!victimSnap?.exists) continue;
    const victim = victimSnap.data() as {
      territoryM2?: Partial<Record<'foot' | 'bike', number>>;
      cellCount?: Partial<Record<'foot' | 'bike', number>>;
    };
    const stolenAreaM2 = stolenCells * GAMEPLAY.CELL_AREA_M2;
    tx.set(
      victimRefs[index]!,
      {
        territoryM2: {
          [layer]: Math.max(0, Number(victim.territoryM2?.[layer] ?? 0) - stolenAreaM2),
        },
        cellCount: {
          [layer]: Math.max(0, Number(victim.cellCount?.[layer] ?? 0) - stolenCells),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(db.collection(COLLECTIONS.territoryEvents).doc(`${activityId}_${victimId}`), {
      type: 'territory_stolen',
      activityId,
      actorId: uid,
      recipientId: victimId,
      layer,
      cellCount: stolenCells,
      areaM2: stolenAreaM2,
      status: 'pending',
      read: false,
      createdAt: now,
    });
  }

  return { duplicate: false, summary };
}


/* ══ Segédek ══════════════════════════════════════════════ */

function totalDistance(points: readonly TracePoint[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    sum += distanceM(points[i - 1]!, points[i]!);
  }
  return sum;
}

interface StoredStreak {
  current?: number;
  longest?: number;
  /** A legutóbbi aktív nap, játéknap-számként. */
  lastActiveDay?: number;
}

/**
 * A sorozat léptetése.
 *
 * Három eset van, és a különbség lényegi:
 *   - ma már volt aktivitás  → a sorozat NEM nő. Aki naponta ötször fut, az
 *     nem ötnapos sorozatot épít.
 *   - tegnap volt az utolsó  → +1, ez a folytatás.
 *   - régebben (vagy soha)   → újrakezdés 1-gyel.
 *
 * A `longest` sosem csökken: az elért csúcs megmarad akkor is, ha a sorozat
 * megszakad — ez a felhasználó teljesítménye, nem az aktuális állapota.
 */
function advanceStreak(streak: StoredStreak | undefined, today: number) {
  const current = streak?.current ?? 0;
  const last = streak?.lastActiveDay;

  const next = last === today ? Math.max(1, current) : last === today - 1 ? current + 1 : 1;

  return {
    current: next,
    longest: Math.max(next, streak?.longest ?? 0),
    lastActiveDay: today,
  };
}

function boundsOf(points: readonly TracePoint[]) {
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const p of points) {
    if (p.lat > north) north = p.lat;
    if (p.lat < south) south = p.lat;
    if (p.lng > east) east = p.lng;
    if (p.lng < west) west = p.lng;
  }
  return { north, south, east, west };
}

/** Régi dokumentum duplikált válasza sem szivárogtathat trust diagnosztikát. */
export function sanitizePublicSummary(summary: unknown): unknown {
  if (summary === null || typeof summary !== 'object' || Array.isArray(summary)) return summary;
  const clean = { ...(summary as Record<string, unknown>) };
  delete clean.trustScore;
  delete clean.trustReasons;
  return clean;
}
