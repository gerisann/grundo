/**
 * A küldetés-kiértékelés VALÓDI Firestore ellen.
 *
 * MIT BIZONYÍT EZ, AMIT EGY UNIT TESZT NEM? Azt, hogy a küldetés ugyanazt
 * ígéri, amit a felhasználó ténylegesen meg is kapna. A jelöltet a
 * `processActivity` értékeli ki — ugyanaz a függvény, ami a mentésnél a
 * területet adja —, a birtokviszony pedig valódi `grid` blokkokból jön. Ha a
 * kettő elcsúszna (mert valaha külön „gyors becslés" kerülne a küldetésbe),
 * ez a teszt megfogja.
 *
 * MAPBOX NÉLKÜL FUT. A Directions API csak a jelölt GEOMETRIÁJÁT adja; itt
 * szintetikus hurkot (`fixtures.simpleLoop`) teszünk a helyére, és a lánc
 * drága felét — cellák → hurkok → birtokviszony → GP → válogatás — mérjük.
 *
 * Emulátor nélkül a fájl MAGÁTÓL KIMARAD, tehát a sima `npm test` nem törik el.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loopAt, simpleLoop } from '../../../src/game/fixtures';
import { encodePolyline } from '../../../src/game/polyline';
import { pickMissions } from '../../../src/game/missions';
import type { CellId, TracePoint } from '../../../src/types';
import type { ShapedCandidate } from './missionEvaluate';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-grundo';
const DATABASE = process.env.FIRESTORE_DATABASE_ID ?? 'grundo-db';

describe.skipIf(!EMULATOR)('Küldetés-kiértékelés — valódi Firestore ellen', () => {
  let db: FirebaseFirestore.Firestore;
  let loadOwnership: typeof import('./grid').loadOwnership;
  let evaluate: typeof import('./missionEvaluate');
  let traceToCellPath: typeof import('../../../src/game/cells').traceToCellPath;
  let detectLoopsDetailed: typeof import('../../../src/game/loops').detectLoopsDetailed;
  let loopCells: typeof import('../../../src/game/loops').loopCells;

  beforeAll(async () => {
    db = (await import('./firebase')).db;
    loadOwnership = (await import('./grid')).loadOwnership;
    evaluate = await import('./missionEvaluate');
    const cells = await import('../../../src/game/cells');
    const loops = await import('../../../src/game/loops');
    traceToCellPath = cells.traceToCellPath;
    detectLoopsDetailed = loops.detectLoopsDetailed;
    loopCells = loops.loopCells;
  });

  beforeEach(async () => {
    const url = `http://${EMULATOR}/emulator/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;
    await fetch(url, { method: 'DELETE' });
  });

  /** Szintetikus jelölt: fixture-hurokból, ahogy a Directions adná. */
  function shape(points: TracePoint[], bearing = 0, distanceKm = 3): ShapedCandidate {
    const { path } = traceToCellPath(points);
    const loops = detectLoopsDetailed(path).loops;
    const cells = new Set<CellId>();
    for (const loop of loops) for (const cell of loopCells(loop)) cells.add(cell);
    return {
      bearing,
      distanceKm,
      polyline: encodePolyline(points),
      points,
      cells,
    };
  }

  it('szabad terepen HÓDÍTÁS lesz belőle, valódi cellaszámmal', async () => {
    const candidate = shape(simpleLoop(220));
    expect(candidate.cells.size).toBeGreaterThan(0);

    // Üres rács: mindenki szabad.
    const ownership = await loadOwnership('foot', candidate.cells);
    expect(ownership.size).toBe(0);

    const evaluated = evaluate.evaluateCandidate(
      candidate,
      {
        uid: 'alice',
        layer: 'foot',
        type: 'run',
        ownership,
        streakDays: 0,
        gpEarnedToday: 0,
      },
      new Set(),
    );

    expect(evaluated).not.toBeNull();
    expect(evaluated!.claim!.counts.free).toBe(candidate.cells.size);
    expect(evaluated!.claim!.counts.stolen).toBe(0);
    expect(evaluated!.gainedM2).toBeGreaterThan(0);
    expect(evaluated!.estimatedGp).toBeGreaterThan(0);

    const missions = pickMissions([evaluated!]);
    expect(missions.map((mission) => mission.kind)).toEqual(['conquest']);
  });

  it('idegen, védtelen területen RAJTAÜTÉS lesz, és megnevezi a károsultat', async () => {
    const candidate = shape(simpleLoop(220));

    // A cellák Petié, védelem nélkül — tehát elvehetők.
    await seedGrid(candidate.cells, 'peti', 1);

    const ownership = await loadOwnership('foot', candidate.cells);
    expect(ownership.size).toBe(candidate.cells.size);

    const evaluated = evaluate.evaluateCandidate(
      candidate,
      { uid: 'alice', layer: 'foot', type: 'run', ownership, streakDays: 0, gpEarnedToday: 0 },
      new Set(),
    );

    expect(evaluated!.claim!.counts.stolen).toBe(candidate.cells.size);
    expect(evaluated!.claim!.counts.free).toBe(0);

    const missions = pickMissions([evaluated!]);
    expect(missions.map((mission) => mission.kind)).toEqual(['raid']);
    expect(missions[0]!.topVictimUid).toBe('peti');
    expect(missions[0]!.topVictimCells).toBe(candidate.cells.size);
  });

  it('védett idegen területen NEM ígér tulajdonszerzést', async () => {
    const candidate = shape(simpleLoop(220));
    // Védelem 3: áttörés lesz, nem lopás — a cella nem cserél gazdát.
    await seedGrid(candidate.cells, 'peti', 3);

    const ownership = await loadOwnership('foot', candidate.cells);
    const evaluated = evaluate.evaluateCandidate(
      candidate,
      { uid: 'alice', layer: 'foot', type: 'run', ownership, streakDays: 0, gpEarnedToday: 0 },
      new Set(),
    );

    expect(evaluated!.claim!.counts.breakthrough).toBe(candidate.cells.size);
    expect(evaluated!.claim!.counts.stolen).toBe(0);
    expect(evaluated!.gainedM2).toBe(0);
    // Áttörés önmagában egyik karakternek sem mértéke — nincs mit ajánlani.
    expect(pickMissions([evaluated!])).toHaveLength(0);
  });

  it('saját területen ERŐSÍTÉS lesz belőle', async () => {
    const candidate = shape(simpleLoop(220));
    await seedGrid(candidate.cells, 'alice', 1);

    const ownership = await loadOwnership('foot', candidate.cells);
    const evaluated = evaluate.evaluateCandidate(
      candidate,
      { uid: 'alice', layer: 'foot', type: 'run', ownership, streakDays: 0, gpEarnedToday: 0 },
      evaluate.ownedBlockIds(ownership, 'alice', 'foot'),
    );

    expect(evaluated!.claim!.counts.reclaimed).toBe(candidate.cells.size);
    // A saját blokkjaimban járva nincs „új körzet".
    expect(evaluated!.newBlocks).toBe(0);

    const missions = pickMissions([evaluated!]);
    expect(missions.map((mission) => mission.kind)).toEqual(['fortify']);
  });

  it('a FELFEDEZÉS az ismeretlen körzeteket számolja', async () => {
    const candidate = shape(simpleLoop(220));
    const ownership = await loadOwnership('foot', candidate.cells);

    // Üres `ownedBlocks`: minden érintett körzet új.
    const evaluated = evaluate.evaluateCandidate(
      candidate,
      { uid: 'alice', layer: 'foot', type: 'run', ownership, streakDays: 0, gpEarnedToday: 0 },
      new Set(),
    );
    expect(evaluated!.newBlocks).toBeGreaterThan(0);

    // Ugyanaz a kör, de a körzetei már a sajátjaim: nincs felfedeznivaló.
    const known = evaluate.blocksOf(candidate.cells, 'foot');
    const second = evaluate.evaluateCandidate(
      candidate,
      { uid: 'alice', layer: 'foot', type: 'run', ownership, streakDays: 0, gpEarnedToday: 0 },
      known,
    );
    expect(second!.newBlocks).toBe(0);
  });

  it('a blokk-plafon a RÖVIDEBB jelölteket tartja meg', () => {
    const near = shape(loopAt({ lat: 47.475, lng: 19.015 }, 200), 0, 2);
    const far = shape(loopAt({ lat: 47.52, lng: 19.09 }, 900), 90, 9);

    // Olyan szűk plafon, amibe csak a kisebb fér bele.
    const kept = evaluate.limitByBlocks([far, near], 'foot', 3);
    expect(kept.length).toBeGreaterThanOrEqual(1);
    expect(kept[0]!.cells.size).toBeLessThanOrEqual(far.cells.size);
  });

  it('bőséges plafonnál minden jelölt megmarad', () => {
    const a = shape(loopAt({ lat: 47.475, lng: 19.015 }, 200), 0, 2);
    const b = shape(loopAt({ lat: 47.48, lng: 19.03 }, 220), 90, 2);
    expect(evaluate.limitByBlocks([a, b], 'foot', 10_000)).toHaveLength(2);
  });

  /**
   * Cellák beírása a `grid` blokkokba, adott tulajdonossal és védelemmel.
   *
   * KÖZVETLEN BLOKKÍRÁS, nem a `writeOwnership` — az tranzakciót és előre
   * beolvasott blokkokat vár (a Firestore megköveteli, hogy minden olvasás
   * megelőzze az írást). Egy teszt-előkészítéshez az a kerülőút csak zajt
   * adna; itt a TÁROLT alakot írjuk le pontosan úgy, ahogy az olvasó várja.
   *
   * ⚠️ Az `u` (szerzés napja) a MAI napszám. Nullával a védelem az
   * `effectiveDefense` elévülése miatt azonnal 1-re esne vissza, és a
   * „védett idegen terület" eset csendben lopássá változna.
   */
  async function seedGrid(cells: Iterable<CellId>, owner: string, defense: number): Promise<void> {
    const { blockIdFor, cellKey } = await import('./gridMath');
    const today = (await import('./grid')).gameDay(new Date());

    const grouped = new Map<string, Record<string, { o: string; d: number; u: number }>>();
    for (const cell of cells) {
      const blockId = blockIdFor('foot', cell);
      const block = grouped.get(blockId) ?? {};
      block[cellKey(cell)] = { o: owner, d: defense, u: today };
      grouped.set(blockId, block);
    }

    const batch = db.batch();
    for (const [blockId, cellMap] of grouped) {
      batch.set(db.collection('grid').doc(blockId), {
        layer: 'foot',
        parent: blockId.slice('foot_'.length),
        cells: cellMap,
        ownerCounts: { [owner]: Object.keys(cellMap).length },
        version: 1,
      });
    }
    await batch.commit();
  }
});
