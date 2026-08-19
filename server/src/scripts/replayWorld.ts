/**
 * A világ újrajátszása — a hibás időszak utáni helyreállítás.
 *
 * MIÉRT KELL? A rávezető-szakasz hibája (2026-08-19-ig) egyetlen fizikai kört
 * több bezárásnak látott. Ennek három következménye maradt az adatban:
 *
 *   1. A GP felfújt. Egy 11,43 km-es kör 74 785 pontot kapott a helyes ~139
 *      helyett. A GP SOHA nem évül, tehát ez magától nem áll helyre.
 *   2. A védelmi szintek a maximumra kúsztak. Ez magától rendbe jönne a napi
 *      elévüléssel, de az újrajátszás úgyis pontosan beállítja.
 *   3. A BIRTOKVISZONY is elcsúszhatott: egy 2-es védelmű idegen mezőn az első
 *      extra hurok gyengített, a második pedig már el is vette — pedig egyetlen
 *      körrel csak gyengíteni lett volna szabad.
 *
 * MIT CSINÁL? Végigjátssza az összes aktivitást időrendben, a JAVÍTOTT
 * motorral, és ebből építi újra a rácsot, a pontokat és az összesítőket. Nem
 * foltoz: a végeredmény olyan, mintha a világ mindig a helyes szabályok
 * szerint működött volna.
 *
 * ⚠️ A MOTORT IMPORTÁLJA, NEM MÁSOLJA — nem tud elcsúszni a szervertől.
 *
 * BIZTONSÁG:
 *   - Alapból CSAK JELENT. Írni kizárólag `--apply` hatására ír, éles
 *     projekten `--allow-production` is kell mellé.
 *   - Az igazság forrása a `private/track` nyomvonal, amihez EZ A SZKRIPT
 *     SOHA NEM NYÚL. Ezért újrafuttatható: ha félbeszakad, a következő futás
 *     ugyanabból az adatból teljesen helyreállítja az állapotot.
 *   - A rács-dokumentumokat előbb ÚJRAÍRJA, és csak utána törli azokat,
 *     amikre az új állapotban már nincs szükség. Így nincs olyan pillanat,
 *     amikor a térkép üresen állna.
 *
 * FUTTATÁS (Cloud Shell):
 *
 *   cd ~/grundo/server && npm run replay:world
 *   cd ~/grundo/server && npm run replay:world -- --apply --allow-production
 */

import { FieldValue } from 'firebase-admin/firestore';
import { adminApp, COLLECTIONS, db, FIRESTORE_DATABASE_ID } from '../lib/firebase';
import {
  blockCellCount,
  blockIdFor,
  cellKey,
  gameDay,
  uniformStateOf,
  type StoredCell,
} from '../lib/gridMath';
import { processActivity } from '../../../src/game';
import { layerOf } from '../../../src/game/cells';
import { levelFor } from '../../../src/game/levels';
import { distanceM } from '../../../src/game/geo';
import { GAMEPLAY } from '../../../src/config/gameplay';
import type { CellId, Layer, OwnershipMap, TracePoint } from '../../../src/types';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const allowProduction = args.has('--allow-production');
const project = adminApp.options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? '';

if (!project) throw new Error('Állítsd be a GOOGLE_CLOUD_PROJECT környezeti változót.');
if (project === 'grundo' && apply && !allowProduction) {
  throw new Error('Éles íráshoz az --apply mellett az --allow-production is kötelező.');
}

console.log(`\n═══ Újrajátszás — ${project} / ${FIRESTORE_DATABASE_ID} ═══`);
console.log(apply ? '‼️  ÍRÁSI MÓD\n' : 'Száraz futás — semmi nem íródik.\n');

/* ── Beolvasás ───────────────────────────────────────────────────── */

const userSnaps = await db.collection(COLLECTIONS.users).get();
const activitySnaps = await db.collection(COLLECTIONS.activities).get();

