import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { cellToBoundary, cellToLatLng, gridDisk } from 'h3-js';
import { mapboxConfigured, mapboxToken } from '@/lib/mapbox';
import { mapStyleFor } from '@/lib/theme';
import { useThemeContext } from '@/hooks/ThemeProvider';
import type { ProcessResult } from '@/game';
import type { CellId, OwnershipMap } from '@/types';
import type { SimulationWaypoint } from '@/tracking/simulationSource';
import 'mapbox-gl/dist/mapbox-gl.css';

export interface LabMapRoute {
  playerId: string;
  color: string;
  route: readonly SimulationWaypoint[];
}

export interface LabMapTrack {
  playerId: string;
  color: string;
  raw: readonly { lat: number; lng: number }[];
  accepted: readonly { lat: number; lng: number }[];
}

interface Props {
  activeRoute: readonly SimulationWaypoint[];
  activeColor: string;
  routes: readonly LabMapRoute[];
  tracks: readonly LabMapTrack[];
  world: OwnershipMap;
  ownerColors: ReadonlyMap<string, string>;
  result: ProcessResult | null;
  showGrid: boolean;
  showLoops: boolean;
  showClaims: boolean;
  resetToken: number;
  editable: boolean;
  onAppendWaypoint(point: SimulationWaypoint): void;
  onMoveWaypoint(index: number, point: SimulationWaypoint): void;
}

const ACTIVE_ROUTE = 'lab-scenario-active-route';
const OTHER_ROUTES = 'lab-scenario-routes';
const RAW_TRACKS = 'lab-scenario-raw';
const ACCEPTED_TRACKS = 'lab-scenario-accepted';
const PLAYER_HEADS = 'lab-scenario-player-heads';
const WORLD = 'lab-scenario-world';
const GRID = 'lab-scenario-grid';
const LOOPS = 'lab-scenario-loops';
const REJECTED = 'lab-scenario-rejected';
const MAX_GRID_CELLS = 12_000;
const MAX_WORLD_FEATURES = 60_000;
// A hurokrétegnek eddig nem volt plafonja, pedig a másik két cellarétegnek van.
// Egy 177 km-es hurok fala ~9 400 res12 cella, tehát az bőven alatta marad — ez
// a korlát a patologikus eseteket fogja meg, nem a valódi nagy hurkot.
const MAX_LOOP_FEATURES = 40_000;

/**
 * A LAB térképe.
 *
 * ⚠️ FORRÁSONKÉNT KÜLÖN EFFEKT. Korábban egyetlen `sync()` frissítette mind a
 * kilenc forrást, bármelyik prop változására. Phase-lejátszás közben ez azt
 * jelentette, hogy egy nyomvonal-frame is újraépítette a teljes world
 * GeoJSON-t — több tízezer poligont, mindegyikhez `cellToBoundary` hívással.
 * Ne vond össze őket újra: a drága forrás (world, hurkok) csak akkor épülhet
 * újra, ha az adata tényleg változott.
 */
