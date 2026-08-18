import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { cellToBoundary } from 'h3-js';
import type { CellId } from '@/types';
import { useThemeContext } from '@/hooks/ThemeProvider';
import { mapStyleFor } from '@/lib/theme';
import { mapboxConfigured, mapboxToken } from '@/lib/mapbox';
import type { HexRole } from './HexMap';
import {
  RIVAL_MAX_COLOR,
  ROLE_COLOR,
  ROLE_FILL_OPACITY,
  ROLE_LINE_OPACITY,
} from '@/lib/hexColors';
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
  layers?: { role: HexRole; cells: Iterable<CellId | MapHexCell> }[];
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
  /** Koppintás egy FOGLALT mezőre. A szabad mezőkre nem sül el. */
  onCellPress?: (info: { cell: CellId; owner: string }) => void;
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
  onCellPress,
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
  /** A Mapbox `load` később fut le, ezért mindig a legfrissebb propokat olvassa. */
  const trackRef = useRef(track);
  const layersRef = useRef(layers);
  const fitTrackRef = useRef(fitTrack);
  trackRef.current = track;
  layersRef.current = layers;
  fitTrackRef.current = fitTrack;
  /** Refben, hogy a térkép ne épüljön újra, ha a hívó új függvényt ad. */
  const viewportRef = useRef(onViewport);
  viewportRef.current = onViewport;
  const pressRef = useRef(onCellPress);
  pressRef.current = onCellPress;

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

    /**
     * A Mapbox vászna saját pixelméretet tart nyilván. Ha csak a konténer CSS
     * magassága változik (például az aktivitástérkép teljes képernyőre nyílik),
     * a vászon magától a régi 46dvh méreten maradhat. A resize observer minden
     * ilyen elrendezésváltozás után szinkronizálja a WebGL vásznat.
     */
    const resizeObserver = new ResizeObserver(() => instance.resize());
    resizeObserver.observe(container.current);

    instance.on('load', () => {
      ready.current = true;
      addLayers(instance);
      syncData(instance, trackRef.current, layersRef.current);
      fitTrackOnce(instance, trackRef.current, fitTrackRef.current, fitted);
      report(instance);
    });

    instance.on('moveend', () => report(instance));

    /**
     * Koppintás egy mezőre → a tulajdonos kártyája.
     *
     * A kattintást a KITÖLTÉS rétegére kötjük, nem a térképre: így a Mapbox
     * maga mondja meg, melyik hatszögre esett, és nem kell koordinátából
     * visszafejtenünk. A szabad mezőknek nincs tulajdonosuk, azokra nem sül el.
     */
    instance.on('click', `${CELL_SOURCE}-fill`, (event) => {
      const feature = event.features?.[0];
      const owner = String(feature?.properties?.owner ?? '');
      const cell = String(feature?.properties?.cell ?? '');
      if (!owner || !cell) return;
      pressRef.current?.({ cell, owner });
    });

    // Kézkurzor a foglalt mezők fölött — jelzi, hogy van mire koppintani.
    instance.on('mouseenter', `${CELL_SOURCE}-fill`, () => {
      instance.getCanvas().style.cursor = 'pointer';
    });
    instance.on('mouseleave', `${CELL_SOURCE}-fill`, () => {
      instance.getCanvas().style.cursor = '';
    });

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
      resizeObserver.disconnect();
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
      syncData(instance, trackRef.current, layersRef.current);
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
    fitTrackOnce(instance, track, fitTrack, fitted);
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

export interface MapHexCell {
  cell: CellId;
  /** A foglalt mező védettsége. Ha nincs megadva, 1-esnek tekintjük. */
  defense?: number;
  /** Élő, még nem hiteles foglalási előnézet: kitöltött, de szintszám nélkül. */
  preview?: boolean;
  /** A mező tulajdonosa — a koppintásra megjelenő kártyához. */
  owner?: string;
}

