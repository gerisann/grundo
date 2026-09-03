/**
 * NAGY foglalás mentése — több tranzakcióban.
 *
 * MIÉRT KELL? Egy Firestore-tranzakció legfeljebb 500 írást tartalmazhat. Ez
 * platformkorlát, nem a mi döntésünk. Blokkonként egy írással ez ~26 km
 * kerületű körig elég; a Balaton-kör (~200 km, ~5 700 blokk) hússzoros
 * túllépés. Márpedig a méret önmagában nem lehet ok arra, hogy valakinek
 * elvesszen a köre.
 *
 * MIÉRT MŰKÖDIK A DARABOLÁS? Mert a birtoklási döntés CELLÁNKÉNTI és blokkok
 * között FÜGGETLEN: a `resolveClaim` minden mezőt kizárólag a saját aktuális
 * tulajdonviszonyából ítél meg (szabad → viszed; sajátod → +1 védelem;
 * rivális ≤1 → elveszed; rivális >1 → gyengíted). Egy csoport tranzakciója
 * tehát önmagában is helyes, ha a saját blokkjait frissen beolvassa.
 *
 * Ami NEM független, azt külön kezeljük:
 *   - a GP az összesített darabszámokból jön → a záró fázisban számoljuk;
 *   - az árva mező szabályához kétgyűrűs környezet kell → a csoport az
 *     olvasásban túlnyúlik a saját blokkjain, írni viszont csak a sajátjait
 *     írja.
 *
 * HÁROM FÁZIS:
 *   1. FOGLALÁS      — az aktivitás, a nyomvonal, a trust és az audit. Fix
 *                      méretű, mindig belefér. `claimStatus: 'pending'`.
 *   2. CSOPORTOK     — blokkcsoportonként egy tranzakció. Minden csoport a
 *                      saját eredményét determinisztikus azonosítójú
 *                      részdokumentumba írja, ezért újrafuttatható.
 *   3. KÖNYVZÁRÁS    — a részek összegzése, GP, profil, károsultak,
 *                      események. `claimStatus: 'done'`.
 *
 * NINCS SOR (Cloud Tasks). Egy 200 km-es kör ~15 tranzakció, egyenként pár
 * száz ezredmásodperc — néhány másodperc az egész, a Cloud Run kérés-
 * időkorlátja alatt nagyságrenddel. A sort akkor vezetjük be, ha a kérések
 * tényleg időtúllépésbe futnak; addig fölösleges infrastruktúra.
 *
 * ⚠️ AZ ÁR: az atomicitás egy része. A nagy foglalás nem egy pillanat alatt
 * jelenik meg, hanem néhány másodperc alatt terül szét, és eközben egy
 * konkurens játékos félig alkalmazott állapotot láthat. A „cellánként az
 * első sikeres commit nyer" szabály viszont NEM sérül: minden mezőnek
 * továbbra is pontosan egy döntő commitja van.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { gridDisk } from 'h3-js';
import { COLLECTIONS, db } from './firebase';
import { badRequest, notFound } from './errors';
import {
  blockIdFor,
  blocksFor,
  gameDay,
  localDay,
  ownershipFromBlocks,
  readBlocks,
  writeBlocks,
  writeOwnership,
} from './grid';
import { resolveCompactGroup } from './compactGroupClaim';
import type { CompactBlockWork } from './compactBlockClaim';
import {
  materializeCompactFrontierSeeds,
  planCompactFrontier,
  resolveCompactFrontier,
} from './compactFrontier';
import {
  advanceStreak,
  boundsOf,
  FIRESTORE_MAX_TRANSACTION_WRITES,
  sanitizePublicSummary,
  topVictims,
  type ActivityPlan,
  type CommitOutcome,
  type CommitSummary,
  type StoredStreak,
} from './activityCommit';
import {
  encodePublicRoute,
  normalizePrivacy,
  publicBounds,
  PUBLIC_ROUTE_VERSION,
} from './publicRoute';
import { computeTrustScore } from '../trust/score';
import { buildChunkedActivityAudit } from './activityAudit';
import { loopCells, mergeClaims, resolveClaim } from '../../../src/game';
import { computeActivityGp } from '../../../src/game/scoring';
import { levelFor } from '../../../src/game/levels';
import { trimPrivateEnds, type PrivacySettings } from '../../../src/game/privacy';
import { GAMEPLAY } from '../../../src/config/gameplay';
import type {
  CellFate,
  CellId,
  CellOwnership,
  ClaimResult,
  OwnershipMap,
} from '../../../src/types';

/**
 * Hány blokk kerüljön egy csoportba?
 *
 * Csoportonként blokkonként egy írás, plusz a blokk-index és a részeredmény —
 * a Firestore 500-as ÍRÁSSZÁM-korlátja alatt ez bőven elfér.
 *
 * ⚠️ AZ ÍRÁSSZÁM NEM AZ EGYETLEN KORLÁT — ez éles adatvesztést okozott
 * (2026-09-02, `ebb3c240…`, 143 km-es bringakör). A csoport 400 blokkal
 * `INVALID_ARGUMENT: Transaction too big` hibával elhasalt, pedig a nyers
 * payload MÉRVE csak 1,48 MB volt, a 10 MiB-os határ töredéke. A tranzakció
 * méretébe az INDEXBEJEGYZÉSEK is beleszámítanak: egy kibontott blokk `cells`
 * mezője 343 cella × 3 mező, mindegyikre két index — blokkonként ~2 000
 * bejegyzés, a csoport 79 vegyes blokkjával együtt ~160 000.
 *
 * KÉT VÉDELEM VAN, ez az egyik (előre, olcsón). A másik a `withSplitOnOverflow`:
 * ha a csoport MÉGIS túl nagy, felezve újrapróbálja. A kettő szándékosan
 * redundáns — a mentés elvesztése rosszabb, mint néhány extra tranzakció.
 */
