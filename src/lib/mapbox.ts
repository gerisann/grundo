/**
 * A Mapbox-token — SZÁNDÉKOSAN külön a `MapView`-tól.
 *
 * A rögzítés képernyője lustán tölti be a térképet, de előbb el kell döntenie,
 * hogy egyáltalán van-e token. Ha ezt a `MapView`-ból importálná, a statikus
 * import behúzná a `mapbox-gl`-t a belépő csomagba — és a lusta betöltés
 * pontosan azt az 521 kB-ot nem spórolná meg, amiért csináltuk.
 *
 * Ez a fájl semmit nem importál, tehát bárhonnan olcsón kérdezhető.
 */

export const mapboxToken = (import.meta.env.VITE_MAPBOX_TOKEN ?? '').trim();

export const mapboxConfigured = mapboxToken.length > 0;
