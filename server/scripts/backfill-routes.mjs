/**
 * A NYILVÁNOS NYOMVONAL visszatöltése a régi aktivitásokra.
 *
 * MIÉRT KELL? A `route` mező (levágott, ritkított, kódolt nyomvonal) csak
 * mostantól íródik a feltöltésnél. A korábban mentett aktivitásoknak van
 * teljes nyomvonaluk a `private/track` aldokumentumban, de nincs nyilvános
 * változatuk — a feed-kártyájuk térkép nélkül, „Nincs elmentett útvonal"
 * felirattal jelenne meg. Ez a szkript pótolja őket.
 *
 * A LEVÁGÁS ITT IS MEGTÖRTÉNIK. A felhasználó saját adatvédelmi beállítását
 * olvassuk (`users/{uid}.privacy`), és ugyanazt a szabályt alkalmazzuk, mint
 * élesben: az elejéről és a végéről addig dobjuk a pontokat, amíg tartósan el
 * nem hagyják a védőkört. Levágás nélkül ez a szkript lakcímeket tenne
 * nyilvánossá.
 *
 * ⚠️ A LOGIKA MÁSOLAT. Az igazság forrása:
 *      src/game/polyline.ts  — kódolás és ritkítás
 *      src/game/privacy.ts   — levágás
 *    A szkriptek sima .mjs fájlok, nem látják a TypeScript-forrást. Ha a
 *    fenti kettő változik, EZT IS frissíteni kell.
 *
 * FUTTATÁS (Cloud Shell):
 *
 *   cd ~/grundo && node server/scripts/backfill-routes.mjs           # megmutatja
 *   cd ~/grundo && node server/scripts/backfill-routes.mjs --apply   # ír
 *
 * Alapból száraz futás. Újrafuttatható: a már feltöltött aktivitásokat
 * kihagyja, hacsak a `--force` nem kéri az újraszámolást.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID ?? 'grundo-db';

const apply = process.argv.includes('--apply');
const force = process.argv.includes('--force');

const app = initializeApp({ credential: applicationDefault() });
const db = getFirestore(app, DATABASE_ID);

/* ── Másolat: src/game/geo.ts ─────────────────────────────────────── */

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

function distanceM(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ── Másolat: src/game/privacy.ts ─────────────────────────────────── */

const DEFAULT_PRIVACY = { hideStart: true, startRadiusM: 200, hideEnd: true, endRadiusM: 200 };

function trimPrivateEnds(points, settings) {
  if (points.length < 2) return [];

  let start = 0;
  if (settings.hideStart && settings.startRadiusM > 0) {
    for (let i = 0; i < points.length; i += 1) {
      if (distanceM(points[0], points[i]) <= settings.startRadiusM) start = i + 1;
    }
  }

  let end = points.length - 1;
  if (settings.hideEnd && settings.endRadiusM > 0) {
    const last = points[points.length - 1];
    for (let i = points.length - 1; i >= 0; i -= 1) {
      if (distanceM(last, points[i]) <= settings.endRadiusM) end = i - 1;
    }
  }

  return end - start < 1 ? [] : points.slice(start, end + 1);
}

/* ── Másolat: src/game/polyline.ts ────────────────────────────────── */

const METERS_PER_DEGREE = 111_320;

function perpendicularM(point, from, to) {
  const scale = Math.cos((from.lat * Math.PI) / 180);
  const px = (point.lng - from.lng) * scale;
  const py = point.lat - from.lat;
  const dx = (to.lng - from.lng) * scale;
  const dy = to.lat - from.lat;

  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px, py) * METERS_PER_DEGREE;

  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSq));
  return Math.hypot(px - t * dx, py - t * dy) * METERS_PER_DEGREE;
}

function simplifyTrace(points, epsilonM) {
  if (points.length <= 2) return [...points];

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop();
    if (last <= first + 1) continue;

    let farthest = -1;
    let maxDistance = 0;
    for (let i = first + 1; i < last; i += 1) {
      const d = perpendicularM(points[i], points[first], points[last]);
      if (d > maxDistance) {
        maxDistance = d;
        farthest = i;
      }
    }

    if (maxDistance > epsilonM && farthest > 0) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }

  return points.filter((_, i) => keep[i] === 1);
}

function encodeSigned(value, out) {
  let v = value < 0 ? ~(value << 1) : value << 1;
  while (v >= 0x20) {
    out.push(String.fromCharCode((0x20 | (v & 0x1f)) + 63));
    v >>>= 5;
  }
  out.push(String.fromCharCode(v + 63));
}

function encodePolyline(points) {
  const out = [];
  let prevLat = 0;
  let prevLng = 0;
  for (const point of points) {
    const lat = Math.round(point.lat * 1e5);
    const lng = Math.round(point.lng * 1e5);
    encodeSigned(lat - prevLat, out);
    encodeSigned(lng - prevLng, out);
    prevLat = lat;
    prevLng = lng;
  }
  return out.join('');
}

const MAX_ROUTE_POINTS = 600;

function encodeRoute(points) {
  if (points.length < 2) return '';
  let simplified = simplifyTrace(points, 6);
  for (let epsilon = 12; simplified.length > MAX_ROUTE_POINTS && epsilon <= 200; epsilon *= 2) {
    simplified = simplifyTrace(points, epsilon);
  }
  return encodePolyline(simplified);
}

/* ── A szkript ────────────────────────────────────────────────────── */

const privacyCache = new Map();

async function privacyFor(uid) {
  if (privacyCache.has(uid)) return privacyCache.get(uid);
  const snapshot = await db.collection('users').doc(uid).get();
  const stored = snapshot.exists ? (snapshot.data().privacy ?? {}) : {};
  const settings = { ...DEFAULT_PRIVACY, ...stored };
  privacyCache.set(uid, settings);
  return settings;
}

async function main() {
  console.log(`adatbázis: ${DATABASE_ID}`);
  console.log(apply ? 'MÓD: írás' : 'MÓD: száraz futás (nem ír semmit)');
  console.log('');

  const activities = await db.collection('activities').get();
  let done = 0;
  let skipped = 0;
  let empty = 0;

  for (const doc of activities.docs) {
    const data = doc.data();

    if (typeof data.route === 'string' && data.route.length > 0 && !force) {
      skipped += 1;
      continue;
    }

    const track = await doc.ref.collection('private').doc('track').get();
    const points = track.exists ? (track.data().points ?? []) : [];
    if (points.length < 2) {
      console.log(`${doc.id}  — nincs eltárolt nyomvonal, kihagyva`);
      skipped += 1;
      continue;
    }

    const settings = await privacyFor(String(data.userId ?? ''));
    const trimmed = trimPrivateEnds(points, settings);
    const route = encodeRoute(trimmed);

    if (route.length === 0) empty += 1;
    console.log(
      `${doc.id}  ${points.length} pont → ${trimmed.length} levágás után → ` +
        `${route.length} karakter${route.length === 0 ? '  (teljesen a védőkörön belül)' : ''}`,
    );

    if (apply) {
      await doc.ref.set({ route, routeHidden: route.length === 0 }, { merge: true });
    }
    done += 1;
  }

  console.log('');
  console.log(`Feldolgozva: ${done}, kihagyva: ${skipped}, teljesen rejtve: ${empty}`);
  if (!apply && done > 0) console.log('Futtasd újra a --apply kapcsolóval, ha rendben van.');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
