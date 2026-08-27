import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import mapboxgl from 'mapbox-gl';
import { cellToBoundary, cellToLatLng } from 'h3-js';
import type { CellId } from '@/types';
import { useThemeContext } from '@/hooks/ThemeProvider';
import { mapStyleFor } from '@/lib/theme';
import { mapboxConfigured, mapboxToken } from '@/lib/mapbox';
import { smoothBearing, trackBearing } from '@/lib/heading';
import { cellsToAreaPolygons } from '@/lib/hexAreas';
import { cellColorHex } from '@/lib/cellColors';
import type { HexRole } from './HexMap';
import {
  RIVAL_MAX_COLOR,
  ROLE_COLOR,
  ROLE_FILL_OPACITY,
  ROLE_LINE_OPACITY,
} from '@/lib/hexColors';
import 'mapbox-gl/dist/mapbox-gl.css';
import './mapview.css';

/** Utcatérkép a nyomvonallal, a hexagonokkal és a jelenlegi pozícióval. */
export interface MapViewProps {
  track?: readonly { lat: number; lng: number }[];
  ghostTrack?: readonly { lat: number; lng: number }[];
  layers?: { role: HexRole; cells: Iterable<CellId | MapHexCell> }[];
  /** uid → választott cellaszín kulcsa, a `/api/tiles` válaszából. */
  ownerColors?: Record<string, string>;
  position?: { lat: number; lng: number } | null;
  follow?: boolean;
  hideRecenter?: boolean;
  allowTilt?: boolean;
  hexesVisible?: boolean;
  onToggleHexes?: () => void;
  fitTrack?: boolean;
  height?: number;
  fill?: boolean;
  onViewport?: (view: { south: number; west: number; north: number; east: number; zoom: number }) => void;
  onCellPress?: (info: { cell: CellId; owner: string }) => void;
  cellPopup?: ReactNode;
}

const TRACK_SOURCE = 'grundo-track';
const GHOST_SOURCE = 'grundo-ghost';
const CELL_SOURCE = 'grundo-cells';
const AREA_SOURCE = 'grundo-areas';
const CELL_DETAIL_MIN_ZOOM = 15;
const HEX_SOURCE = { tolerance: 0, maxzoom: 22 } as const;
const TILTED_PITCH = 55;
const TILT_KEY = 'grundo.mapTilt';

/**
 * Követő nagyítás felülnézetben és bedöntött nézetben.
 *
 * A 3D nézet SZÁNDÉKOSAN közelebbi (Strava a mérce): bedöntve a képernyő
 * alsó harmada a felhasználó mögötti, már megtett szakasz, a felső kétharmad
 * a menetirány — ha ugyanazon a 16-os nagyításon maradna, a felhasználó egy
 * madártávlati pöttyöt nézne, amin nem látszik, melyik utcába kell befordulni.
 */
const FOLLOW_ZOOM = 16;
const TILTED_ZOOM = 17.6;

/**
 * A követő animáció hossza.
 *
 * Rövidebb kell, mint a minták közti idő (~1 s), különben az új animáció a
 * régi közben indul, és a térkép sosem ér a pozícióhoz — látható, állandó
 * lemaradás. 350 ms elég sima, és 650 ms tartalékot hagy.
 */
const FOLLOW_DURATION_MS = 350;

/**
 * A menetirány simítása.
 *
 * 0,2-ről emelve: a régi értékkel a térkép egy kanyar után 8-10 mintán
 * keresztül forgott a helyes irányba, ami futótempóban is 10 másodperc. 0,4
 * mellett három-négy minta alatt beáll, és a `trackBearing` 25 méteres
 * bázisvonala miatt még mindig nem ugrál a GPS zajától.
 */
const BEARING_SMOOTHING = 0.4;

/**
 * Ennyi pont végéből számoljuk a menetirányt.
 *
 * A `trackBearing` úgyis csak 25 méternyit megy vissza, a nyomvonal viszont
 * több ezer pont is lehet — a másodpercenkénti teljes tömbmásolás fölösleges
 * szemétgyártás lenne.
 */
const BEARING_TAIL = 64;

function readTiltPreference(): boolean {
  try {
    return localStorage.getItem(TILT_KEY) === '3d';
  } catch {
    return false;
  }
}

function writeTiltPreference(tilted: boolean): void {
  try {
    localStorage.setItem(TILT_KEY, tilted ? '3d' : '2d');
  } catch {
    /* A nézet ettől még átvált, csak nem marad meg. */
  }
}

