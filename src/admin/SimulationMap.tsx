import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { cellToBoundary, cellToLatLng, gridDisk } from 'h3-js';
import { mapboxConfigured, mapboxToken } from '@/lib/mapbox';
import { mapStyleFor } from '@/lib/theme';
import { useThemeContext } from '@/hooks/ThemeProvider';
import type { ProcessResult } from '@/game';
import type { CellId } from '@/types';
import type { SimulationWaypoint } from '@/tracking/simulationSource';
import 'mapbox-gl/dist/mapbox-gl.css';

interface SimulationMapProps {
  route: readonly SimulationWaypoint[];
  rawTrack: readonly { lat: number; lng: number }[];
  acceptedTrack: readonly { lat: number; lng: number }[];
  result: ProcessResult | null;
  showGrid: boolean;
  showLoops: boolean;
  showClaims: boolean;
  resetToken: number;
  onAppendWaypoint(point: SimulationWaypoint): void;
  onMoveWaypoint(index: number, point: SimulationWaypoint): void;
}

const ROUTE_SOURCE = 'lab-route';
const RAW_SOURCE = 'lab-raw';
const ACCEPTED_SOURCE = 'lab-accepted';
const GRID_SOURCE = 'lab-grid';
const TRAIL_SOURCE = 'lab-cell-trail';
const LOOP_SOURCE = 'lab-loops';
const CLAIM_SOURCE = 'lab-claim';
const REJECTED_SOURCE = 'lab-rejected-loops';
const MAX_GRID_CELLS = 12_000;