function fitTrackOnce(
  instance: mapboxgl.Map,
  track: MapViewProps['track'],
  enabled: boolean,
  fitted: { current: boolean },
): void {
  if (!enabled || fitted.current || !track || track.length < 2) return;
  fitted.current = true;
  const bounds = new mapboxgl.LngLatBounds();
  for (const point of track) bounds.extend([point.lng, point.lat]);
  instance.fitBounds(bounds, { padding: 48, duration: 0, maxZoom: 17 });
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
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 1.2,
        // A szabad háttérháló sokkal halványabb, az aktív/foglalt cellák
        // határa viszont továbbra is egyértelmű marad.
        'line-opacity': ['coalesce', ['get', 'lineOpacity'], 0.85],
      },
    });
    /**
     * A védelmi szint száma a mezőn.
     *
     * ZOOM SZERINT HALVÁNYUL, nem hirtelen tűnik el. Korábban `minzoom: 17.5`
     * volt, vagyis a számok egyik pillanatról a másikra kapcsoltak be — és
     * csak nagyon közelről. Így viszont a felhasználó már távolabbról látja,
     * hol vannak erős mezők, és kifelé zoomolva a felirat fokozatosan olvad
     * a háttérbe ahelyett, hogy olvashatatlan pöttyökké sűrűsödne.
     *
     * A `minzoom` 15-re csökken, a betű pedig zoommal együtt nő — távolabb
     * apró, közelről jól olvasható.
     */
    instance.addLayer({
      id: `${CELL_SOURCE}-defense-label`,
      type: 'symbol',
      source: CELL_SOURCE,
      minzoom: 15,
      layout: {
        'text-field': ['get', 'defenseLabel'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 15, 8, 17.5, 12, 20, 15],
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-allow-overlap': false,
        'text-ignore-placement': false,
      },
      paint: {
        'text-color': ['get', 'labelColor'],
        'text-halo-color': ['get', 'labelHaloColor'],
        'text-halo-width': 1.2,
        // 15-ös zoomnál épphogy dereng, 17,5-nél teljesen olvasható.
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 0.35, 17.5, 1],
      },
    });
  }

  if (!instance.getSource(TRACK_SOURCE)) {
    instance.addSource(TRACK_SOURCE, { type: 'geojson', data: emptyCollection() });
    instance.addLayer({
      id: `${TRACK_SOURCE}-line`,
      type: 'line',
      source: TRACK_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': cssColor(ROLE_COLOR.trail), 'line-width': 4 },
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
      for (const entry of layer.cells) {
        const cell = typeof entry === 'string' ? entry : entry.cell;
        const defense = clampDefense(typeof entry === 'string' ? 1 : entry.defense ?? 1);
        const preview = typeof entry !== 'string' && entry.preview === true;
        const territory = layer.role === 'rival' || layer.role === 'interior' || layer.role === 'stolen';
        const color = layer.role === 'rival' && defense === 5
          ? cssColor(RIVAL_MAX_COLOR)
          : cssColor(ROLE_COLOR[layer.role]);
        const opacity = preview
          ? ROLE_FILL_OPACITY.interior
          : territory
            ? cssNumber(`--defense-alpha-${defense}`, defense === 1 ? 0 : 0.2)
            : ROLE_FILL_OPACITY[layer.role];
        features.push({
          type: 'Feature' as const,
          properties: {
            cell,
            owner: typeof entry === 'string' ? '' : (entry.owner ?? ''),
            color,
            opacity,
            lineOpacity: ROLE_LINE_OPACITY[layer.role],
            /**
             * Az 1-es mezők is kapnak számot.
             *
             * Korábban csak a 2-estől felfelé látszott felirat, amitől a
             * frissen szerzett mező „jelöletlennek" tűnt — pedig az is
             * birtok, csak a leggyengébb szinten. Így a térkép egységes: ami
             * a tiéd vagy a riválisé, azon mindig ott a szintje.
             */
            defenseLabel: territory && !preview ? String(defense) : '',
            labelColor: defense >= 4
              ? cssColor('var(--territory-label-strong)')
              : cssColor('var(--text-primary)'),
            labelHaloColor: defense >= 4 ? 'rgba(0, 0, 0, 0.45)' : cssColor('var(--bg-elevated)'),
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

function clampDefense(value: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(5, Math.max(1, Math.round(value))) as 1 | 2 | 3 | 4 | 5;
}

/** Egy `var(--token)` hivatkozás tényleges, aktuális témabeli értéke. */
function cssColor(reference: string): string {
  const match = /^var\((--[^)]+)\)$/.exec(reference);
  if (!match || typeof document === 'undefined') return reference;
  return getComputedStyle(document.documentElement).getPropertyValue(match[1]!).trim();
}

function cssNumber(name: string, fallback: number): number {
  if (typeof document === 'undefined') return fallback;
  const value = Number(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
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