export function MapView({
  track,
  ghostTrack,
  layers,
  ownerColors,
  position,
  follow = true,
  hideRecenter = false,
  allowTilt = false,
  hexesVisible,
  onToggleHexes,
  fitTrack = false,
  height = 320,
  fill = false,
  onViewport,
  onCellPress,
  cellPopup,
}: MapViewProps) {
  const { theme } = useThemeContext();
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const marker = useRef<mapboxgl.Marker | null>(null);
  const ready = useRef(false);
  const centered = useRef(false);
  const fitted = useRef(false);
  const trackRef = useRef(track);
  const ghostTrackRef = useRef(ghostTrack);
  const layersRef = useRef(layers);
  const ownerColorsRef = useRef(ownerColors);
  const fitTrackRef = useRef(fitTrack);
  trackRef.current = track;
  ghostTrackRef.current = ghostTrack;
  layersRef.current = layers;
  ownerColorsRef.current = ownerColors;
  fitTrackRef.current = fitTrack;
  const viewportRef = useRef(onViewport);
  viewportRef.current = onViewport;
  const pressRef = useRef(onCellPress);
  pressRef.current = onCellPress;
  const [popupHost, setPopupHost] = useState<HTMLElement | null>(null);
  const popup = useRef<mapboxgl.Popup | null>(null);
  const followPaused = useRef(false);
  const [showRecenter, setShowRecenter] = useState(false);
  const [tilted, setTilted] = useState(() => readTiltPreference());
  const bearingRef = useRef<number | null>(null);

  useEffect(() => {
    if (!mapboxConfigured || container.current === null || map.current !== null) return;

    mapboxgl.accessToken = mapboxToken;
    const instance = new mapboxgl.Map({
      container: container.current,
      style: mapStyleFor(theme),
      center: [19.0402, 47.4979],
      zoom: 15,
      attributionControl: true,
      pitchWithRotate: false,
      dragRotate: false,
      pitch: tilted ? TILTED_PITCH : 0,
      // A Mapbox alapból 300 ms-ig ÚSZTATJA BE az új csempék tartalmát. A
      // hatszögeink így a mozgás után is még egy harmad másodpercig
      // halványak — pont akkor, amikor a felhasználó azt nézi, elfoglalta-e
      // a mezőt. Nulla késleltetéssel a cella abban a pillanatban látszik,
      // amikor a rács megkapta.
      fadeDuration: 0,
    });

    const resizeObserver = new ResizeObserver(() => instance.resize());
    resizeObserver.observe(container.current);

    instance.on('load', () => {
      ready.current = true;
      addLayers(instance);
      syncData(instance, trackRef.current, ghostTrackRef.current, layersRef.current, ownerColorsRef.current);
      fitTrackOnce(instance, trackRef.current, fitTrackRef.current, fitted);
      report(instance);
    });

    instance.on('moveend', () => report(instance));

    const pauseFollow = (event: unknown) => {
      if ((event as { originalEvent?: unknown }).originalEvent === undefined) return;
      followPaused.current = true;
      setShowRecenter(true);
    };
    instance.on('dragstart', pauseFollow);
    instance.on('zoomstart', pauseFollow);
    instance.on('rotatestart', pauseFollow);

    instance.on('click', `${CELL_SOURCE}-fill`, (event) => {
      const feature = event.features?.[0];
      const owner = String(feature?.properties?.owner ?? '');
      const cell = String(feature?.properties?.cell ?? '');
      if (!owner || !cell) return;

      const [lat, lng] = cellToLatLng(cell);
      const host = document.createElement('div');
      popup.current?.remove();
      popup.current = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        maxWidth: 'none',
        offset: 14,
        className: 'mapview__popup',
      })
        .setLngLat([lng, lat])
        .setDOMContent(host)
        .addTo(instance);
      popup.current.on('close', () => setPopupHost(null));
      setPopupHost(host);
      pressRef.current?.({ cell, owner });
    });

    instance.on('mouseenter', `${CELL_SOURCE}-fill`, () => {
      instance.getCanvas().style.cursor = 'pointer';
    });
    instance.on('mouseleave', `${CELL_SOURCE}-fill`, () => {
      instance.getCanvas().style.cursor = '';
    });

    function report(target: mapboxgl.Map) {
      const bounds = target.getBounds();
      if (!bounds) return;
      viewportRef.current?.({
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
        zoom: target.getZoom(),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (instance === null || !ready.current) return;
    const restore = () => {
      addLayers(instance);
      syncData(instance, trackRef.current, ghostTrackRef.current, layersRef.current, ownerColorsRef.current);
    };
    instance.once('style.load', restore);
    instance.setStyle(mapStyleFor(theme));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null || !ready.current) return;
    syncTrackData(instance, track);
    fitTrackOnce(instance, track, fitTrack, fitted);
  }, [track, fitTrack]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null || !ready.current) return;
    syncGhostData(instance, ghostTrack);
  }, [ghostTrack]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null || !ready.current) return;
    syncAreaData(instance, layers, ownerColors);
    syncCellData(instance, layers, ownerColors);
  }, [layers, ownerColors]);

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

    if (!centered.current) {
      centered.current = true;
      instance.jumpTo({
        center: [position.lng, position.lat],
        zoom: tilted ? TILTED_ZOOM : FOLLOW_ZOOM,
      });
      return;
    }

    if (follow && !followPaused.current) {
      if (tilted) {
        /*
          A menetirányt a nyomvonal VÉGE plusz a MOSTANI pozíció adja. A
          nyomvonalba csak ötméterenként kerül pont, a pozíció viszont
          másodpercenként frissül — ha csak a nyomvonalat néznénk, az irány
          annyival maradna le, amennyivel a pötty korábban lemaradt.
        */
        const measured = trackBearing(bearingTrack(trackRef.current, position));
        if (measured !== null) {
          bearingRef.current =
            bearingRef.current === null
              ? measured
              : smoothBearing(bearingRef.current, measured, BEARING_SMOOTHING);
        }
      }
      const bearing = tilted ? bearingRef.current : null;
      instance.easeTo({
        center: [position.lng, position.lat],
        duration: FOLLOW_DURATION_MS,
        ...(bearing !== null ? { bearing } : {}),
      });
    }
  }, [position, follow, tilted]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null || !ready.current) return;
    // A nagyítást csak akkor állítjuk, ha a térkép már a felhasználón áll:
    // felcsatoláskor az alapértelmezett budapesti középpontra ráközelíteni
    // értelmetlen ugrás lenne.
    const zoom = centered.current ? { zoom: tilted ? TILTED_ZOOM : FOLLOW_ZOOM } : {};
    if (tilted) {
      instance.easeTo({ pitch: TILTED_PITCH, ...zoom, duration: 400 });
    } else {
      bearingRef.current = null;
      instance.easeTo({ pitch: 0, bearing: 0, ...zoom, duration: 400 });
    }
  }, [tilted]);

  useEffect(() => {
    if (!follow) followPaused.current = false;
  }, [follow]);

  useEffect(() => {
    if (cellPopup === null || cellPopup === undefined || cellPopup === false) {
      popup.current?.remove();
      popup.current = null;
      setPopupHost(null);
    }
  }, [cellPopup]);

  useEffect(
    () => () => {
      popup.current?.remove();
      popup.current = null;
    },
    [],
  );

  if (!mapboxConfigured) return null;

  return (
    <>
      <div
        ref={container}
        className="mapview"
        style={fill ? { height: '100%' } : { height }}
      />
      {popupHost && cellPopup ? createPortal(cellPopup, popupHost) : null}
      {onToggleHexes && hexesVisible !== undefined ? (
        <button
          type="button"
          className="mapview__hex-toggle"
          aria-pressed={hexesVisible}
          aria-label={hexesVisible ? 'Hexagonok elrejtése' : 'Hexagonok megjelenítése'}
          title={hexesVisible ? 'Hexagonok elrejtése' : 'Hexagonok megjelenítése'}
          onClick={onToggleHexes}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
            <path d="m12 2.5 8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5L12 2.5Z" />
          </svg>
        </button>
      ) : null}
      {allowTilt ? (
        <button
          type="button"
          className={`mapview__tilt${tilted ? ' mapview__tilt--on' : ''}`}
          aria-pressed={tilted}
          aria-label={tilted ? 'Felülnézet (2D)' : 'Bedöntött nézet (3D)'}
          title={tilted ? 'Felülnézet' : 'Bedöntött nézet'}
          onClick={() => {
            const next = !tilted;
            setTilted(next);
            writeTiltPreference(next);
          }}
        >
          {tilted ? '2D' : '3D'}
        </button>
      ) : null}
      {showRecenter && position && !hideRecenter ? (
        <button
          type="button"
          className="mapview__recenter"
          aria-label="Vissza a pozíciómra"
          onClick={() => {
            followPaused.current = false;
            setShowRecenter(false);
            const target = map.current;
            if (target && position) {
              target.easeTo({
                center: [position.lng, position.lat],
                zoom: tilted ? TILTED_ZOOM : FOLLOW_ZOOM,
                duration: 400,
              });
            }
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
            <circle cx="12" cy="12" r="3.2" />
            <circle cx="12" cy="12" r="8" />
            <path d="M12 1.6v3M12 19.4v3M1.6 12h3M19.4 12h3" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </>
  );
}

export interface MapHexCell {
  cell: CellId;
  defense?: number;
  preview?: boolean;
  owner?: string;
}

/**
 * A menetirány-számítás bemenete: a nyomvonal vége + az aktuális pozíció.
 *
 * Ha a pozíció már a nyomvonal utolsó pontja (mert épp az lett elfogadva),
 * nem duplázzuk meg — két egybeeső pontból a `trackBearing` úgyis `null`-t
 * adna a bázis végén.
 */
function bearingTrack(
  track: MapViewProps['track'],
  position: { lat: number; lng: number },
): { lat: number; lng: number }[] {
  const tail = (track ?? []).slice(-BEARING_TAIL);
  const last = tail[tail.length - 1];
  if (last && last.lat === position.lat && last.lng === position.lng) return tail;
  tail.push(position);
  return tail;
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

function addLayers(instance: mapboxgl.Map): void {
  if (!instance.getSource(AREA_SOURCE)) {
    instance.addSource(AREA_SOURCE, { type: 'geojson', data: emptyCollection(), ...HEX_SOURCE });
    instance.addLayer({
      id: `${AREA_SOURCE}-fill`,
      type: 'fill',
      source: AREA_SOURCE,
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': ['coalesce', ['get', 'opacity'], 0.2],
      },
    });
    instance.addLayer({
      id: `${AREA_SOURCE}-line`,
      type: 'line',
      source: AREA_SOURCE,
      layout: { 'line-join': 'round' },
      paint: {
        // A rivális terület kitöltése a tulajdonos választott színe, de a
        // külső területhatár külön piros marad.
        'line-color': ['get', 'outlineColor'],
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          ['case', ['get', 'own'], 2.2, 1.2],
          15,
          ['case', ['get', 'own'], 3.4, 2],
          18,
          ['case', ['get', 'own'], 4.2, 2.6],
        ],
        'line-opacity': 0.9,
      },
    });
  }

  if (!instance.getSource(CELL_SOURCE)) {
    instance.addSource(CELL_SOURCE, { type: 'geojson', data: emptyCollection(), ...HEX_SOURCE });
    instance.addLayer({
      id: `${CELL_SOURCE}-fill`,
      type: 'fill',
      source: CELL_SOURCE,
      minzoom: CELL_DETAIL_MIN_ZOOM,
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], CELL_DETAIL_MIN_ZOOM, 0, 16.5, 0.08],
      },
    });
    instance.addLayer({
      id: `${CELL_SOURCE}-line`,
      type: 'line',
      source: CELL_SOURCE,
      minzoom: CELL_DETAIL_MIN_ZOOM,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 1.2,
        'line-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          CELL_DETAIL_MIN_ZOOM,
          0,
          16.5,
          ['coalesce', ['get', 'lineOpacity'], 0.85],
        ],
      },
    });
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
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 0.35, 17.5, 1],
      },
    });
  }

  if (!instance.getSource(GHOST_SOURCE)) {
    instance.addSource(GHOST_SOURCE, { type: 'geojson', data: emptyCollection() });
    instance.addLayer({
      id: `${GHOST_SOURCE}-line`,
      type: 'line',
      source: GHOST_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': cssColor('var(--territory-stolen)'),
        'line-width': 4,
        'line-dasharray': [0.6, 1.6],
        'line-opacity': 0.85,
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
  ghostTrack: MapViewProps['ghostTrack'],
  layers: MapViewProps['layers'],
  ownerColors: MapViewProps['ownerColors'],
): void {
  syncAreaData(instance, layers, ownerColors);
  syncCellData(instance, layers, ownerColors);
  syncTrackData(instance, track);
  syncGhostData(instance, ghostTrack);
}

function syncAreaData(
  instance: mapboxgl.Map,
  layers: MapViewProps['layers'],
  ownerColors: MapViewProps['ownerColors'],
): void {
  const areaSource = instance.getSource(AREA_SOURCE) as mapboxgl.GeoJSONSource | undefined;
  if (!areaSource) return;

  const groups = new Map<
    string,
    { role: HexRole; defense: number; owner: string; cells: CellId[] }
  >();
  for (const layer of layers ?? []) {
    if (!isTerritoryRole(layer.role)) continue;
    for (const entry of layer.cells) {
      const cell = typeof entry === 'string' ? entry : entry.cell;
      const defense = clampDefense(typeof entry === 'string' ? 1 : entry.defense ?? 1);
      const owner = typeof entry === 'string' ? '' : entry.owner ?? '';
      const key = `${layer.role}:${defense}:${owner}`;
      const existing = groups.get(key);
      if (existing) existing.cells.push(cell);
      else groups.set(key, { role: layer.role, defense, owner, cells: [cell] });
    }
  }

  const features = [];
  for (const { role, defense, owner, cells } of groups.values()) {
    const coordinates = cellsToAreaPolygons(cells);
    if (coordinates.length === 0) continue;
    const color = areaColor(role, defense, owner, ownerColors);
    features.push({
      type: 'Feature' as const,
      properties: {
        color,
        /*
          A PIROS SZEGÉLY csak az ELRABOLHATÓ (1-es védelmű) rivális
          területet jelöli — Geri kérése (2026-08-27). Egy jól védett (2-5
          szintű) rivális folt a SAJÁT tulajdonosi színében kap szegélyt is,
          különben minden ellenség egyformán "fenyegetőnek" tűnne, holott a
          legtöbbjük ma nem vehető el.
        */
        outlineColor: role === 'rival' && defense === 1 ? cssColor(ROLE_COLOR.rival) : color,
        opacity: cssNumber(`--defense-alpha-${defense}`, 0.2),
        own: role === 'interior' || role === 'stolen',
      },
      geometry: { type: 'MultiPolygon' as const, coordinates },
    });
  }
  areaSource.setData({ type: 'FeatureCollection', features });
}

function areaColor(
  role: HexRole,
  defense: number,
  owner: string,
  ownerColors: MapViewProps['ownerColors'],
): string {
  // Valós tulajdonosnál mindig a profil színe dönt. Ha egy régi usernek még
  // nincs cellColor mezője, a cellColorHex az alapértelmezett palettaszínt adja.
  if (owner) return cellColorHex(ownerColors?.[owner]);
  if (role === 'rival' && defense === 5) return cssColor(RIVAL_MAX_COLOR);
  return cssColor(ROLE_COLOR[role]);
}

function syncCellData(
  instance: mapboxgl.Map,
  layers: MapViewProps['layers'],
  ownerColors: MapViewProps['ownerColors'],
): void {
  const cellSource = instance.getSource(CELL_SOURCE) as mapboxgl.GeoJSONSource | undefined;
  if (!cellSource) return;

  const features = [];
  for (const layer of layers ?? []) {
    for (const entry of layer.cells) {
      const cell = typeof entry === 'string' ? entry : entry.cell;
      const defense = clampDefense(typeof entry === 'string' ? 1 : entry.defense ?? 1);
      const owner = typeof entry === 'string' ? '' : (entry.owner ?? '');
      const territory = isTerritoryRole(layer.role);
      const color = territory
        ? areaColor(layer.role, defense, owner, ownerColors)
        : cssColor(ROLE_COLOR[layer.role]);
      const opacity = territory
        ? cssNumber(`--defense-alpha-${defense}`, defense === 1 ? 0 : 0.2)
        : ROLE_FILL_OPACITY[layer.role];
      features.push({
        type: 'Feature' as const,
        properties: {
          cell,
          owner,
          color,
          opacity,
          lineOpacity: ROLE_LINE_OPACITY[layer.role],
          defenseLabel: territory ? String(defense) : '',
          labelColor: defense >= 4
            ? cssColor('var(--territory-label-strong)')
            : cssColor('var(--text-primary)'),
          labelHaloColor: defense >= 4 ? 'rgba(0, 0, 0, 0.45)' : cssColor('var(--bg-elevated)'),
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [closedRing(cell)],
        },
      });
    }
  }
  cellSource.setData({ type: 'FeatureCollection', features });
}

function syncTrackData(instance: mapboxgl.Map, track: MapViewProps['track']): void {
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

function syncGhostData(instance: mapboxgl.Map, ghostTrack: MapViewProps['ghostTrack']): void {
  const ghostSource = instance.getSource(GHOST_SOURCE) as mapboxgl.GeoJSONSource | undefined;
  if (ghostSource) {
    const coordinates = (ghostTrack ?? []).map((p) => [p.lng, p.lat]);
    ghostSource.setData({
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

function isTerritoryRole(role: HexRole): boolean {
  return role === 'rival' || role === 'interior' || role === 'stolen';
}

function clampDefense(value: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(5, Math.max(1, Math.round(value))) as 1 | 2 | 3 | 4 | 5;
}

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

function closedRing(cell: CellId): [number, number][] {
  const ring = cellToBoundary(cell).map(([lat, lng]) => [lng, lat] as [number, number]);
  const first = ring[0];
  if (first) ring.push([first[0], first[1]]);
  return ring;
}

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}