const activities = activitySnaps.docs
  .filter((doc) => doc.data().deletedAt == null)
  .map((doc) => ({ id: doc.id, ref: doc.ref, data: doc.data() as Record<string, unknown> }))
  .sort((a, b) => toMillis(a.data.startedAt) - toMillis(b.data.startedAt));

console.log(`Felhasználó: ${userSnaps.size} · újrajátszandó aktivitás: ${activities.length}\n`);

/* ── Újrajátszás ─────────────────────────────────────────────────── */

interface Totals {
  gp: number;
  areaM2: Record<Layer, number>;
  cells: Record<Layer, number>;
  activities: number;
  distanceKm: Record<string, number>;
  streak: { current: number; longest: number; lastActiveDay?: number };
  perDay: Map<number, number>;
}

const ownership: Record<Layer, OwnershipMap> = { foot: new Map(), bike: new Map() };
const grid: Record<Layer, Map<CellId, StoredCell>> = { foot: new Map(), bike: new Map() };
const totals = new Map<string, Totals>();
const updates: {
  ref: FirebaseFirestore.DocumentReference;
  gp: unknown;
  areaM2: number;
  uid: string;
  day: number;
  id: string;
}[] = [];

for (const activity of activities) {
  const uid = String(activity.data.userId ?? '');
  const track = await activity.ref.collection('private').doc('track').get();
  const points = (track.data()?.points ?? []) as TracePoint[];

  if (!uid || points.length < 2) {
    console.log(`  ${activity.id.slice(0, 8)}…  KIHAGYVA — nincs nyomvonal`);
    continue;
  }

  const type = String(activity.data.type ?? 'run') as 'run' | 'walk' | 'ride';
  const layer = layerOf(type);
  const day = gameDay(new Date(toMillis(activity.data.startedAt)));
  const meters = totalDistance(points);
  const totalsFor = totals.get(uid) ?? blankTotals();
  totals.set(uid, totalsFor);

  const result = processActivity({
    points,
    type,
    distanceKm: meters / 1000,
    actorId: uid,
    ownership: ownership[layer],
    streakDays: streakAfter(totalsFor.streak, day).current,
    gpEarnedToday: totalsFor.perDay.get(day) ?? 0,
  });

  // Birtokváltás: a károsult összesítője csökken, a támadóé nő.
  for (const [cell, next] of result.claim?.updates ?? []) {
    const previous = ownership[layer].get(cell);
    if (previous && previous.owner !== next.owner) {
      const victim = totals.get(previous.owner);
      if (victim) {
        victim.cells[layer] = Math.max(0, victim.cells[layer] - 1);
        victim.areaM2[layer] = Math.max(0, victim.areaM2[layer] - GAMEPLAY.CELL_AREA_M2);
      }
    }
    ownership[layer].set(cell, next);
    grid[layer].set(cell, { o: next.owner, d: next.defense, u: day });
  }

  const gained = (result.claim?.counts.free ?? 0) + (result.claim?.counts.stolen ?? 0);
  totalsFor.gp += result.gp.total;
  totalsFor.cells[layer] += gained;
  totalsFor.areaM2[layer] += gained * GAMEPLAY.CELL_AREA_M2;
  totalsFor.activities += 1;
  totalsFor.distanceKm[type] = (totalsFor.distanceKm[type] ?? 0) + meters / 1000;
  totalsFor.perDay.set(day, (totalsFor.perDay.get(day) ?? 0) + result.gp.total);
  totalsFor.streak = streakAfter(totalsFor.streak, day);

  const was = (activity.data.gp as { total?: number } | undefined)?.total ?? 0;
  console.log(
    `  ${activity.id.slice(0, 8)}…  nap=${day}  hurok=${result.loops.length}  ` +
      `mező=${gained}  GP: ${was} → ${result.gp.total}` +
      `${was === result.gp.total ? '' : '   ← változik'}`,
  );

  updates.push({
    ref: activity.ref,
    gp: result.gp,
    areaM2: result.areaGainedM2,
    uid,
    day,
    id: activity.id,
  });
}

