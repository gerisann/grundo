/**
 * Kódolt vonallánc (Google „encoded polyline", 5 tizedes pontosság).
 *
 * MIÉRT KELL? Az aktivitás nyomvonalát két helyen is át kell adni: a
 * feed-kártya térképképéhez és a részletek nézethez. Nyers pontlistaként
 * ez drága lenne — egy 5 km-es futás szűrés után is 1500+ pont, ami
 * pontpáronként két lebegőpontos szám a dokumentumban és a válaszban.
 *
 * A kódolt alak ugyanezt EGYETLEN sztringben tárolja, pontonként ~5
 * karakterrel: nagyságrenddel kisebb, és a Firestore-ban is egy mező marad.
 * (A Firestore ráadásul NEM enged tömböt tömbben, tehát a `[[lat,lng], …]`
 * alak eleve kizárt — vagy lapított számtömb, vagy sztring lehetne.)
 *
 * Ráadásul a Mapbox Static Images API pontosan ezt a formátumot fogadja el
 * útvonal-rátétként, tehát a kártyák térképképéhez külön átalakítás sem kell.
 *
 * A pontosság 1e-5 fok ≈ 1,1 méter. A GPS-hiba ennek a többszöröse, tehát a
 * kerekítés semmit nem visz el a megjelenítésből.
 */

const PRECISION = 1e5;

/** Egyetlen előjeles egész a Google-féle base64-változatban. */
function encodeSigned(value: number, out: string[]): void {
  // Cikk-cakk kódolás: az előjelet a legalsó bitbe tesszük.
  let v = value < 0 ? ~(value << 1) : value << 1;
  while (v >= 0x20) {
    out.push(String.fromCharCode((0x20 | (v & 0x1f)) + 63));
    v >>>= 5;
  }
  out.push(String.fromCharCode(v + 63));
}

export function encodePolyline(points: readonly { lat: number; lng: number }[]): string {
  const out: string[] = [];
  let prevLat = 0;
  let prevLng = 0;

  for (const point of points) {
    // A KÜLÖNBSÉGET kódoljuk, nem az abszolút értéket — szomszédos GPS-pontok
    // között a különbség kicsi, tehát kevés karakterre fér.
    const lat = Math.round(point.lat * PRECISION);
    const lng = Math.round(point.lng * PRECISION);
    encodeSigned(lat - prevLat, out);
    encodeSigned(lng - prevLng, out);
    prevLat = lat;
    prevLng = lng;
  }

  return out.join('');
}

export function decodePolyline(encoded: string): { lat: number; lng: number }[] {
  const points: { lat: number; lng: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    for (let coordinate = 0; coordinate < 2; coordinate += 1) {
      let shift = 0;
      let result = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index) - 63;
        index += 1;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length);

      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (coordinate === 0) lat += delta;
      else lng += delta;
    }
    points.push({ lat: lat / PRECISION, lng: lng / PRECISION });
  }

  return points;
}

/**
 * Ramer–Douglas–Peucker ritkítás.
 *
 * MIÉRT NEM MINDEN N-EDIK PONT? Mert az a KANYAROKAT vágja le. Egy egyenes
 * szakaszon minden köztes pont fölösleges, egy éles fordulóban viszont
 * mindegyik számít — az egyenletes ritkítás pont fordítva bánik velük, és
 * a nyomvonal levágott sarkokkal, „szögletesen" jelenik meg.
 *
 * Az RDP azt a pontot tartja meg, amelyik a legjobban eltér az egyenestől,
 * tehát pontosan a kanyarokat őrzi meg, és az egyeneseket dobja el.
 *
 * Az `epsilonM` alapértéke 6 méter: a GPS-hiba nagyságrendje alatt marad,
 * tehát a megjelenítésben nem látszik a különbség, cserébe egy városi
 * nyomvonalból tipikusan a pontok 5–10 %-a marad.
 */
export function simplifyTrace<T extends { lat: number; lng: number }>(
  points: readonly T[],
  epsilonM = 6,
): T[] {
  if (points.length <= 2) return [...points];

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // Iteratív, nem rekurzív: egy több ezer pontos nyomvonalnál a rekurzió
  // legrosszabb esetben a hívási vermet meríti ki.
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;

    let farthest = -1;
    let maxDistance = 0;
    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicularM(points[i]!, points[first]!, points[last]!);
      if (distance > maxDistance) {
        maxDistance = distance;
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

/** Méter a szakasztól — sík közelítés, ami néhány száz méteren pontos. */
const METERS_PER_DEGREE = 111_320;

function perpendicularM(
  point: { lat: number; lng: number },
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  // A hosszúsági fokok a szélességgel arányosan rövidülnek; enélkül a
  // ritkítás az északi–déli irányt eltúlozná.
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
