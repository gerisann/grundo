/**
 * Térképkép a feed-kártyákhoz — Mapbox Static Images API.
 *
 * MIÉRT NEM A `MapView`? Mert a `MapView` minden példánya egy önálló WebGL
 * kontextust foglal, a böngészők pedig laponként nagyjából tizenhatot
 * engednek. Egy húsz kártyás feed ettől nem lassú lenne, hanem eltörne: a
 * tizenhetedik térkép egyszerűen nem jelenne meg. Ráadásul a `mapbox-gl`
 * csomag 521 kB tömörítve — a feed-kártyáért ezt betölteni aránytalan.
 *
 * A statikus kép ehelyett egyetlen `<img>`: nincs JavaScript, a böngésző
 * gyorsítótárazza, és `loading="lazy"` mellett a képernyőn kívüli kártyák
 * semmibe sem kerülnek.
 *
 * KORLÁT, amivel számolni kell: a Mapbox ingyenes kerete havi 50 000 statikus
 * kép. Húsz kártyás feednél ez ~2500 feed-betöltés havonta (a gyorsítótárból
 * kiszolgáltak nélkül). Amikor ez kevés lesz, a következő lépés a szerveren
 * generált és tárolt előnézeti kép — a specifikáció eleve ezt írja le
 * („automatikusan generált térképkép").
 */

import { decodePolyline, encodePolyline, simplifyTrace } from '@/game/polyline';
import { mapboxToken } from '@/lib/mapbox';
import type { Theme } from '@/lib/theme';

/**
 * Ennyi pont fér el biztonságosan az URL-ben.
 *
 * A kódolt nyomvonal karaktereinek nagyjából a fele URL-ben nem biztonságos,
 * és százalékos kódolással háromszorosára nő. A Mapbox 8192 karakteres
 * korlátjánál ez ~150 pontnál kezd szűkös lenni — egy 400 képpont széles
 * kártyán viszont ennél több pont már nem is látszik.
 */
const THUMBNAIL_POINTS = 150;

const STROKE = { width: 4, color: '7c3aed', opacity: 1 };

/**
 * A `mapbox://styles/user/id` alakot a statikus API `user/id` alakra várja.
 * A beépített stílusoknál ez `mapbox/light-v11`.
 */
function styleSlug(style: string): string {
  return style.replace(/^mapbox:\/\/styles\//, '');
}

function mapStyle(theme: Theme): string {
  const light = import.meta.env.VITE_MAPBOX_STYLE_LIGHT;
  const dark = import.meta.env.VITE_MAPBOX_STYLE_DARK;
  return theme === 'dark'
    ? dark || 'mapbox://styles/mapbox/dark-v11'
    : light || 'mapbox://styles/mapbox/light-v11';
}

export interface StaticMapOptions {
  width?: number;
  height?: number;
  theme: Theme;
}

/**
 * Az útvonal térképképének címe, vagy `null`, ha nincs mit mutatni.
 *
 * A `null` nem hiba: ez a normális válasz akkor is, ha nincs Mapbox-token
 * (fejlesztői környezet), és akkor is, ha az egész aktivitás a privát
 * védőkörön belül zajlott. A hívó ilyenkor a saját tartalék felületét mutatja.
 */
export function routeImageUrl(
  encodedRoute: string,
  { width = 640, height = 260, theme }: StaticMapOptions,
): string | null {
  if (!mapboxToken || encodedRoute.length === 0) return null;

  const thumbnail = thinRoute(encodedRoute);
  if (thumbnail.length === 0) return null;

  const path = `path-${STROKE.width}+${STROKE.color}-${STROKE.opacity}(${encodeURIComponent(thumbnail)})`;

  // `auto` = a Mapbox illeszti a kivágást a nyomvonalra; `@2x` a retina
  // kijelzőkhöz. A logót és az attribúciót SZÁNDÉKOSAN nem kapcsoljuk ki:
  // a Mapbox feltételei megkövetelik a feltüntetésüket.
  return (
    `https://api.mapbox.com/styles/v1/${styleSlug(mapStyle(theme))}/static/` +
    `${path}/auto/${Math.round(width)}x${Math.round(height)}@2x` +
    `?padding=24&access_token=${mapboxToken}`
  );
}

/** A nyomvonal ritkítása kártyaméretre — az URL hosszkorlátja miatt. */
function thinRoute(encodedRoute: string): string {
  const points = decodePolyline(encodedRoute);
  if (points.length <= THUMBNAIL_POINTS) return encodedRoute;

  let thinned = points;
  for (let epsilon = 15; thinned.length > THUMBNAIL_POINTS && epsilon <= 500; epsilon *= 2) {
    thinned = simplifyTrace(points, epsilon);
  }

  return encodePolyline(thinned);
}
