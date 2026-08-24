import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { mapboxConfigured, mapboxToken } from '@/lib/mapbox';
import { mapStyleFor } from '@/lib/theme';
import { useThemeContext } from '@/hooks/ThemeProvider';
import type { SimulationWaypoint } from '@/tracking/simulationSource';
import 'mapbox-gl/dist/mapbox-gl.css';

interface SimulationMapProps {
  route: readonly SimulationWaypoint[];
  rawTrack: readonly { lat: number; lng: number }[];
  acceptedTrack: readonly { lat: number; lng: number }[];
  onAppendWaypoint(point: SimulationWaypoint): void;
  onMoveWaypoint(index: number, point: SimulationWaypoint): void;
}

const ROUTE_SOURCE = 'lab-route';
const RAW_SOURCE = 'lab-raw';
const ACCEPTED_SOURCE = 'lab-accepted';

export function SimulationMap({
  route,
  rawTrack,
  acceptedTrack,
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
  const appendRef = useRef(onAppendWaypoint);
  const moveRef = useRef(onMoveWaypoint);

  routeRef.current = route;
  rawRef.current = rawTrack;
  acceptedRef.current = acceptedTrack;
  appendRef.current = onAppendWaypoint;
  moveRef.current = onMoveWaypoint;

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

    const resizeObserver = new ResizeObserver(() => instance.resize());
    resizeObserver.observe(container.current);

    instance.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    instance.on('load', () => {
      addLine(instance, ROUTE_SOURCE, '#a855f7', 4, 0.9);
      addLine(instance, RAW_SOURCE, '#ef4444', 2, 0.45);
      addLine(instance, ACCEPTED_SOURCE, '#22c55e', 3, 0.95);
      syncLines(instance, routeRef.current, rawRef.current, acceptedRef.current);
      syncMarkers(instance, routeRef.current, markers, moveRef);
    });

    instance.on('click', (event) => {
      const target = event.originalEvent.target as HTMLElement | null;
      if (target?.closest('.mapboxgl-marker, .mapboxgl-ctrl')) return;
      appendRef.current({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    });

    return () => {
      resizeObserver.disconnect();
      for (const marker of markers.current) marker.remove();
      markers.current = [];
      instance.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !instance.isStyleLoaded()) return;
    syncLines(instance, route, rawTrack, acceptedTrack);
    syncMarkers(instance, route, markers, moveRef);
  }, [route, rawTrack, acceptedTrack]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    instance.setStyle(mapStyleFor(theme));
    instance.once('style.load', () => {
      addLine(instance, ROUTE_SOURCE, '#a855f7', 4, 0.9);
      addLine(instance, RAW_SOURCE, '#ef4444', 2, 0.45);
      addLine(instance, ACCEPTED_SOURCE, '#22c55e', 3, 0.95);
      syncLines(instance, routeRef.current, rawRef.current, acceptedRef.current);
    });
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