export function ScenarioSimulationMap(props: Props) {
  const { theme } = useThemeContext();
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);
  const markerEditable = useRef(props.editable);
  const latest = useRef(props);
  const appliedTheme = useRef(theme);
  // A stílus (újra)betöltése eldobja a forrásokat és a rétegeket. Amíg ez nem
  // igaz, egyik forrás-effekt sem írhat; ha újra igazzá válik, mind újrafut.
  const [ready, setReady] = useState(false);
  latest.current = props;

  useEffect(() => {
    if (!mapboxConfigured || !container.current || mapRef.current) return;
    mapboxgl.accessToken = mapboxToken;
    const map = new mapboxgl.Map({
      container: container.current,
      style: mapStyleFor(theme),
      center: [19.015, 47.475],
      zoom: 14,
      attributionControl: true,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    appliedTheme.current = theme;
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container.current);
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      addLayers(map);
      setReady(true);
    });
    map.on('click', (event) => {
      if (!latest.current.editable) return;
      const target = event.originalEvent.target as HTMLElement | null;
      if (target?.closest('.mapboxgl-marker, .mapboxgl-ctrl')) return;
      latest.current.onAppendWaypoint({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    });
    return () => {
      observer.disconnect();
      for (const marker of markers.current) marker.remove();
      markers.current = [];
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedTheme.current === theme) return;
    appliedTheme.current = theme;
    setReady(false);
    map.setStyle(mapStyleFor(theme));
    map.once('style.load', () => {
      if (mapRef.current !== map) return;
      addLayers(map);
      setReady(true);
    });
  }, [theme]);

  // Aktív útvonal.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSource(map, ACTIVE_ROUTE, lineCollection([{ points: props.activeRoute, color: props.activeColor }]));
  }, [ready, props.activeRoute, props.activeColor]);

  // A többi player referencia-útvonala.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSource(map, OTHER_ROUTES, lineCollection(props.routes
      .filter((item) => item.route !== props.activeRoute)
      .map((item) => ({ points: item.route, color: item.color }))));
  }, [ready, props.routes, props.activeRoute]);

  // Nyers és elfogadott nyomvonalak + a playerek pillanatnyi pozíciója.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSource(map, RAW_TRACKS, lineCollection(props.tracks.map((track) => ({ points: track.raw, color: track.color }))));
    setSource(map, ACCEPTED_TRACKS, lineCollection(props.tracks.map((track) => ({ points: track.accepted, color: track.color }))));
    setSource(map, PLAYER_HEADS, playerHeadCollection(props.tracks));
  }, [ready, props.tracks, props.resetToken]);

  // A sandbox world — a legdrágább forrás.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSource(map, WORLD, props.showClaims ? worldCollection(props.world, props.ownerColors) : empty());
  }, [ready, props.world, props.ownerColors, props.showClaims]);

  // Hurokgeometria és H3 háló az aktuális eredményből.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!props.result) {
      setSource(map, GRID, empty());
      setSource(map, LOOPS, empty());
      setSource(map, REJECTED, empty());
      return;
    }
    setSource(map, GRID, props.showGrid ? gridCollection(props.result) : empty());
    setSource(map, LOOPS, loopCollection(props.result));
    setSource(map, REJECTED, rejectedCollection(props.result));
  }, [ready, props.result, props.showGrid]);

  // Réteg-láthatóság: olcsó, nem érinti a forrásokat.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setVisible(map, `${WORLD}-fill`, props.showClaims);
    setVisible(map, `${WORLD}-line`, props.showClaims);
    setVisible(map, `${WORLD}-labels`, props.showClaims);
    setVisible(map, `${GRID}-line`, props.showGrid);
    setVisible(map, `${LOOPS}-fill`, props.showLoops);
    setVisible(map, `${LOOPS}-wall`, props.showLoops);
    setVisible(map, REJECTED, props.showLoops);
  }, [ready, props.showGrid, props.showLoops, props.showClaims]);

  // Waypoint-markerek. A stílustól függetlenek (DOM overlay), ezért `ready` itt
  // csak az első kirajzolás időzítéséhez kell.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    syncMarkers(map, props.activeRoute, markers, props.editable, markerEditable,
      (index, point) => latest.current.onMoveWaypoint(index, point));
  }, [ready, props.activeRoute, props.editable]);

  if (!mapboxConfigured) {
    return <div className="lab-map lab-map--missing">A route editorhez hiányzik a <code>VITE_MAPBOX_TOKEN</code>.</div>;
  }
  return <div ref={container} className="lab-map" />;
}

