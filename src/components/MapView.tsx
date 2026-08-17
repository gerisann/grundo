import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { cellToBoundary } from 'h3-js';
import type { CellId } from '@/types';
import { useThemeContext } from '@/hooks/ThemeProvider';
import { mapStyleFor } from '@/lib/theme';
import { mapboxConfigured, mapboxToken } from '@/lib/mapbox';
import type { HexRole } from './HexMap';
import 'mapbox-gl/dist/mapbox-gl.css';
import './mapview.css';

/**
 * Utcatérkép a nyomvonallal, a hexagonokkal és a jelenlegi pozícióval.
 *
 * Miért külön a `HexMap`-től, és miért nem cseréli le? Mert a kettő más
 * feladatra jó. A `HexMap` token nélkül is működik, és pontosan azt mutatja,
 * amit a motor számol — a fejlesztői visszajátszóhoz ez kell. Ez a komponens
 * viszont a felhasználónak szól: utcákkal, tájékozódási pontokkal.
 *
 * Ha nincs Mapbox-token, ez a komponens NEM renderel semmit — a hívó dolga
 * visszaesni a `HexMap`-re. Így egy hiányzó token nem üres képernyőt okoz.
 *
 * BETÖLTÉS: a mapbox-gl saját csomagja 1,87 MB, tömörítve is 521 kB — hatszor
 * annyi, mint az app teljes belépő csomagja. A hívó KÖTELEZŐEN lustán töltse be
 * (`React.lazy`), különben minden felhasználó fizet érte a belépéskor is.
 */

export interface MapViewProps {
  track?: readonly { lat: number; lng: number }[];
  layers?: { role: HexRole; cells: Iterable<CellId> }[];
  /** A jelenlegi pozíció. Külön a nyomvonaltól: szünet alatt is mutatjuk. */
  position?: { lat: number; lng: number } | null;
  /** Kövesse-e a térkép a pozíciót. */
  follow?: boolean;
  height?: number;
  /** Töltse ki a szülőt — teljes képernyős háttérként. */
  fill?: boolean;
}

/** A hexagonok színe szerepenként — ugyanaz a jelentés, mint a HexMap-ben. */
const ROLE_COLOR: Record<HexRole, string> = {
  trail: '#8b5cf6',
  interior: '#7c3aed',
  rival: '#ef4444',
  stolen: '#f59e0b',
};

const TRACK_SOURCE = 'grundo-track';
const CELL_SOURCE = 'grundo-cells';