/* ── Összegzés ───────────────────────────────────────────────────── */

console.log('\n─── FELHASZNÁLÓNKÉNT ───\n');
for (const user of userSnaps.docs) {
  const before = user.data() as Record<string, unknown>;
  const after = totals.get(user.id);
  const name = String(before.username ?? user.id);
  if (!after) {
    console.log(`  ${name}: nincs újrajátszható aktivitása\n`);
    continue;
  }
  const gp = Math.round(after.gp);
  console.log(`  ${name}`);
  console.log(`     GP       ${before.gpTotal ?? 0}  →  ${gp}`);
  console.log(`     szint    ${before.level ?? '?'}  →  ${levelFor(gp)}`);
  console.log(
    `     sorozat  ${(before.streak as { current?: number } | undefined)?.current ?? 0}  →  ${after.streak.current}`,
  );
  for (const layer of ['foot', 'bike'] as Layer[]) {
    const cells = (before.cellCount as Record<string, number> | undefined)?.[layer] ?? 0;
    console.log(`     mező ${layer}   ${cells}  →  ${after.cells[layer]}`);
  }
  console.log('');
}

const newBlockCount = countBlocks();
console.log(`  rács-blokk: ${(await db.collection(COLLECTIONS.grid).get()).size}  →  ${newBlockCount}`);

if (!apply) {
  console.log('\nSzáraz futás volt — semmi nem íródott. Írás: --apply\n');
  process.exit(0);
}

/* ── Írás ────────────────────────────────────────────────────────── */

console.log('\n─── ÍRÁS ───\n');

// 1. A rács ÚJRAÍRÁSA. Előbb írunk, csak utána törlünk: így nincs olyan
//    pillanat, amikor a térkép üresen állna.
const written = new Set<string>();
for (const layer of ['foot', 'bike'] as Layer[]) {
  const blocks = new Map<string, { cells: Record<string, StoredCell>; owners: Record<string, number> }>();
  for (const [cell, value] of grid[layer]) {
    const blockId = blockIdFor(layer, cell);
    const block = blocks.get(blockId) ?? { cells: {}, owners: {} };
    block.cells[cellKey(cell)] = value;
    block.owners[value.o] = (block.owners[value.o] ?? 0) + 1;
    blocks.set(blockId, block);
  }

  const ids = [...blocks.keys()];
  for (let i = 0; i < ids.length; i += 400) {
    const batch = db.batch();
    for (const blockId of ids.slice(i, i + 400)) {
      const block = blocks.get(blockId)!;
      const parent = blockId.slice(layer.length + 1);
      /**
       * A visszajátszás is TÖMÖRÍT.
       *
       * Enélkül egy helyreállítás visszabontaná az összes uniform blokkot
       * kifejtett alakra — és pont a legnagyobb foglalásoknál, ahol a
       * tömörítés a legtöbbet ér.
       */
      const uniform = uniformStateOf(block.cells, blockCellCount(parent, GAMEPLAY.H3_RESOLUTION));
      const payload: Record<string, unknown> = {
        layer,
        parent,
        cells: uniform ? {} : block.cells,
        ownerCounts: block.owners,
        version: 1,
        updatedAt: new Date(),
        replayedAt: new Date(),
      };
      if (uniform) payload.uniform = uniform;
      batch.set(db.collection(COLLECTIONS.grid).doc(blockId), payload);
      written.add(blockId);
    }
    await batch.commit();
  }
  console.log(`  rács-blokk (${layer}): ${ids.length} írva`);

  // Blokk-index felhasználónként.
  const byUser = new Map<string, string[]>();
  for (const [blockId, block] of blocks) {
    for (const owner of Object.keys(block.owners)) {
      const list = byUser.get(owner) ?? [];
      list.push(blockId);
      byUser.set(owner, list);
    }
  }
  for (const [uid, blockIds] of byUser) {
    await db
      .collection(COLLECTIONS.users)
      .doc(uid)
      .collection('blockIndex')
      .doc(layer)
      .set({ layer, blocks: blockIds.sort(), updatedAt: new Date() });
  }
  console.log(`  blokk-index (${layer}): ${byUser.size} felhasználó`);
}