const BLOCKS_PER_GROUP = 200;

/**
 * Ennél több csoportot nem indítunk el egyetlen kérésben.
 *
 * Nem a Firestore korlátja, hanem a kérés futásidejéé: 80 csoport ~16 000
 * blokk (≈1 680 km²), amire a Cloud Run időkorlátja is szűk lehet. Efölött
 * tiszta hibaüzenet jön — és ott lesz a helye a valódi sorbaállításnak.
 *
 * ⚠️ A 40-ről azért nőtt 80-ra, mert a `BLOCKS_PER_GROUP` felére csökkent: a
 * kettő SZORZATA a lefedett terület, és azt nem akartuk szűkíteni. A felezés
 * (`withSplitOnOverflow`) ezen felül keletkező al-csoportjai nem számítanak
 * bele — azok ugyanannak a csoportnak a részei.
 */
const MAX_GROUPS = 80;

/**
 * Ennyi frontier-seedet őrzünk meg csoportonként.
 *
 * A seedek a `claimParts/group-N` dokumentumba kerülnek, hogy a frontier fázis
 * újrafuttatható legyen — a Firestore dokumentumhatára viszont 1 MB. Egy
 * res12 cellaazonosító ~16 karakter, tehát 20 000 seed ≈ 400 kB: bőven a
 * korlát alatt, és nagyságrendekkel a valós határsáv fölött.
 *
 * ⚠️ Ha egy csoport ennél többet termel, a MARADÉK ELVÉSZ a cleanup számára —
 * de a birtokviszony, a terület és a GP attól még pontos marad, mert azokat a
 * `part` számai hordozzák. A cleanup topológiai kozmetika: a részleges
 * elvégzése rosszabb a teljesnél, de nem hibás állapot. A `seedsTruncated`
 * jelzi, ha ez megtörtént.
 */
const MAX_STOLEN_SEEDS_PER_GROUP = 20_000;

/**
 * A frontier-korrekció legfeljebb ennyi blokkot ír egyetlen tranzakcióban.
 *
 * A cleanup a lopott terület KERÜLETE mentén dolgozik, ami a területnek csak a
 * gyöke — egy 81 000 cellás foglalásnál néhány tucat blokk. A korlát a szórt,
 * sokfelé harapó lopás szélső esetét fogja meg, hogy a tranzakció ne szakadjon
 * félbe a Firestore 500-as határán.
 */
const MAX_FRONTIER_BLOCKS = 400;

/**
 * A frontier-korrekció részdokumentumának azonosítója.
 *
 * SZÁNDÉKOSAN nem `group-N` alakú: a seedgyűjtés a csoportrészeken megy végig,
 * és ki kell tudnia hagyni a saját eredményét — különben egy újrafuttatás a
 * korábbi korrekciót seedként értelmezné.
 */
const FRONTIER_PART_ID = 'frontier';

/** Egy csoport eredménye — ebből áll össze a végén a GP és az összesítő. */
interface ClaimPart {
  counts: Record<CellFate, number>;
  stolenFrom: Record<string, number>;
  breakthroughFrom: Record<string, number>;
  weightedClaimM2: number;
  gainedM2: number;
  cells: number;
}