function addLayers(map: mapboxgl.Map) {
  addSource(map, ACTIVE_ROUTE);
  addSource(map, OTHER_ROUTES);
  addSource(map, RAW_TRACKS);
  addSource(map, ACCEPTED_TRACKS);
  addSource(map, PLAYER_HEADS);
  addSource(map, WORLD);
  addSource(map, GRID);
  addSource(map, LOOPS);
  addSource(map, REJECTED);

  addLineLayer(map, ACTIVE_ROUTE, ['get', 'color'] as any, 4, 0.72);
  addLineLayer(map, OTHER_ROUTES, ['get', 'color'] as any, 2.5, 0.42);
  addLineLayer(map, RAW_TRACKS, ['get', 'color'] as any, 2, 0.32);
  addLineLayer(map, ACCEPTED_TRACKS, ['get', 'color'] as any, 3.5, 0.98);

  if (!map.getLayer(`${PLAYER_HEADS}-halo`)) map.addLayer({
    id: `${PLAYER_HEADS}-halo`,
    type: 'circle',
    source: PLAYER_HEADS,
    paint: {
      'circle-radius': 10,
      'circle-color': ['get', 'color'] as any,
      'circle-opacity': 0.2,
      'circle-blur': 0.35,
    },
  });
  if (!map.getLayer(PLAYER_HEADS)) map.addLayer({
    id: PLAYER_HEADS,
    type: 'circle',
    source: PLAYER_HEADS,
    paint: {
      'circle-radius': 5.5,
      'circle-color': ['get', 'color'] as any,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
      'circle-opacity': 1,
    },
  });

  if (!map.getLayer(`${WORLD}-fill`)) map.addLayer({ id: `${WORLD}-fill`, type: 'fill', source: WORLD, paint: {
    'fill-color': ['get', 'color'] as any,
    'fill-opacity': ['interpolate', ['linear'], ['get', 'defense'], 1, 0.22, 5, 0.72] as any,
  }});
  if (!map.getLayer(`${WORLD}-line`)) map.addLayer({ id: `${WORLD}-line`, type: 'line', source: WORLD, paint: {
    'line-color': ['get', 'color'] as any, 'line-width': 0.9, 'line-opacity': 0.9,
  }});
  if (!map.getLayer(`${WORLD}-labels`)) map.addLayer({ id: `${WORLD}-labels`, type: 'symbol', source: WORLD, minzoom: 16,
    layout: { 'text-field': ['concat', ['to-string', ['get', 'defense']], '×'] as any, 'text-size': 9 },
    paint: { 'text-color': '#fff', 'text-halo-color': ['get', 'color'] as any, 'text-halo-width': 1 },
  });
  if (!map.getLayer(`${GRID}-line`)) map.addLayer({ id: `${GRID}-line`, type: 'line', source: GRID,
    paint: { 'line-color': 'rgba(190,190,210,.5)', 'line-width': 0.7, 'line-opacity': 0.6 } });
  if (!map.getLayer(`${LOOPS}-fill`)) map.addLayer({ id: `${LOOPS}-fill`, type: 'fill', source: LOOPS,
    filter: ['==', ['get', 'kind'], 'interior'], paint: { 'fill-color': '#2f8cff', 'fill-opacity': 0.14 } });
  if (!map.getLayer(`${LOOPS}-wall`)) map.addLayer({ id: `${LOOPS}-wall`, type: 'line', source: LOOPS,
    filter: ['==', ['get', 'kind'], 'wall'], paint: { 'line-color': '#ffae00', 'line-width': 2, 'line-opacity': 0.95 } });
  if (!map.getLayer(REJECTED)) map.addLayer({ id: REJECTED, type: 'line', source: REJECTED,
    paint: { 'line-color': '#ff4d5f', 'line-width': 4, 'line-opacity': 0.9, 'line-dasharray': [1.5, 1.5] } });
}

function addSource(map: mapboxgl.Map, id: string) {
  if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: empty() });
}

function addLineLayer(map: mapboxgl.Map, id: string, color: any, width: number, opacity: number) {
  if (!map.getLayer(id)) map.addLayer({ id, type: 'line', source: id, paint: {
    'line-color': color, 'line-width': width, 'line-opacity': opacity,
  }});
}

function setSource(map: mapboxgl.Map, id: string, data: GeoJSON.FeatureCollection) {
  (map.getSource(id) as mapboxgl.GeoJSONSource | undefined)?.setData(data);
}

function setVisible(map: mapboxgl.Map, id: string, visible: boolean) {
  if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
}

function empty<T extends GeoJSON.Geometry = GeoJSON.Geometry>(): GeoJSON.FeatureCollection<T> {
  return { type: 'FeatureCollection', features: [] };
}

function lineCollection(items: readonly { points: readonly { lat: number; lng: number }[]; color: string }[]): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return { type: 'FeatureCollection', features: items.filter((item) => item.points.length > 1).map((item) => ({
    type: 'Feature', properties: { color: item.color }, geometry: {
      type: 'LineString', coordinates: item.points.map((point) => [point.lng, point.lat]),
    },
  })) };
}

function playerHeadCollection(tracks: readonly LabMapTrack[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const track of tracks) {
    const point = track.accepted.at(-1) ?? track.raw.at(-1);
    if (!point) continue;
    features.push({
      type: 'Feature',
      properties: { playerId: track.playerId, color: track.color },
      geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
    });
  }
  return { type: 'FeatureCollection', features };
}