export function MapView({
  track,
  layers,
  position,
  follow = true,
  height = 320,
  fill = false,
}: MapViewProps) {
  const { theme } = useThemeContext();
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const marker = useRef<mapboxgl.Marker | null>(null);
  const ready = useRef(false);
  /** Az ELSŐ pozícióra ugrunk, nem odaúszunk — lásd lejjebb. */
  const centered = useRef(false);

  /* ── A térkép létrehozása, egyszer ─────────────────────────────── */

  useEffect(() => {
    if (!mapboxConfigured || container.current === null || map.current !== null) return;

    mapboxgl.accessToken = mapboxToken;
    const instance = new mapboxgl.Map({
      container: container.current,
      style: mapStyleFor(theme),
      center: [19.0402, 47.4979], // Budapest — amíg nincs pozíció
      zoom: 15,
      attributionControl: true,
      // A látványos, de a tájékozódást nem segítő elemeket kikapcsoljuk:
      // rögzítés közben a felhasználó futás közben, egy pillantásra néz rá.
      pitchWithRotate: false,
      dragRotate: false,
    });

    instance.on('load', () => {
      ready.current = true;
      addLayers(instance);
      syncData(instance, track, layers);
    });

    map.current = instance;

    return () => {
      ready.current = false;
      marker.current?.remove();
      marker.current = null;
      instance.remove();
      map.current = null;
    };
    // Szándékosan üres: a térkép egyszer jön létre. A stílust, az adatot és a
    // pozíciót külön hatások frissítik — újraépítés nélkül.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Témaváltás ────────────────────────────────────────────────── */

  useEffect(() => {
    const instance = map.current;
    if (instance === null || !ready.current) return;

    /**
     * A `setStyle` ELDOBJA az összes saját forrást és réteget — a Mapbox a
     * stílust teljes egészében kicseréli. Ezért a `style.load` esemény után
     * mindent újra fel kell venni, különben témaváltáskor eltűnne a nyomvonal.
     */
    const restore = () => {
      addLayers(instance);
      syncData(instance, track, layers);
    };
    instance.once('style.load', restore);
    instance.setStyle(mapStyleFor(theme));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  /* ── Adatfrissítés ─────────────────────────────────────────────── */

  useEffect(() => {
    const instance = map.current;
    if (instance === null || !ready.current) return;
    syncData(instance, track, layers);
  }, [track, layers]);

  /* ── Pozíció és követés ────────────────────────────────────────── */

  useEffect(() => {
    const instance = map.current;
    if (instance === null || position == null) return;

    if (marker.current === null) {
      const dot = document.createElement('div');
      dot.className = 'mapview__dot';
      marker.current = new mapboxgl.Marker({ element: dot })
        .setLngLat([position.lng, position.lat])
        .addTo(instance);
    } else {
      marker.current.setLngLat([position.lng, position.lat]);
    }

    /**
     * Az ELSŐ pozíciónál ugrunk, utána úszunk.
     *
     * Indításkor a térkép egy alapértelmezett ponton áll, ami tetszőlegesen
     * messze lehet. Odaúszni fél másodperc alatt fél országon át értelmetlen
     * animáció — ott viszont már zavaró lenne az ugrálás, ezért utána `easeTo`.
     */
    if (!centered.current) {
      centered.current = true;
      instance.jumpTo({ center: [position.lng, position.lat], zoom: 16 });
      return;
    }

    if (follow) {
      instance.easeTo({ center: [position.lng, position.lat], duration: 600 });
    }
  }, [position, follow]);

  if (!mapboxConfigured) return null;

  return (
    <div
      ref={container}
      className="mapview"
      style={fill ? { height: '100%' } : { height }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Rétegek és adat
   ═══════════════════════════════════════════════════════════════════ */

function addLayers(instance: mapboxgl.Map): void {
  if (!instance.getSource(CELL_SOURCE)) {
    instance.addSource(CELL_SOURCE, { type: 'geojson', data: emptyCollection() });
    instance.addLayer({
      id: `${CELL_SOURCE}-fill`,
      type: 'fill',
      source: CELL_SOURCE,
      paint: {
        // A szín a jellemzőből jön, hogy egyetlen réteg elég legyen minden
        // szerephez — különben szerepenként külön forrás és réteg kellene.
        'fill-color': ['get', 'color'],
        'fill-opacity': 0.35,
      },
    });
    instance.addLayer({
      id: `${CELL_SOURCE}-line`,
      type: 'line',
      source: CELL_SOURCE,
      paint: { 'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': 0.8 },
    });
  }

  if (!instance.getSource(TRACK_SOURCE)) {
    instance.addSource(TRACK_SOURCE, { type: 'geojson', data: emptyCollection() });
    instance.addLayer({
      id: `${TRACK_SOURCE}-line`,
      type: 'line',
      source: TRACK_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#7c3aed', 'line-width': 4 },
    });
  }
}

function syncData(
  instance: mapboxgl.Map,
  track: MapViewProps['track'],
  layers: MapViewProps['layers'],
): void {
  const cellSource = instance.getSource(CELL_SOURCE) as mapboxgl.GeoJSONSource | undefined;
  if (cellSource) {
    const features = [];
    for (const layer of layers ?? []) {
      for (const cell of layer.cells) {
        features.push({
          type: 'Feature' as const,
          properties: { color: ROLE_COLOR[layer.role] },
          geometry: {
            type: 'Polygon' as const,
            // A h3 [szélesség, hosszúság] párokat ad, a GeoJSON viszont
            // [hosszúság, szélesség] sorrendet vár. Felcserélve az egész
            // rács a Föld túloldalára kerülne.
            coordinates: [cellToBoundary(cell).map(([lat, lng]) => [lng, lat])],
          },
        });
      }
    }
    cellSource.setData({ type: 'FeatureCollection', features });
  }

  const trackSource = instance.getSource(TRACK_SOURCE) as mapboxgl.GeoJSONSource | undefined;
  if (trackSource) {
    const coordinates = (track ?? []).map((p) => [p.lng, p.lat]);
    trackSource.setData({
      type: 'FeatureCollection',
      features:
        coordinates.length >= 2
          ? [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates },
              },
            ]
          : [],
    });
  }
}

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}
