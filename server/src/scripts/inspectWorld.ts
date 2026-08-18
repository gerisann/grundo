/**
 * Diagnózis — CSAK OLVAS, soha nem ír.
 *
 * MIÉRT KELL? Két dolgot nem lehet a kódból megállapítani, csak a valódi
 * adatból:
 *
 *   1. Miért áll a napi sorozat egyen, ha több napon is volt aktivitás.
 *      A kód logikája helyesnek látszik, tehát vagy a tárolt `lastActiveDay`
 *      hiányzik/rossz, vagy az aktivitások nem azok a napok, amiknek hisszük.
 *   2. Mennyi GP-t adna a JAVÍTOTT motor a már elmentett aktivitásokra. A
 *      rávezető szakasz hibája (2026-08-19-ig) felfújta a védelmet és vele a
 *      pontot; a védelem magától helyreáll az elévüléssel, a GP nem.
 *
 * A szkript egyetlen írást sem végez. A javításról külön döntünk, miután
 * láttuk a számokat.
 *
 * ⚠️ A MOTORT IMPORTÁLJA, NEM MÁSOLJA — ezért nem csúszhat el a szervertől.
 *
 * FUTTATÁS (Cloud Shell):
 *
 *   cd ~/grundo/server && npm run inspect:world
 */

import { COLLECTIONS, db, FIRESTORE_DATABASE_ID } from '../lib/firebase';
import { gameDay } from '../lib/gridMath';
import { processActivity } from '../../../src/game';
import { layerOf } from '../../../src/game/cells';
import { distanceM } from '../../../src/game/geo';
import type { Layer, OwnershipMap, TracePoint } from '../../../src/types';

const project = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? '(ismeretlen)';

const users = await db.collection(COLLECTIONS.users).get();
const activitySnaps = await db.collection(COLLECTIONS.activities).get();

const activities = activitySnaps.docs
  .filter((doc) => doc.data().deletedAt == null)
  .map((doc) => ({ id: doc.id, ref: doc.ref, data: doc.data() as Record<string, unknown> }))
  .sort((a, b) => toMillis(a.data.startedAt) - toMillis(b.data.startedAt));

console.log(`\n═══ GRUNDO diagnózis — ${project} / ${FIRESTORE_DATABASE_ID} ═══`);
console.log(`Felhasználó: ${users.size} · aktivitás: ${activities.length} (törölt nélkül)\n`);

/* ── 1. A sorozat állapota ───────────────────────────────────────── */

console.log('─── SOROZAT ÉS AKTIVITÁSOK ───\n');

for (const user of users.docs) {
  const data = user.data() as Record<string, unknown>;
  const streak = (data.streak ?? {}) as Record<string, unknown>;

  console.log(`▸ ${String(data.username ?? user.id)}  (${user.id})`);
  console.log(`    gpTotal=${data.gpTotal ?? 0}  szint=${data.level ?? '?'}`);
  console.log(
    `    streak.current=${streak.current ?? '—'}  ` +
      `longest=${streak.longest ?? '—'}  ` +
      `lastActiveDay=${streak.lastActiveDay ?? 'HIÁNYZIK'}`,
  );
  // A regisztráció ezt a mezőt hozza létre; a léptető viszont `lastActiveDay`-t
  // használ. Ha itt érték van és fent „HIÁNYZIK", akkor a kettő elcsúszott.
  console.log(`    (régi mező) lastActiveDate=${JSON.stringify(streak.lastActiveDate ?? null)}`);

  const mine = activities.filter((a) => a.data.userId === user.id);
  if (mine.length === 0) {
    console.log('    nincs aktivitása\n');
    continue;
  }

  console.log('    aktivitások időrendben:');
  let previousDay: number | null = null;
  for (const a of mine) {
    const started = new Date(toMillis(a.data.startedAt));
    const created = new Date(toMillis(a.data.createdAt));
    const day = gameDay(started);
    const saveDay = gameDay(created);
    const gap = previousDay === null ? '—' : `${day - previousDay} nap`;
    console.log(
      `      ${a.id.slice(0, 8)}…  indult=${fmt(started)} (nap ${day})  ` +
        `mentve=${fmt(created)} (nap ${saveDay})  ` +
        `előzőhöz képest: ${gap}  ` +
        `${(Number(a.data.distanceM ?? 0) / 1000).toFixed(2)} km  ` +
        `GP=${(a.data.gp as { total?: number } | undefined)?.total ?? 0}`,
    );
    previousDay = day;
  }
  console.log('');
}

/* ── 2. Mennyi GP jönne ki a javított motorral? ──────────────────── */

console.log('─── ÚJRASZÁMOLÁS A JAVÍTOTT MOTORRAL (csak számítás) ───\n');

const ownership: Record<Layer, OwnershipMap> = { foot: new Map(), bike: new Map() };
const gpByUser = new Map<string, { before: number; after: number }>();

for (const activity of activities) {
  const uid = String(activity.data.userId ?? '');
  const track = await activity.ref.collection('private').doc('track').get();
  const points = (track.data()?.points ?? []) as TracePoint[];

  if (points.length < 2) {
    console.log(`  ${activity.id.slice(0, 8)}…  kihagyva — nincs eltárolt nyomvonal`);
    continue;
  }

  const type = String(activity.data.type ?? 'run') as 'run' | 'walk' | 'ride';
  const layer = layerOf(type);
  const meters = totalDistance(points);

  const result = processActivity({
    points,
    type,
    distanceKm: meters / 1000,
    actorId: uid,
    ownership: ownership[layer],
    streakDays: 1,
    gpEarnedToday: 0,
  });

  for (const [cell, next] of result.claim?.updates ?? []) ownership[layer].set(cell, next);

  const before = (activity.data.gp as { total?: number } | undefined)?.total ?? 0;
  const after = result.gp.total;
  const sum = gpByUser.get(uid) ?? { before: 0, after: 0 };
  sum.before += before;
  sum.after += after;
  gpByUser.set(uid, sum);

  const maxDefense = Math.max(0, ...[...(result.claim?.updates.values() ?? [])].map((o) => o.defense));
  console.log(
    `  ${activity.id.slice(0, 8)}…  hurok=${String(result.loops.length).padStart(2)}  ` +
      `max védelem=${maxDefense}  mező=${result.claimedCells.size}  ` +
      `GP: ${before} → ${after}${before === after ? '' : '  ← ELTÉR'}`,
  );
}

console.log('\n─── ÖSSZESÍTÉS ───\n');
for (const user of users.docs) {
  const sum = gpByUser.get(user.id);
  if (!sum) continue;
  const data = user.data() as Record<string, unknown>;
  console.log(
    `  ${String(data.username ?? user.id)}: tárolt gpTotal=${data.gpTotal ?? 0}  ` +
      `· aktivitásokból most=${sum.before}  · javított motorral=${sum.after}`,
  );
}

console.log('\nEz a szkript SEMMIT nem írt. A javításról a számok ismeretében döntünk.\n');

/* ── Segédek ─────────────────────────────────────────────────────── */

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

function fmt(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ');
}