function worldCollection(world: OwnershipMap, colors: ReadonlyMap<string, string>): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  if (world.size > MAX_WORLD_FEATURES) return empty();
  const features: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
  for (const [cell, ownership] of world) {
    features.push(cellFeature(cell, {
      owner: ownership.owner,
      defense: ownership.defense,
      color: colors.get(ownership.owner) ?? '#8b5cf6',
    }));
  }
  return { type: 'FeatureCollection', features };
}

function gridCollection(result: ProcessResult): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const seeds = new Set<CellId>(result.cellPath);
  for (const cell of result.claimedCells) seeds.add(cell);
  if (seeds.size > MAX_GRID_CELLS) return empty();
  const cells = new Set<CellId>();
  for (const seed of seeds) {
    for (const cell of gridDisk(seed, 1)) {
      cells.add(cell);
      if (cells.size > MAX_GRID_CELLS) return empty();
    }
  }
  return { type: 'FeatureCollection', features: [...cells].map((cell) => cellFeature(cell, {})) };
}

function loopCollection(result: ProcessResult): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const features: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
  for (const [index, loop] of result.loops.entries()) {
    for (const parent of loop.compactInterior?.fullParents ?? []) features.push(cellFeature(parent, { kind: 'interior', loop: index + 1 }));
    for (const cell of loop.interior) features.push(cellFeature(cell, { kind: 'interior', loop: index + 1 }));
    for (const cell of loop.wall) features.push(cellFeature(cell, { kind: 'wall', loop: index + 1 }));
    if (features.length > MAX_LOOP_FEATURES) return empty();
  }
  return { type: 'FeatureCollection', features };
}

function rejectedCollection(result: ProcessResult): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (const item of result.diagnostics.loops.rejected) {
    const cells = result.cellPath.slice(item.fromIndex, item.toIndex + 1);
    if (cells.length < 2) continue;
    features.push({ type: 'Feature', properties: { reason: item.reason }, geometry: {
      type: 'LineString', coordinates: cells.map((cell) => {
        const [lat, lng] = cellToLatLng(cell);
        return [lng, lat];
      }),
    }});
  }
  return { type: 'FeatureCollection', features };
}

function cellFeature(cell: CellId, properties: GeoJSON.GeoJsonProperties): GeoJSON.Feature<GeoJSON.Polygon> {
  const boundary = cellToBoundary(cell) as [number, number][];
  const coordinates = boundary.map(([lat, lng]) => [lng, lat]);
  if (coordinates.length) coordinates.push([...coordinates[0]!] as [number, number]);
  return { type: 'Feature', properties: { cell, ...properties }, geometry: { type: 'Polygon', coordinates: [coordinates] } };
}

function syncMarkers(
  map: mapboxgl.Map,
  route: readonly SimulationWaypoint[],
  holder: { current: mapboxgl.Marker[] },
  editable: boolean,
  appliedEditable: { current: boolean },
  onMove: (index: number, point: SimulationWaypoint) => void,
) {
  // Azonos pontszámnál és változatlan szerkeszthetőségnél elég a pozíciót
  // frissíteni. A teljes újraépítés minden rendernél DOM-cserét jelentett — a
  // sorszámozott pontok lejátszás közben láthatóan villogtak tőle.
  if (holder.current.length === route.length && appliedEditable.current === editable) {
    route.forEach((point, index) => {
      const marker = holder.current[index];
      if (!marker) return;
      const at = marker.getLngLat();
      if (at.lat !== point.lat || at.lng !== point.lng) marker.setLngLat([point.lng, point.lat]);
    });
    return;
  }

  for (const marker of holder.current) marker.remove();
  appliedEditable.current = editable;
  holder.current = route.map((point, index) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'lab-waypoint';
    element.textContent = String(index + 1);
    element.title = editable ? `Útvonalpont ${index + 1} — húzd a módosításhoz` : `Útvonalpont ${index + 1}`;
    const marker = new mapboxgl.Marker({ element, draggable: editable }).setLngLat([point.lng, point.lat]).addTo(map);
    if (editable) marker.on('dragend', () => {
      const next = marker.getLngLat();
      onMove(index, { lat: next.lat, lng: next.lng });
    });
    return marker;
  });
}