export function SimulationMap({
  route,
  rawTrack,
  acceptedTrack,
  result,
  showGrid,
  showLoops,
  showClaims,
  resetToken,
  onAppendWaypoint,
  onMoveWaypoint,
}: SimulationMapProps) {
  const { theme } = useThemeContext();
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);
  const routeRef = useRef(route);
  const rawRef = useRef(rawTrack);
  const acceptedRef = useRef(acceptedTrack);
  const resultRef = useRef(result);
  const togglesRef = useRef({ showGrid, showLoops, showClaims });
  const appendRef = useRef(onAppendWaypoint);
  const moveRef = useRef(onMoveWaypoint);
  const appliedThemeRef = useRef(theme);
  const pendingStyleSyncRef = useRef(false);

  routeRef.current = route;
  rawRef.current = rawTrack;
  acceptedRef.current = acceptedTrack;
  resultRef.current = result;
  togglesRef.current = { showGrid, showLoops, showClaims };
  appendRef.current = onAppendWaypoint;
  moveRef.current = onMoveWaypoint;

  function scheduleStyleSync(instance: mapboxgl.Map) {
    if (pendingStyleSyncRef.current) return;
    pendingStyleSyncRef.current = true;
    instance.once('style.load', () => {
      pendingStyleSyncRef.current = false;
      if (map.current !== instance) return;
      syncCurrentState(instance);
    });
  }

  function syncCurrentState(instance: mapboxgl.Map) {
    // A HTML marker nem a style része, ezért route szerkesztéskor azonnal
    // frissíthető akkor is, ha a Mapbox style épp töltődik.
    syncMarkers(instance, routeRef.current, markers, moveRef);

    if (!instance.isStyleLoaded()) {
      scheduleStyleSync(instance);
      return;
    }

    addAllLayers(instance);
    syncLines(instance, routeRef.current, rawRef.current, acceptedRef.current);
    syncGameLayers(instance, resultRef.current, togglesRef.current);
  }

  useEffect(() => {
    if (!mapboxConfigured || !container.current || map.current) return;

    mapboxgl.accessToken = mapboxToken;
    const instance = new mapboxgl.Map({
      container: container.current,
      style: mapStyleFor(theme),
      center: [19.015, 47.475],
      zoom: 14,
      attributionControl: true,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.current = instance;
    appliedThemeRef.current = theme;

    const resizeObserver = new ResizeObserver(() => instance.resize());
    resizeObserver.observe(container.current);

    instance.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    instance.on('load', () => syncCurrentState(instance));

    instance.on('click', (event) => {
      const target = event.originalEvent.target as HTMLElement | null;
      if (target?.closest('.mapboxgl-marker, .mapboxgl-ctrl')) return;
      appendRef.current({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    });

    return () => {
      resizeObserver.disconnect();
      pendingStyleSyncRef.current = false;
      for (const marker of markers.current) marker.remove();
      markers.current = [];
      instance.remove();
      map.current = null;
    };
  }, []);

  // Minden route/replay/toggle/reset ugyanazt a teljes map-state-et szinkronizálja.
  // Ha a style épp nem ready, a legfrissebb állapot style.load után automatikusan
  // újra lefut; nincs több elveszett React-frissítés.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    syncCurrentState(instance);
  }, [route, rawTrack, acceptedTrack, result, showGrid, showLoops, showClaims, resetToken]);

  // Mountkor nem állítjuk be még egyszer ugyanazt a style-t. Csak valódi
  // light/dark váltás indít új style-loadot.
  useEffect(() => {
    const instance = map.current;
    if (!instance || appliedThemeRef.current === theme) return;
    appliedThemeRef.current = theme;
    pendingStyleSyncRef.current = false;
    instance.setStyle(mapStyleFor(theme));
    scheduleStyleSync(instance);
  }, [theme]);

  if (!mapboxConfigured) {
    return (
      <div className="lab-map lab-map--missing">
        A route editorhez hiányzik a <code>VITE_MAPBOX_TOKEN</code>.
      </div>
    );
  }

  return <div ref={container} className="lab-map" />;
}

function addAllLayers(map: mapboxgl.Map) {
  addLine(map, ROUTE_SOURCE, token('--accent'), 4, 0.9);
  addLine(map, RAW_SOURCE, token('--danger'), 2, 0.45);
  addLine(map, ACCEPTED_SOURCE, token('--success'), 3, 0.95);
  addGameLayers(map);
}

function addGameLayers(map: mapboxgl.Map) {
  addGeoJsonSource(map, GRID_SOURCE);
  addGeoJsonSource(map, TRAIL_SOURCE);
  addGeoJsonSource(map, LOOP_SOURCE);
  addGeoJsonSource(map, CLAIM_SOURCE);
  addGeoJsonSource(map, REJECTED_SOURCE);

  if (!map.getLayer(`${GRID_SOURCE}-line`)) {
    map.addLayer({
      id: `${GRID_SOURCE}-line`,
      type: 'line',
      source: GRID_SOURCE,
      paint: {
        'line-color': token('--border-strong'),
        'line-width': 0.7,
        'line-opacity': 0.45,
      },
    });
  }

  if (!map.getLayer(`${TRAIL_SOURCE}-fill`)) {
    map.addLayer({
      id: `${TRAIL_SOURCE}-fill`,
      type: 'fill',
      source: TRAIL_SOURCE,
      paint: {
        'fill-color': [
          'match', ['get', 'state'],
          'discarded', token('--territory-neutral'),
          token('--trail-pending'),
        ] as any,
        'fill-opacity': [
          'match', ['get', 'state'],
          'discarded', 0.11,
          0.08,
        ] as any,
      },
    });
  }
  if (!map.getLayer(`${TRAIL_SOURCE}-line`)) {
    map.addLayer({
      id: `${TRAIL_SOURCE}-line`,
      type: 'line',
      source: TRAIL_SOURCE,
      paint: {
        'line-color': [
          'match', ['get', 'state'],
          'discarded', token('--territory-neutral'),
          token('--trail-pending'),
        ] as any,
        'line-width': 1,
        'line-opacity': 0.7,
      },
    });
  }

  if (!map.getLayer(`${LOOP_SOURCE}-fill`)) {
    map.addLayer({
      id: `${LOOP_SOURCE}-fill`,
      type: 'fill',
      source: LOOP_SOURCE,
      filter: ['==', ['get', 'kind'], 'interior'],
      paint: {
        'fill-color': token('--info'),
        'fill-opacity': 0.16,
      },
    });
  }
  if (!map.getLayer(`${LOOP_SOURCE}-wall`)) {
    map.addLayer({
      id: `${LOOP_SOURCE}-wall`,
      type: 'line',
      source: LOOP_SOURCE,
      filter: ['==', ['get', 'kind'], 'wall'],
      paint: {
        'line-color': token('--warning'),
        'line-width': 2,
        'line-opacity': 0.95,
      },
    });
  }

  if (!map.getLayer(`${CLAIM_SOURCE}-fill`)) {
    map.addLayer({
      id: `${CLAIM_SOURCE}-fill`,
      type: 'fill',
      source: CLAIM_SOURCE,
      paint: {
        'fill-color': [
          'match', ['get', 'fate'],
          'breakthrough', token('--danger'),
          token('--territory-own'),
        ] as any,
        'fill-opacity': [
          'interpolate', ['linear'], ['get', 'defense'],
          1, 0.22,
          2, 0.32,
          3, 0.44,
          4, 0.58,
          5, 0.74,
        ] as any,
      },
    });
  }
  if (!map.getLayer(`${CLAIM_SOURCE}-line`)) {
    map.addLayer({
      id: `${CLAIM_SOURCE}-line`,
      type: 'line',
      source: CLAIM_SOURCE,
      paint: {
        'line-color': [
          'match', ['get', 'fate'],
          'breakthrough', token('--danger'),
          token('--territory-own'),
        ] as any,
        'line-width': [
          'interpolate', ['linear'], ['get', 'defense'],
          1, 0.8,
          5, 2.2,
        ] as any,
        'line-opacity': 0.95,
      },
    });
  }
  if (!map.getLayer(`${CLAIM_SOURCE}-labels`)) {
    map.addLayer({
      id: `${CLAIM_SOURCE}-labels`,
      type: 'symbol',
      source: CLAIM_SOURCE,
      minzoom: 16,
      layout: {
        'text-field': ['concat', ['to-string', ['get', 'defense']], '×'] as any,
        'text-size': 9,
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': token('--territory-label-strong'),
        'text-halo-color': token('--territory-own'),
        'text-halo-width': 1,
      },
    });
  }

  if (!map.getLayer(REJECTED_SOURCE)) {
    map.addLayer({
      id: REJECTED_SOURCE,
      type: 'line',
      source: REJECTED_SOURCE,
      paint: {
        'line-color': token('--danger'),
        'line-width': 4,
        'line-opacity': 0.9,
        'line-dasharray': [1.5, 1.5],
      },
    });
  }
}

function syncGameLayers(
  map: mapboxgl.Map,
  result: ProcessResult | null,
  toggles: { showGrid: boolean; showLoops: boolean; showClaims: boolean },
) {
  setLayerVisible(map, `${GRID_SOURCE}-line`, toggles.showGrid);
  setLayerVisible(map, `${TRAIL_SOURCE}-fill`, toggles.showClaims);
  setLayerVisible(map, `${TRAIL_SOURCE}-line`, toggles.showClaims);
  setLayerVisible(map, `${LOOP_SOURCE}-fill`, toggles.showLoops);
  setLayerVisible(map, `${LOOP_SOURCE}-wall`, toggles.showLoops);
  setLayerVisible(map, REJECTED_SOURCE, toggles.showLoops);
  setLayerVisible(map, `${CLAIM_SOURCE}-fill`, toggles.showClaims);
  setLayerVisible(map, `${CLAIM_SOURCE}-line`, toggles.showClaims);
  setLayerVisible(map, `${CLAIM_SOURCE}-labels`, toggles.showClaims);

  if (!result) {
    clearGameSources(map);
    return;
  }

  setSourceData(
    map,
    GRID_SOURCE,
    toggles.showGrid
      ? cellCollection(collectRelevantGridCells(result), () => ({}))
      : emptyFeatureCollection(),
  );

  const trailCells = [...new Set(result.cellPath)];
  setSourceData(
    map,
    TRAIL_SOURCE,
    cellCollection(trailCells, (cell) => ({
      state: result.claimedCells.has(cell) ? 'claimed' : 'discarded',
    })),
  );
  setSourceData(map, LOOP_SOURCE, loopCollection(result));
  setSourceData(map, REJECTED_SOURCE, rejectedLoopCollection(result));
  setSourceData(map, CLAIM_SOURCE, claimCollection(result));
}

function clearGameSources(map: mapboxgl.Map) {
  setSourceData(map, GRID_SOURCE, emptyFeatureCollection());
  setSourceData(map, TRAIL_SOURCE, emptyFeatureCollection());
  setSourceData(map, LOOP_SOURCE, emptyFeatureCollection());
  setSourceData(map, CLAIM_SOURCE, emptyFeatureCollection());
  setSourceData(map, REJECTED_SOURCE, emptyFeatureCollection());
}

function setLayerVisible(map: mapboxgl.Map, layerId: string, visible: boolean) {
  if (map.getLayer(layerId)) {
    map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
  }
}

function collectRelevantGridCells(result: ProcessResult): CellId[] {
  const cells = new Set<CellId>();
  const seeds = new Set<CellId>(result.cellPath);
  for (const cell of result.claimedCells) seeds.add(cell);

  if (seeds.size > MAX_GRID_CELLS) return [];
  for (const cell of seeds) {
    for (const nearby of gridDisk(cell, 1)) {
      cells.add(nearby);
      if (cells.size > MAX_GRID_CELLS) return [];
    }
  }
  return [...cells];
}

function loopCollection(result: ProcessResult): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const features: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
  result.loops.forEach((loop, loopIndex) => {
    // A compact teljes parentek maguk a belső terület pontos tömör csempéi.
    // Nem bontjuk őket vissza 49 res12 poligonra csak a kirajzolás kedvéért.
    for (const parent of loop.compactInterior?.fullParents ?? []) {
      features.push(cellFeature(parent, {
        kind: 'interior',
        loop: loopIndex + 1,
        compact: true,
      }));
    }
    for (const cell of loop.interior) {
      features.push(cellFeature(cell, { kind: 'interior', loop: loopIndex + 1 }));
    }
    for (const cell of loop.wall) {
      features.push(cellFeature(cell, { kind: 'wall', loop: loopIndex + 1 }));
    }
  });
  return { type: 'FeatureCollection', features };
}