// 2. A feleslegessé vált rács-dokumentumok törlése — CSAK azok, amiket az új
//    állapot nem tartalmaz.
const existing = await db.collection(COLLECTIONS.grid).get();
const stale = existing.docs.filter((doc) => !written.has(doc.id));
for (let i = 0; i < stale.length; i += 400) {
  const batch = db.batch();
  for (const doc of stale.slice(i, i + 400)) batch.delete(doc.ref);
  await batch.commit();
}
console.log(`  elavult rács-blokk törölve: ${stale.length}`);

// 3. Az aktivitások pontjai és a GP-főkönyv.
for (let i = 0; i < updates.length; i += 200) {
  const batch = db.batch();
  for (const item of updates.slice(i, i + 200)) {
    batch.set(
      item.ref,
      {
        gp: item.gp,
        areaGainedM2: item.areaM2,
        summary: { gp: (item.gp as { total: number }).total, areaGainedM2: item.areaM2 },
        replayedAt: new Date(),
      },
      { merge: true },
    );
    batch.set(db.collection(COLLECTIONS.gpLedger).doc(`activity_${item.id}`), {
      userId: item.uid,
      activityId: item.id,
      source: 'activity',
      gp: item.gp,
      amount: (item.gp as { total: number }).total,
      at: new Date(),
      day: item.day,
      replayedAt: new Date(),
    });
  }
  await batch.commit();
}
console.log(`  aktivitás újraírva: ${updates.length}`);

// 4. A profilok és a napi GP-állapot.
for (const [uid, t] of totals) {
  const gp = Math.round(t.gp);
  await db.collection(COLLECTIONS.users).doc(uid).set(
    {
      gpTotal: gp,
      gpWeek: gp,
      gpMonth: gp,
      level: levelFor(gp),
      territoryM2: { foot: Math.round(t.areaM2.foot), bike: Math.round(t.areaM2.bike) },
      cellCount: { foot: t.cells.foot, bike: t.cells.bike },
      counters: { activities: t.activities, distanceKm: t.distanceKm },
      streak: t.streak,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  for (const [day, amount] of t.perDay) {
    await db
      .collection(COLLECTIONS.dailyGp)
      .doc(`${uid}_${day}`)
      .set({ userId: uid, day, total: Math.round(amount), updatedAt: new Date() });
  }
}
console.log(`  profil frissítve: ${totals.size}`);
console.log('\nKÉSZ.\n');

/* ── Segédek ─────────────────────────────────────────────────────── */

function blankTotals(): Totals {
  return {
    gp: 0,
    areaM2: { foot: 0, bike: 0 },
    cells: { foot: 0, bike: 0 },
    activities: 0,
    distanceKm: {},
    streak: { current: 0, longest: 0 },
    perDay: new Map(),
  };
}

/** Ugyanaz a szabály, mint az `activityCommit` `advanceStreak`-je. */
function streakAfter(streak: Totals['streak'], day: number): Totals['streak'] {
  const last = streak.lastActiveDay;
  if (last !== undefined && day < last) return streak;
  const next = last === day ? Math.max(1, streak.current) : last === day - 1 ? streak.current + 1 : 1;
  return { current: next, longest: Math.max(next, streak.longest), lastActiveDay: day };
}

function countBlocks(): number {
  const ids = new Set<string>();
  for (const layer of ['foot', 'bike'] as Layer[]) {
    for (const cell of grid[layer].keys()) ids.add(blockIdFor(layer, cell));
  }
  return ids.size;
}

function totalDistance(points: readonly TracePoint[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) sum += distanceM(points[i - 1]!, points[i]!);
  return sum;
}

function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const stamp = value as { toMillis?: () => number } | undefined;
  return typeof stamp?.toMillis === 'function' ? stamp.toMillis() : 0;
}
