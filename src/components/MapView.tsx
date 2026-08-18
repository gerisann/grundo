import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { cellToBoundary } from 'h3-js';
import type { CellId } from '@/types';
import { useThemeContext } from '@/hooks/ThemeProvider';
import { mapStyleFor } from '@/lib/theme';
import { mapboxConfigured, mapboxToken } from '@/lib/mapbox';
import type { HexRole } from './HexMap';
import { ROLE_COLOR, ROLE_FILL_OPACITY } from '@/lib/hexColors';
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
  /**
   * Igazítsa a nézetet a nyomvonalra, amint az megérkezik.
   *
   * A rögzítésnél NEM ezt akarjuk (ott a mozgó pozíciót követjük), egy kész
   * aktivitás megjelenítésénél viszont pontosan ezt: a teljes útvonal
   * látszódjon, ne egy véletlen nagyítás egy részletén.
   */
  fitTrack?: boolean;
  height?: number;
  /** Töltse ki a szülőt — teljes képernyős háttérként. */
  fill?: boolean;
  /**
   * A látott szakasz változásakor hívjuk.
   *
   * Csak a mozgás VÉGÉN (`moveend`), nem közben: húzás alatt másodpercenként
   * több tucatszor tüzelne, és minden alkalommal lekérdezést indítana.
   */
  onViewport?: (view: { south: number; west: number; north: number; east: number; zoom: number }) => void;
}

/** A hexagonok színe szerepenként — ugyanaz a jelentés, mint a HexMap-ben. */


const TRACK_SOURCE = 'grundo-track';
const CELL_SOURCE = 'grundo-cells';

/**
 * A hatszög-forrás beállításai — mindkettőre szükség van, és mindkettő
 * egy-egy látható hibát javít.
 *
 * `tolerance: 0` — a Mapbox alapból leegyszerűsíti a geometriát csempénként
 * (alapérték 0,375 képpont): közeli csúcsokat összevon, éleket eldob. Nagy,
 * ritka alakzatoknál ez láthatatlan. A mi hatszögeink viszont 18 méteresek és
 * hat csúcsuk van — pont abban a mérettartományban, ahol az egyszerűsítés a
 * csúcsokat ELMOZDÍTJA. Ettől tüskék nőnek a sarkokon, és a szomszédos
 * hatszögek élei nem érnek össze. Nullán az eredeti geometria rajzolódik.
 *
 * `maxzoom: 22` — efölött a Mapbox nem generál új csempét, hanem a legutolsót
 * nagyítja fel. Az alapérték 18, ami egy 18 méteres hatszögnél már a valós
 * használati tartományban van: onnantól a rajz fokozatosan pontatlanná válik.
 */
const HEX_SOURCE = { tolerance: 0, maxzoom: 22 } as const;

export function MapView({
  track,
  layers,
  position,
  follow = true,
  fitTrack = false,
  height = 320,
  fill = false,
  onViewport,
}: MapViewProps) {
  const { theme } = useThemeContext();
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const marker = useRef<mapboxgl.Marker | null>(null);
  const ready = useRef(false);
  /** Az ELSŐ pozícióra ugrunk, nem odaúszunk — lásd lejjebb. */
  const centered = useRef(false);
  /** A nyomvonalra egyszer igazítunk, utána a felhasználóé a nézet. */
  const fitted = useRef(false);
  /** Refben, hogy a térkép ne épüljön újra, ha a hívó új függvényt ad. */
  const viewportRef = useRef(onViewport);
  viewportRef.current = onViewport;

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
      report(instance);
    });

    instance.on('moveend', () => report(instance));

    function report(map: mapboxgl.Map) {
      const bounds = map.getBounds();
      if (!bounds) return;
      viewportRef.current?.({
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
        zoom: map.getZoom(),
      });
    }

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

    /**
     * Egyszer igazítunk, az első valódi nyomvonalnál.
     *
     * Ha minden frissítésnél igazítanánk, a felhasználó nem tudná
     * körbenézni a térképet: minden újrarajzolás visszarántaná a kiindulási
     * nézetre.
     */
    if (fitTrack && !fitted.current && track && track.length >= 2) {
      fitted.current = true;
      const bounds = new mapboxgl.LngLatBounds();
      for (const point of track) bounds.extend([point.lng, point.lat]);
      instance.fitBounds(bounds, { padding: 48, duration: 0, maxZoom: 17 });
    }
  }, [track, layers, fitTrack]);

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
    instance.addSource(CELL_SOURCE, { type: 'geojson', data: emptyCollection(), ...HEX_SOURCE });
    instance.addLayer({
      id: `${CELL_SOURCE}-fill`,
      type: 'fill',
      source: CELL_SOURCE,
      paint: {
        // A szín a jellemzőből jön, hogy egyetlen réteg elég legyen minden
        // szerephez — különben szerepenként külön forrás és réteg kellene.
        'fill-color': ['get', 'color'],
        'fill-opacity': ['coalesce', ['get', 'opacity'], 0.2],
      },
    });
    instance.addLayer({
      id: `${CELL_SOURCE}-line`,
      type: 'line',
      source: CELL_SOURCE,
      // A körvonal viszont marad erős: ez hordozza a határt.
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.2, 'line-opacity': 0.85 },
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
          properties: {
            color: ROLE_COLOR[layer.role],
            opacity: ROLE_FILL_OPACITY[layer.role],
          },
          geometry: {
            type: 'Polygon' as const,
            // A h3 [szélesség, hosszúság] párokat ad, a GeoJSON viszont
            // [hosszúság, szélesség] sorrendet vár. Felcserélve az egész
            // rács a Föld túloldalára kerülne.
            coordinates: [closedRing(cell)],
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

/**
 * A cella határa GeoJSON-gyűrűként, ZÁRTAN.
 *
 * A `cellToBoundary` nyitott gyűrűt ad: nem ismétli meg az első csúcsot a
 * végén. A GeoJSON-szabvány viszont zárt gyűrűt ír elő — a Mapbox tolerálja a
 * nyitottat, de az utolsó él kezelése így megjósolhatatlan.
 *
 * A h3 [szélesség, hosszúság] párokat ad, a GeoJSON [hosszúság, szélesség]
 * sorrendet vár. Felcserélve az egész rács a Föld túloldalára kerülne.
 */
function closedRing(cell: CellId): [number, number][] {
  const ring = cellToBoundary(cell).map(([lat, lng]) => [lng, lat] as [number, number]);
  const first = ring[0];
  if (first) ring.push([first[0], first[1]]);
  return ring;
}

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}
