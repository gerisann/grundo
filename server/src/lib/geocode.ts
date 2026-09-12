/**
 * Címkeresés az útvonaltervezéshez — KÉT Mapbox-végpont összefésülve.
 *
 * ⚠️ EGYIK SEM ELÉG ÖNMAGÁBAN, ez mérésből derült ki (2026-09-12, az
 * Útvonal-laborban):
 *
 *   - a **Geocoding v6** PONTOS NÉVEGYEZÉST keres. A „deák tér” ezért csak a
 *     csepeli Deák teret találja meg, a Deák FERENC teret nem — a neve nem
 *     egyezik. Házszámos címre viszont ez a jó.
 *   - a **Search Box forward** helyneveket és POI-kat is ad, és ő megtalálja a
 *     Deák Ferenc teret — viszont utcanevekre szűkszavúbb.
 *
 * A kettő uniója, koordináta szerint deduplikálva, TÁVOLSÁG szerint rendezve
 * adja azt, amit a felhasználó vár.
 *
 * ⚠️ A TALÁLATOT NEM TÁROLJUK EL. A cím a keresés eredményeként átmegy a
 * kliensnek, ott a térképre kerül, és a folyamat végén eltűnik — ez a Mapbox
 * feltételei szerint megengedett használat. A TARTÓS TÁROLÁS külön
 * jogosultságot igényel, és nyitott kérdés (lásd
 * `docs/routing/point-to-point.md` → Geocoding). Amíg nem tisztázott, a mentett
 * útvonal a KOORDINÁTÁT tárolja és a felhasználó saját elnevezését, a Mapbox
 * címkéjét nem.
 *
 * ⚠️ A GEOCODING KÜLÖN SZÁMLÁZÓDIK, nem fér a térkép-betöltési keretbe. Ezért
 * van gyorsítótár, és ezért nem nyitott végpont — hitelesítés mögött van.
 */

import { distanceM, type LatLng } from '../../../src/game/geo';

export interface SearchHit {
  label: string;
  lat: number;
  lng: number;
  distanceM: number;
}

/**
 * Meddig él egy találat a gyorsítótárban.
 *
 * A közterületek neve nem változik naponta, a keresés viszont pénzbe kerül —
 * a gépelés közbeni ismételt lekérdezés (ugyanaz a szó, ugyanaz a környék) így
 * egyszer fizetődik meg.
 */
const TTL_MS = 60 * 60 * 1000;

/** Védőkorlát a memóriára; a legrégebbi esik ki. */
const MAX_ENTRIES = 500;

/**
 * A közelség kerekítése a gyorsítótár kulcsában.
 *
 * 2 tizedes ≈ 1 km. Ennél finomabbnál a cache lényegében sosem találna (a
 * térkép közepe minden mozdulattal változik), durvábbnál a szomszéd város
 * találatait kapnánk vissza.
 */
const NEAR_GRID = 100;

interface Cached {
  at: number;
  results: SearchHit[];
}

const cache = new Map<string, Cached>();

interface MapboxFeature {
  properties?: {
    full_address?: string;
    place_formatted?: string;
    name?: string;
  };
  geometry?: { coordinates?: [number, number] };
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    /* Időtúllépés vagy hálózati hiba — a MÁSIK forrás még adhat találatot. */
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Egy Mapbox-találat egységes alakra hozása. */
function toHit(feature: MapboxFeature, origin: LatLng): SearchHit | null {
  const properties = feature.properties ?? {};
  const name = properties.name ?? '';
  const context = properties.full_address ?? properties.place_formatted ?? '';
  // A `place_formatted` gyakran megismétli a nevet — ilyenkor elég egyszer.
  const label = !name
    ? context
    : !context || context.startsWith(name)
      ? context || name
      : `${name} — ${context}`;

  const lng = feature.geometry?.coordinates?.[0];
  const lat = feature.geometry?.coordinates?.[1];
  if (!label || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    label,
    lat: lat as number,
    lng: lng as number,
    distanceM: Math.round(distanceM(origin, { lat: lat as number, lng: lng as number })),
  };
}

export function geocodeConfigured(): boolean {
  return (process.env.MAPBOX_TOKEN ?? '').trim().length > 0;
}

export async function searchPlaces(query: string, origin: LatLng): Promise<SearchHit[]> {
  const token = (process.env.MAPBOX_TOKEN ?? '').trim();
  if (!token) return [];

  const trimmed = query.trim();
  /* Két karakter alatt minden találat zaj lenne — és fölöslegesen fizetnénk. */
  if (trimmed.length < 3) return [];

  const cacheKey =
    `${trimmed.toLowerCase()}|` +
    `${Math.round(origin.lat * NEAR_GRID)},${Math.round(origin.lng * NEAR_GRID)}`;

  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.results;

  const near = `${origin.lng},${origin.lat}`;
  const common =
    `?q=${encodeURIComponent(trimmed)}` +
    `&access_token=${encodeURIComponent(token)}` +
    `&proximity=${encodeURIComponent(near)}` +
    '&limit=8&language=hu&country=hu';

  const [addresses, places] = await Promise.all([
    fetchJson(`https://api.mapbox.com/search/geocode/v6/forward${common}&autocomplete=true`),
    fetchJson(`https://api.mapbox.com/search/searchbox/v1/forward${common}`),
  ]);

  const results: SearchHit[] = [];
  const seen = new Set<string>();
  for (const source of [places, addresses]) {
    for (const feature of (source?.features as MapboxFeature[]) ?? []) {
      const parsed = toHit(feature, origin);
      if (!parsed) continue;
      // ~11 méteres azonossági küszöb: ugyanaz a hely kétszer ne szerepeljen.
      const key = `${parsed.lat.toFixed(4)},${parsed.lng.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(parsed);
    }
  }

  /*
    ⚠️ TÁVOLSÁG SZERINT RENDEZÜNK, nem a szolgáltató relevanciája szerint.
    Mérve: a „Blaha Lujza tér” keresésre budapesti nézetből is Kiskunfélegyháza
    jött elsőnek — a Mapbox a pontos névegyezést erősebbnek látja a
    proximity-nél. Útvonaltervezéshez viszont majdnem mindig a közeli találat a
    keresett.
  */
  results.sort((a, b) => a.distanceM - b.distanceM);
  const top = results.slice(0, 8);

  /* Üres találatot NEM tárolunk: lehet átmeneti hálózati hiba is. */
  if (top.length > 0) {
    if (cache.size >= MAX_ENTRIES) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(cacheKey, { at: Date.now(), results: top });
  }

  return top;
}