function claimCollection(result: ProcessResult): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const compact = result.compactClaim;
  if (compact) {
    const features: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
    for (const [parent, defense] of compact.parents) {
      features.push(cellFeature(parent, {
        defense,
        owner: 'lab-user',
        fate: 'free',
        compact: true,
      }));
    }
    for (const [cell, defense] of compact.cells) {
      features.push(cellFeature(cell, {
        defense,
        owner: 'lab-user',
        fate: 'free',
      }));
    }
    return { type: 'FeatureCollection', features };
  }

  if (!result.claim) return emptyFeatureCollection<GeoJSON.Polygon>();
  const features: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
  for (const [cell, ownership] of result.claim.updates) {
    features.push(cellFeature(cell, {
      defense: ownership.defense,
      owner: ownership.owner,
      fate: result.claim.fates.get(cell) ?? 'free',
    }));
  }
  return { type: 'FeatureCollection', features };
}

function rejectedLoopCollection(result: ProcessResult): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (const diagnostic of result.diagnostics.loops.rejected) {
    const cells = result.cellPath.slice(diagnostic.fromIndex, diagnostic.toIndex + 1);
    if (cells.length < 2) continue;
    features.push({
      type: 'Feature',
      properties: {
        reason: diagnostic.reason,
        wallCells: diagnostic.wallCells,
        interiorCells: diagnostic.interiorCells,
      },
      geometry: {
        type: 'LineString',
        coordinates: cells.map((cell) => {
          const [lat, lng] = cellToLatLng(cell);
          return [lng, lat];
        }),
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

function cellCollection(
  cells: readonly CellId[],
  properties: (cell: CellId) => GeoJSON.GeoJsonProperties,
): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return {
    type: 'FeatureCollection',
    features: cells.map((cell) => cellFeature(cell, properties(cell))),
  };
}

function cellFeature(
  cell: CellId,
  properties: GeoJSON.GeoJsonProperties,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const boundary = cellToBoundary(cell) as [number, number][];
  const coordinates = boundary.map(([lat, lng]) => [lng, lat]);
  if (coordinates.length > 0) coordinates.push([...coordinates[0]!] as [number, number]);
  return {
    type: 'Feature',
    properties: { cell, ...properties },
    geometry: { type: 'Polygon', coordinates: [coordinates] },
  };
}

function addGeoJsonSource(map: mapboxgl.Map, sourceId: string) {
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, { type: 'geojson', data: emptyFeatureCollection() });
  }
}

function setSourceData(map: mapboxgl.Map, sourceId: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
  source?.setData(data);
}

function emptyFeatureCollection<T extends GeoJSON.Geometry = GeoJSON.Geometry>(): GeoJSON.FeatureCollection<T> {
  return { type: 'FeatureCollection', features: [] };
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function addLine(
  map: mapboxgl.Map,
  sourceId: string,
  color: string,
  width: number,
  opacity: number,
) {
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: 'geojson',
      data: lineFeature([]),
    });
  }
  if (!map.getLayer(sourceId)) {
    map.addLayer({
      id: sourceId,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': color,
        'line-width': width,
        'line-opacity': opacity,
      },
    });
  }
}