export async function commitChunkedActivity(plan: ActivityPlan): Promise<CommitOutcome> {
  const { activityId, uid, type, layer, points, startedAt, endedAt, movingMs } = plan;
  const { orphanScope, blockIds, now, today, loops } = plan;

  const groups = chunk(blockIds, BLOCKS_PER_GROUP);
  if (groups.length > MAX_GROUPS) {
    throw badRequest(
      'activity_too_large',
      'Ez a kör akkora területet zár be, amit még nem tudunk egy menetben elszámolni. Az aktivitás adatai megvannak — szólj nekünk, és feldolgozzuk.',
    );
  }

  const activityRef = db.collection(COLLECTIONS.activities).doc(activityId);
  const userRef = db.collection(COLLECTIONS.users).doc(uid);
  const partsRef = activityRef.collection('claimParts');

  /**
   * A COMPACT ÚT — a hurok belseje parentekben, nem res12 cellákban.
   *
   * A `plan.compactWorks` a tervezéskor készül el, és res9 blokkonként mondja
   * meg, mit kell tenni. Ha megvan, a csoportok NEM a cellalistából dolgoznak:
   * a belső több tízezer cella soha nem materializálódik.
   */
  const works = plan.compactWorks;

  /**
   * Cella → blokk, EGYSZER kiszámolva.
   *
   * Csoportonként el kell dönteni minden hurokcelláról, hogy ehhez a
   * csoporthoz tartozik-e. Ha ezt cellánként külön `blocksFor` hívással
   * kérdeznénk meg, az hurkonként és csoportonként újra lefutna — pont a nagy
   * aktivitásnál, amiért ez a kód egyáltalán létezik. Így egyetlen bejárás.
   *
   * A compact úton nincs rá szükség: ott a blokkonkénti munkát a `works` adja,
   * és az `orphanScope` bejárása puszta pazarlás lenne.
   */
  const blockOfCell = new Map<CellId, string>();
  if (!works) {
    for (const [blockId, cells] of blocksFor(layer, orphanScope)) {
      for (const cell of cells) blockOfCell.set(cell, blockId);
    }
  }

  /* ── 1. FOGLALÁS ────────────────────────────────────────────────── */

  const opening = await db.runTransaction(async (tx) => {
    const existing = await tx.get(activityRef);
    if (existing.exists) {
      const data = existing.data() as {
        userId?: string;
        summary?: unknown;
        claimStatus?: unknown;
        trustVerdict?: unknown;
      };
      if (data.userId !== uid) {
        throw badRequest('activity_conflict', 'Ez az azonosító már foglalt.');
      }

      /**
       * FÉLBEMARADT MENTÉS = FOLYTATÁS, NEM DUPLIKÁTUM.
       *
       * ⚠️ EZ ÉLES ADATVESZTÉST OKOZOTT (2026-09-02, `ebb3c240…`). A darabolt
       * úton az aktivitás dokumentuma már az 1. fázisban létrejön, a `summary`
       * viszont csak a könyvzáráskor. Ha a csoportok között bármi elhasal, a
       * dokumentum ott marad `claimStatus: 'pending'` állapotban — és a
       * korábbi kód az ÚJRAKÜLDÉST duplikátumnak hitte, mert csak a dokumentum
       * LÉTEZÉSÉT nézte. Az eredmény: 0 GP, 0 terület, örökre, és a válaszban
       * egy `summary: undefined`, amitől a kliens eredményképernyője elszállt.
       *
       * A folytatás azért biztonságos, mert a csoportok determinisztikus
       * azonosítójú részdokumentumba könyvelnek (`claimParts/group-N`): a már
       * kész csoport `done.exists` ágon kilép, a hiányzó pedig lefut. Pontosan
       * erre a szerződésre épült a darabolt út — eddig csak sosem jutott el
       * idáig a vezérlés.
       */
      if (data.claimStatus === 'pending') {
        const trustSnapshot = await tx.get(
          db.collection(COLLECTIONS.activityTrust).doc(activityId),
        );
        const decision = (
          trustSnapshot.data() as { appliedGameplayDecision?: unknown } | undefined
        )?.appliedGameplayDecision;
        return {
          duplicate: false as const,
          // A trust döntés a MENTÉS PILLANATÁBAN született; a folytatás nem
          // értékeli újra. Hiányzó dokumentumnál a megengedő ág a helyes: a
          // korábbi verdikt `trusted` volt, különben nem indult volna claim.
          appliedToGameplay: decision !== 'withheld',
          publicTrustVerdict: storedVerdict(data.trustVerdict),
        };
      }

      return { duplicate: true as const, summary: sanitizePublicSummary(data.summary) };
    }

    const userNow = await tx.get(userRef);
    if (!userNow.exists) throw notFound('profile_missing', 'Még nincs GRUNDO-profilod.');
    const user = userNow.data() as {
      trust?: { cleanActivities?: number; upheldReports?: number };
      privacy?: Partial<PrivacySettings>;
    };

    const trust = computeTrustScore({
      points,
      type,
      distanceKm: plan.distanceM / 1000,
      durationS: Math.max(1, (endedAt - startedAt) / 1000),
      history: {
        cleanActivities: user.trust?.cleanActivities ?? 0,
        upheldReports: user.trust?.upheldReports ?? 0,
      },
      credibleReports: 0,
      largeGaps: 0,
    });
    const appliedToGameplay = GAMEPLAY.TRUST_OBSERVE_ONLY || trust.verdict === 'trusted';
    const publicTrustVerdict = appliedToGameplay ? 'trusted' : trust.verdict;

    const privacy = normalizePrivacy(user.privacy);
    const publicPoints = trimPrivateEnds(points, privacy).points;
    const publicRoute = encodePublicRoute(publicPoints);

    /**
     * Az aktivitás AZONNAL létrejön, még a foglalás elszámolása előtt.
     *
     * Így a felhasználó rögtön látja, hogy a mozgása megvan — a terület
     * pedig a következő másodpercekben terül szét. A `claimStatus` mondja
     * meg, hol tart.
     */
    tx.set(activityRef, {
      userId: uid,
      type,
      layer,
      startedAt: new Date(startedAt),
      endedAt: new Date(endedAt),
      distanceM: Math.round(plan.distanceM),
      durationS: Math.round((endedAt - startedAt) / 1000),
      movingS: Math.round(movingMs / 1000),
      areaGainedM2: 0,
      gp: { total: 0 },
      cellCount: 0,
      // A feed és az aktivitás részletezője ebből rajzolja ki a KÖR teljes
      // elfoglalt területét. Korábban csak a GPS-nyom cellái jutottak el a
      // klienshez, ezért a hurok belseje üresen maradt.
      activityCells: plan.candidateCells,
      // A compact hurok belseje tomoren — enelkul a nagy hurkok kozepe
      // uresen marad a kliens terkepen (lasd ActivityPlan.candidateCellParents).
      activityCellParents: plan.candidateCellParents,
      pointCount: points.length,
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
      trustVerdict: publicTrustVerdict,
      claimStatus: 'pending',
      claimGroups: groups.length,
      // Kezdőállapot, hogy a felület ne „ismeretlen"-t mutasson egy pillanatra.
      claimProgress: { done: 0, total: groups.length },
      createdAt: now,
      updatedAt: now,
    });

    tx.set(activityRef.collection('private').doc('track'), {
      points,
      bounds: boundsOf(points),
      createdAt: now,
    });
    tx.set(db.collection(COLLECTIONS.activityTrust).doc(activityId), {
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

    return { duplicate: false as const, appliedToGameplay, publicTrustVerdict };
  });

  if (opening.duplicate) return { duplicate: true, summary: opening.summary };

  /* ── 2. CSOPORTOK ───────────────────────────────────────────────── */

  if (opening.appliedToGameplay) {
    for (let index = 0; index < groups.length; index += 1) {
      const progressDone = index + 1;
      await withSplitOnOverflow(groups[index]!, `group-${index}`, (blocks, partId) =>
        works
          ? applyCompactGroup(works, blocks, partId, progressDone, partsRef)
          : applyGroup(plan, blocks, partId, progressDone, partsRef),
      );
    }

    /* ── 2.5 FRONTIER — csak a compact úton, és csak lopás után ────── */

    if (works) await applyCompactFrontier(works, partsRef);
  }

  /* ── 3. KÖNYVZÁRÁS ──────────────────────────────────────────────── */

  return closeBooks(plan, opening.appliedToGameplay, opening.publicTrustVerdict, groups.length);

  /* ── belső: egy csoport alkalmazása ─────────────────────────────── */

  async function applyGroup(
    activityPlan: ActivityPlan,
    groupBlocks: string[],
    partId: string,
    progressDone: number,
    parts: FirebaseFirestore.CollectionReference,
  ): Promise<void> {
    const partRef = parts.doc(partId);

    await db.runTransaction(async (tx) => {
      // Determinisztikus azonosító → egy csoport kétszer nem könyvelhet.
      const done = await tx.get(partRef);
      if (done.exists) return;

      /**
       * OLVASUNK TÖBBET, MINT AMENNYIT ÍRUNK.
       *
       * A csoport a saját blokkjait írja, de a kétgyűrűs környezetet is
       * beolvassa — az árva mező szabályához a szomszédok állapota kell.
       * Az olvasásra nincs 500-as korlát, csak az írásra.
       */
      const ownBlocks = new Set(groupBlocks);
      const blocks = await readBlocks(tx, groupBlocks);
      const ownership = ownershipFromBlocks(layer, orphanScope, blocks, today);

      /**
       * A HUROKGEOMETRIA KÉSZ — csak a birtoklási döntést ismételjük meg,
       * és azt is csak a csoportba eső mezőkre. A hurkokat sorban dolgozzuk
       * fel, ahogy a gyors út is: ettől nő a védelem ismételt körnél.
       */
      const running: OwnershipMap = new Map(ownership);
      const perLoop: ClaimResult[] = [];
      for (const loop of loops) {
        const cells = new Set<CellId>();
        for (const cell of loopCells(loop)) {
          const blockId = blockOfCell.get(cell);
          if (blockId !== undefined && ownBlocks.has(blockId)) cells.add(cell);
        }
        if (cells.size === 0) continue;
        const claimed = resolveClaim(cells, running, uid);
        for (const [cell, next] of claimed.updates) running.set(cell, next);
        perLoop.push(claimed);
      }
      if (perLoop.length === 0) {
        tx.set(partRef, emptyPart(now));
        return;
      }

      const merged = mergeClaims(perLoop, ownership, uid);
      const updates = new Map(
        [...merged.updates].filter(([cell, next]) => {
          const previous = ownership.get(cell);
          return previous?.owner !== next.owner || previous?.defense !== next.defense;
        }),
      );

      if (updates.size > 0) writeOwnership(tx, layer, updates, blocks, now, uid);

      /**
       * A HALADÁS az aktivitás dokumentumára kerül.
       *
       * A kliens ezt a dokumentumot már látja (a sajátja), tehát egyetlen
       * feliratkozásból megtudja, hol tart a mentés — nem kell a belső
       * `claimParts` alkollekciót megnyitni előtte.
       *
       * A csoportokat sorban dolgozzuk fel, ezért az `index + 1` a valóban
       * elkészült csoportok száma.
       */
      tx.set(
        activityRef,
        { claimProgress: { done: progressDone, total: groups.length }, updatedAt: now },
        { merge: true },
      );

      tx.set(partRef, {
        group: partId,
        counts: merged.counts,
        stolenFrom: merged.stolenFrom,
        breakthroughFrom: merged.breakthroughFrom,
        weightedClaimM2: merged.weightedClaimM2,
        gainedM2: merged.gainedM2,
        cells: merged.updates.size,
        writtenCells: updates.size,
        createdAt: now,
      });
    });
  }

  /* ── belső: egy COMPACT csoport alkalmazása ─────────────────────── */

  /**
   * Ugyanaz a checkpoint-szerződés, mint a normál csoportnál: determinisztikus
   * részdokumentum, tehát egy csoport kétszer nem könyvelhet, és egy félbemaradt
   * mentés folytatható.
   *
   * A KÜLÖNBSÉG a bemenetben van. Itt nem cellalistát bontunk blokkokra, hanem
   * blokkonkénti, előre kiszámolt claim-munkát alkalmazunk — a homogén belső
   * blokk O(1) átmenettel `uniform` marad, és soha nem esik szét 343 cellára.
   */
  async function applyCompactGroup(
    compactWorks: ReadonlyMap<string, CompactBlockWork>,
    groupBlocks: string[],
    partId: string,
    progressDone: number,
    parts: FirebaseFirestore.CollectionReference,
  ): Promise<void> {
    const partRef = parts.doc(partId);

    await db.runTransaction(async (tx) => {
      const done = await tx.get(partRef);
      if (done.exists) return;

      const blocks = await readBlocks(tx, groupBlocks);
      const resolved = resolveCompactGroup(layer, groupBlocks, blocks, compactWorks, uid, today);

      if (resolved.nextBlocks.size > 0) writeBlocks(tx, layer, resolved.nextBlocks, now, uid);

      tx.set(
        activityRef,
        { claimProgress: { done: progressDone, total: groups.length }, updatedAt: now },
        { merge: true },
      );

      /**
       * A FRONTIER-SEEDEK a részdokumentumba kerülnek, nem memóriába.
       *
       * A cleanup a csoportok UTÁN fut, egyetlen post-claim snapshotból. Ha a
       * seedeket csak memóriában tartanánk, egy félbeszakadt és újraindított
       * mentésnél a már kész csoportok seedjei elvesznének — a cleanup pedig
       * némán hiányosan futna le.
       */
      const seeds = resolved.stolenFineCells;
      tx.set(partRef, {
        group: partId,
        counts: resolved.part.counts,
        stolenFrom: resolved.part.stolenFrom,
        breakthroughFrom: resolved.part.breakthroughFrom,
        weightedClaimM2: resolved.part.weightedClaimM2,
        gainedM2: resolved.part.gainedM2,
        cells: resolved.part.cells,
        writtenCells: resolved.nextBlocks.size,
        stolenFineCells: seeds.slice(0, MAX_STOLEN_SEEDS_PER_GROUP),
        wholeStolenBlocks: resolved.wholeStolenBlocks,
        seedsTruncated: seeds.length > MAX_STOLEN_SEEDS_PER_GROUP,
        createdAt: now,
      });
    });
  }

  /* ── belső: compact frontier-korrekció ──────────────────────────── */

  /**
   * A lopás után árván maradt peremcellák rendezése — EGY SNAPSHOTBÓL.
   *
   * ⚠️ NO CASCADE. Minden döntés ugyanabból a claim UTÁNI állapotból készül, és
   * egyszerre kerül alkalmazásra. Ha a korrekciók egymásra hatnának, egy
   * keskeny folyosót a pass visszafelé felfalna.
   *
   * ⚠️ A közvetlen claim celláit NEM írja felül — ezt a `resolveCompactFrontier`
   * `isDirectlyClaimed` őre biztosítja a `works`-ből.
   *
   * A cella ahhoz kerül, akinek a legtöbb oldalával érintkezik. Ez LEHET egy
   * harmadik játékos is: olyankor a rács korrigálódik, de a mentés szereplője
   * nem kap érte sem területet, sem GP-t — ugyanaz a szabály, mint az
   * egytranzakciós úton (`cleanupStolenFrontierOrphans`).
   */
  async function applyCompactFrontier(
    compactWorks: ReadonlyMap<string, CompactBlockWork>,
    parts: FirebaseFirestore.CollectionReference,
  ): Promise<void> {
    const existing = await parts.get();
    const fineCells = new Set<CellId>();
    const wholeBlocks = new Set<string>();
    for (const doc of existing.docs) {
      if (doc.id === FRONTIER_PART_ID) continue;
      const data = doc.data() as { stolenFineCells?: unknown; wholeStolenBlocks?: unknown };
      for (const cell of stringArray(data.stolenFineCells)) fineCells.add(cell as CellId);
      for (const blockId of stringArray(data.wholeStolenBlocks)) wholeBlocks.add(blockId);
    }
    // Lopás nélkül nincs mit rendezni — a szabály kizárólag rablás után fut.
    if (fineCells.size === 0 && wholeBlocks.size === 0) return;

    const frontierPlan = planCompactFrontier(layer, compactWorks, { fineCells, wholeBlocks });
    const seeds = materializeCompactFrontierSeeds(compactWorks, frontierPlan);
    if (seeds.size === 0 || frontierPlan.readBlockIds.length === 0) return;

    const partRef = parts.doc(FRONTIER_PART_ID);
    const readBlockIds = new Set(frontierPlan.readBlockIds);

    await db.runTransaction(async (tx) => {
      const done = await tx.get(partRef);
      if (done.exists) return;

      const blocks = await readBlocks(tx, frontierPlan.readBlockIds);

      /**
       * A SCOPE a ténylegesen BEOLVASOTT cellák halmaza — nem a birtokolt
       * celláké.
       *
       * A motor a gazdátlan cellát is döntési adatnak veszi, ha ismeri; a nem
       * beolvasottnál viszont tartózkodnia kell. A kettőt csak így lehet
       * megkülönböztetni, mert a gazdátlan cella az ownership Mapben
       * SZÁNDÉKOSAN nem szerepel. Két gyűrű kell: a jelöltek a seedek egy
       * gyűrűjéből jönnek, és mindegyik jelöltnek a saját szomszédait is
       * ismerni kell.
       */
      const scope = new Set<CellId>();
      for (const seed of seeds) {
        for (const near of gridDisk(seed, 2)) {
          const cell = near as CellId;
          if (readBlockIds.has(blockIdFor(layer, cell))) scope.add(cell);
        }
      }

      const ownership = ownershipFromBlocks(layer, scope, blocks, today);
      const reassignments = resolveCompactFrontier(layer, ownership, scope, seeds, compactWorks);

      const updates = new Map<CellId, CellOwnership>();
      const counts: Record<CellFate, number> = { free: 0, reclaimed: 0, stolen: 0, breakthrough: 0 };
      const stolenFrom: Record<string, number> = {};
      const touchedBlocks = new Set<string>();
      const defenseOneMultiplier = GAMEPLAY.DEFENSE_MULTIPLIER[0] ?? 1;
      let weightedClaimM2 = 0;
      let gainedM2 = 0;
      let cells = 0;
      let truncated = false;

      for (const [cell, next] of reassignments) {
        const previous = ownership.get(cell);
        if (!previous || previous.owner === next.owner) continue;

        const blockId = blockIdFor(layer, cell);
        if (!touchedBlocks.has(blockId)) {
          if (touchedBlocks.size >= MAX_FRONTIER_BLOCKS) {
            truncated = true;
            continue;
          }
          touchedBlocks.add(blockId);
        }
        updates.set(cell, next);

        if (next.owner === uid) {
          counts.stolen += 1;
          stolenFrom[previous.owner] = (stolenFrom[previous.owner] ?? 0) + 1;
          weightedClaimM2 += defenseOneMultiplier * GAMEPLAY.CELL_AREA_M2;
          gainedM2 += GAMEPLAY.CELL_AREA_M2;
          cells += 1;
        }
      }

      if (updates.size > 0) writeOwnership(tx, layer, updates, blocks, now, uid);

      /**
       * A rész MINDIG megíródik, üres eredménynél is — ez a checkpoint. Az
       * alakja megegyezik a csoportokéval, ezért a könyvzárás külön ág nélkül
       * összegzi.
       */
      tx.set(partRef, {
        group: FRONTIER_PART_ID,
        counts,
        stolenFrom,
        breakthroughFrom: {},
        weightedClaimM2,
        gainedM2,
        cells,
        writtenCells: updates.size,
        reassigned: updates.size,
        truncated,
        createdAt: now,
      });
    });
  }
}

/* ══ Könyvzárás ══════════════════════════════════════════════════ */

async function closeBooks(
  plan: ActivityPlan,
  appliedToGameplay: boolean,
  publicTrustVerdict: 'trusted' | 'pending_review' | 'rejected',
  groupCount: number,
): Promise<CommitOutcome> {
  const { activityId, uid, type, layer, startedAt, endedAt, movingMs, now, today, loops, points } =
    plan;

  const activityRef = db.collection(COLLECTIONS.activities).doc(activityId);
  const userRef = db.collection(COLLECTIONS.users).doc(uid);
  const dailyGpRef = db.collection(COLLECTIONS.dailyGp).doc(`${uid}_${today}`);
  const ledgerRef = db.collection(COLLECTIONS.gpLedger).doc(`activity_${activityId}`);
  const auditRef = db.collection(COLLECTIONS.activityAudits).doc(activityId);

  // A részek a tranzakción KÍVÜL olvashatók: mind véglegesek, és a
  // determinisztikus azonosító miatt nem is változhatnak.
  const parts = appliedToGameplay
    ? (await activityRef.collection('claimParts').get()).docs.map(
        (doc) => doc.data() as unknown as ClaimPart,
      )
    : [];

  const total: ClaimPart = {
    counts: { free: 0, reclaimed: 0, stolen: 0, breakthrough: 0 },
    stolenFrom: {},
    breakthroughFrom: {},
    weightedClaimM2: 0,
    gainedM2: 0,
    cells: 0,
  };
  for (const part of parts) {
    for (const fate of ['free', 'reclaimed', 'stolen', 'breakthrough'] as CellFate[]) {
      total.counts[fate] += Number(part.counts?.[fate] ?? 0);
    }
    for (const [victim, count] of Object.entries(part.stolenFrom ?? {})) {
      total.stolenFrom[victim] = (total.stolenFrom[victim] ?? 0) + Number(count);
    }
    for (const [victim, count] of Object.entries(part.breakthroughFrom ?? {})) {
      total.breakthroughFrom[victim] = (total.breakthroughFrom[victim] ?? 0) + Number(count);
    }
    total.weightedClaimM2 += Number(part.weightedClaimM2 ?? 0);
    total.gainedM2 += Number(part.gainedM2 ?? 0);
    total.cells += Number(part.cells ?? 0);
  }

  const victims = Object.entries(total.stolenFrom).filter(([, count]) => count > 0);
  const victimRefs = victims.map(([id]) => db.collection(COLLECTIONS.users).doc(id));

  let summary: CommitSummary = blankSummary(plan, publicTrustVerdict);
  let alreadyClosed = false;

  await db.runTransaction(async (tx) => {
    /**
     * KÖNYVELNI CSAK EGYSZER SZABAD — ez az őr a folytatás ára.
     *
     * A csoportokat a determinisztikus `claimParts` azonosító védi a kétszeri
     * könyveléstől, a KÖNYVZÁRÁST viszont semmi: a `gpLedger` tétel ugyan
     * determinisztikus azonosítójú, de a `dailyGp` összeadás, a `gpTotal` és a
     * területszámlálók `increment`-ek — egy második lefutás megduplázná őket.
     *
     * Amíg a félbemaradt mentés duplikátumnak számított, ide nem is lehetett
     * kétszer eljutni. Most, hogy a folytatás valódi út, két párhuzamos kérés
     * (lejárt lease, kézi újraküldés) egyszerre érhet ide — ezért olvassuk be
     * a `claimStatus`-t UGYANEBBEN a tranzakcióban.
     */
    const activityNow = await tx.get(activityRef);
    const stored = activityNow.data() as
      | { claimStatus?: unknown; summary?: CommitSummary }
      | undefined;
    if (stored?.claimStatus === 'done') {
      alreadyClosed = true;
      if (stored.summary) summary = stored.summary;
      return;
    }

    const userNow = await tx.get(userRef);
    if (!userNow.exists) throw notFound('profile_missing', 'Még nincs GRUNDO-profilod.');
    const dailyGpNow = await tx.get(dailyGpRef);
    const victimSnaps = victimRefs.length > 0 ? await tx.getAll(...victimRefs) : [];

    const user = userNow.data() as { gpTotal?: number; timezone?: string; streak?: StoredStreak };
    const earnedToday = Number((dailyGpNow.data() as { total?: number } | undefined)?.total ?? 0);

    /**
     * A GP az ÖSSZESÍTETT darabszámokból számolódik.
     *
     * A `computeActivityGp` egy `ClaimResult`-ot vár; a csoportokból csak a
     * számlálók és a súlyozott terület kellenek hozzá, a cellánkénti térképek
     * nem. Ezért adunk neki egy összegzett, üres térképekkel feltöltött
     * példányt — a képlet szempontjából ez azonos a teljes eredménnyel.
     */
    const gp = computeActivityGp({
      type,
      distanceKm: plan.distanceM / 1000,
      claim: {
        updates: new Map(),
        fates: new Map(),
        counts: total.counts,
        stolenFrom: total.stolenFrom,
        breakthroughFrom: total.breakthroughFrom,
        weightedClaimM2: total.weightedClaimM2,
        gainedM2: total.gainedM2,
      },
      streakDays: user.streak?.current ?? 0,
      gpEarnedToday: earnedToday,
    });

    summary = {
      ...blankSummary(plan, publicTrustVerdict),
      claimedCells: total.cells,
      areaGainedM2: Math.round(total.gainedM2),
      gp: gp.total,
    };

    tx.set(
      activityRef,
      {
        gp,
        areaGainedM2: Math.round(total.gainedM2),
        // Ugyanaz a mező, mint a gyors úton (`activityCommit.ts:453`) — enélkül
        // az adatlap „útvonalmező: 0"-t mutatott minden darabolt mentésnél
        // (HANDOFF #27, nyitott ügy #1), mert ez a fázis sosem írta felül a
        // nyitó tranzakció kezdőértékét.
        cellCount: total.cells,
        // Ugyanaz a két mező, mint a gyors úton (`activityCommit.ts`) — a
        // kártya rivális-sávja nem tudhatja, melyik úton mentődött az
        // aktivitás, tehát MINDKETTŐNEK ki kell írnia.
        claimCounts: total.counts,
        stolenFrom: topVictims(total.stolenFrom),
        summary,
        claimStatus: 'done',
        claimGroups: groupCount,
        claimProgress: { done: groupCount, total: groupCount },
        updatedAt: now,
      },
      { merge: true },
    );

    // Lásd `buildChunkedActivityAudit` fejlécét: a darabolt út a gyors úttal
    // (`activityCommit.ts:507`) azonos AZ AGGREGÁLT terjedelemben, de
    // cellaszintű átmenetek nélkül — HANDOFF #27, nyitott ügy #2. Korábban ez
    // a fázis egyáltalán nem írt auditot, ezért az admin felület minden
    // darabolt aktivitásra tévesen az „auditnapló bevezetése előtt készült"
    // üzenetet mutatta.
    tx.set(auditRef, {
      activityId,
      userId: uid,
      type,
      layer,
      startedAt: new Date(startedAt),
      createdAt: now,
      ...buildChunkedActivityAudit(loops, total, appliedToGameplay, points.length),
    });

    if (!appliedToGameplay) return;

    tx.set(ledgerRef, {
      userId: uid,
      activityId,
      source: 'activity',
      gp,
      amount: gp.total,
      at: now,
      day: today,
    });
    tx.set(dailyGpRef, { userId: uid, day: today, total: earnedToday + gp.total, updatedAt: now });

    const gainedCells = total.counts.free + total.counts.stolen;
    const gainedAreaM2 = gainedCells * GAMEPLAY.CELL_AREA_M2;
    const gpAfter = Number(user.gpTotal ?? 0) + gp.total;
    tx.set(
      userRef,
      {
        gpTotal: gpAfter,
        gpWeek: FieldValue.increment(gp.total),
        gpMonth: FieldValue.increment(gp.total),
        level: levelFor(gpAfter),
        territoryM2: { [layer]: FieldValue.increment(gainedAreaM2) },
        cellCount: { [layer]: FieldValue.increment(gainedCells) },
        // Lásd `activityCommit.ts` — ugyanaz a bruttó szerzés-számláló.
        areaDay: { [layer]: FieldValue.increment(gainedAreaM2) },
        areaWeek: { [layer]: FieldValue.increment(gainedAreaM2) },
        areaMonth: { [layer]: FieldValue.increment(gainedAreaM2) },
        counters: {
          activities: FieldValue.increment(1),
          distanceKm: { [type]: FieldValue.increment(plan.distanceM / 1000) },
        },
        streak: advanceStreak(
          user.streak,
          localDay(new Date(startedAt), user.timezone ?? 'Europe/Budapest'),
        ),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    for (let index = 0; index < victims.length; index += 1) {
      const [victimId, stolenCells] = victims[index]!;
      const snapshot = victimSnaps[index];
      if (!snapshot?.exists) continue;
      const victim = snapshot.data() as {
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
  });

  // Lezárt könyvelésnél a hívó a `duplicate` ágon áll meg: nem küld újra
  // értesítést, és nem rögzít még egyszer rivalitást.
  return {
    duplicate: alreadyClosed,
    summary,
    stolenFrom: alreadyClosed ? {} : Object.fromEntries(victims),
    breakthroughFrom: alreadyClosed ? {} : total.breakthroughFrom,
  };

  function blankSummary(
    p: ActivityPlan,
    verdict: 'trusted' | 'pending_review' | 'rejected',
  ): CommitSummary {
    return {
      distanceM: Math.round(p.distanceM),
      durationS: Math.round((endedAt - startedAt) / 1000),
      movingS: Math.round(movingMs / 1000),
      cellCount: p.candidateCells.length,
      loops: loops.length,
      claimedCells: 0,
      areaGainedM2: 0,
      gp: 0,
      oversizedLoops: 0,
      trustVerdict: verdict,
    };
  }
}

/* ══ Segédek ══════════════════════════════════════════════════════ */

function chunk<T>(list: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < list.length; i += size) groups.push(list.slice(i, i + size));
  return groups;
}

/**
 * A tárolt trust verdikt visszaolvasása a folytatáshoz.
 *
 * Ismeretlen érték `trusted`-re esik vissza: a claim el sem indult volna
 * másképp, tehát a folytatás sem szigoríthat visszamenőleg.
 */
function storedVerdict(raw: unknown): 'trusted' | 'pending_review' | 'rejected' {
  return raw === 'pending_review' || raw === 'rejected' ? raw : 'trusted';
}

/**
 * A Firestore tranzakció-méretkorlátja — a MÁSIK korlát, nem az 500 írás.
 *
 * A tranzakció méretébe az indexbejegyzések is beleszámítanak, ezért egy
 * mérve 1,5 MB-os csoport is elhasalhat (lásd `BLOCKS_PER_GROUP`). A hibát a
 * gRPC `INVALID_ARGUMENT` (3) kódon, szövegesen adja vissza — típusos
 * hibaosztály nincs hozzá, ezért kell az üzenetre illeszteni.
 */
export function isTransactionTooBig(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const text = `${(error as { details?: unknown } | null)?.details ?? ''} ${
    error instanceof Error ? error.message : ''
  }`;
  return code === 3 && /transaction too big/i.test(text);
}

/**
 * Egy csoport alkalmazása, FELEZÉSSEL, ha a tranzakció túl nagy.
 *
 * MIÉRT NEM ELÉG A KISEBB CSOPORTMÉRET? Mert a tranzakció valódi költségét a
 * blokkok TARTALMA adja, nem a számuk: egy homogén belső blokk `uniform`-ként
 * pár száz bájt, egy kevert tulajdonú viszont 343 cellára bomlik, ~2 000
 * indexbejegyzéssel. Ugyanaz a 200-as csoport tehát a rács állapotától függően
 * két nagyságrendet ugorhat, és ezt a tervezéskor nem tudjuk megmérni — a
 * blokkokat csak a tranzakció olvassa be.
 *
 * A felezés ezt utólag, magától rendezi: a `slice` determinisztikus, és az
 * al-csoport azonosítója az útvonalából áll össze (`group-3` → `group-3a`,
 * `group-3b`), tehát az újrafuttatás ugyanoda könyvel. A könyvzárás a
 * `claimParts` MINDEN dokumentumát összegzi, ezért az al-csoportok külön
 * ág nélkül beleszámítanak.
 *
 * A gyakori út érintetlen: hiba nélkül pontosan egy tranzakció fut.
 */
export async function withSplitOnOverflow(
  blocks: string[],
  partId: string,
  apply: (blocks: string[], partId: string) => Promise<void>,
): Promise<void> {
  try {
    await apply(blocks, partId);
  } catch (error) {
    // Egyetlen blokkot már nem lehet tovább vágni: ott a hiba valódi, és a
    // hívóé — elrejtve némán hiányos foglalás keletkezne.
    if (blocks.length < 2 || !isTransactionTooBig(error)) throw error;

    const half = Math.ceil(blocks.length / 2);
    await withSplitOnOverflow(blocks.slice(0, half), `${partId}a`, apply);
    await withSplitOnOverflow(blocks.slice(half), `${partId}b`, apply);
  }
}

/**
 * Védekező olvasás a tárolt részdokumentumból.
 *
 * A mező hiányozhat (normál úton írt rész), és sosem szabad megbízni abban,
 * hogy a szerkezete ép — egy hibás elem miatt ne dőljön el a frontier fázis.
 */
function stringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string');
}

function emptyPart(now: Date) {
  return {
    counts: { free: 0, reclaimed: 0, stolen: 0, breakthrough: 0 },
    stolenFrom: {},
    breakthroughFrom: {},
    weightedClaimM2: 0,
    gainedM2: 0,
    cells: 0,
    writtenCells: 0,
    createdAt: now,
  };
}

/** A `FIRESTORE_MAX_TRANSACTION_WRITES` itt csak dokumentál: lásd BLOCKS_PER_GROUP. */
void FIRESTORE_MAX_TRANSACTION_WRITES;