function syncLines(
  map: mapboxgl.Map,
  route: readonly { lat: number; lng: number }[],
  raw: readonly { lat: number; lng: number }[],
  accepted: readonly { lat: number; lng: number }[],
) {
  setLine(map, ROUTE_SOURCE, route);
  setLine(map, RAW_SOURCE, raw);
  setLine(map, ACCEPTED_SOURCE, accepted);
}

function setLine(
  map: mapboxgl.Map,
  sourceId: string,
  points: readonly { lat: number; lng: number }[],
) {
  const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
  source?.setData(lineFeature(points));
}

function lineFeature(points: readonly { lat: number; lng: number }[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: points.map((point) => [point.lng, point.lat]),
    },
  };
}

function syncMarkers(
  map: mapboxgl.Map,
  route: readonly SimulationWaypoint[],
  holder: { current: mapboxgl.Marker[] },
  moveRef: { current: (index: number, point: SimulationWaypoint) => void },
) {
  for (const marker of holder.current) marker.remove();
  holder.current = route.map((point, index) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'lab-waypoint';
    element.textContent = String(index + 1);
    element.title = `Útvonalpont ${index + 1} — húzd a módosításhoz`;

    const marker = new mapboxgl.Marker({ element, draggable: true })
      .setLngLat([point.lng, point.lat])
      .addTo(map);
    marker.on('dragend', () => {
      const next = marker.getLngLat();
      moveRef.current(index, { lat: next.lat, lng: next.lng });
    });
    return marker;
  });
}
