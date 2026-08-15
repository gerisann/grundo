import { useMemo } from 'react';
import { cellToBoundary } from 'h3-js';
import type { CellId } from '@/types';

export type HexRole = 'trail' | 'interior' | 'rival' | 'stolen';

export interface HexMapProps {
  /** Cellák szerepenként. A sorrend a rajzolási sorrend is. */
  layers: { role: HexRole; cells: Iterable<CellId> }[];
  /** A nyomvonal a cellák alatt, nyers GPS-pontokból. */
  track?: readonly { lat: number; lng: number }[];
  height?: number;
  /**
   * Legfeljebb ennyi hatszöget rajzolunk ki.
   *
   * Enélkül egy hosszú nyomvonal tízezres nagyságrendű SVG-elemet hozna
   * létre, és a felület másodpercekre megállna — miközben a motor maga
   * ezredmásodpercek alatt végez. Efölött ritkítunk: az alak megmarad,
   * csak minden n-edik cellát rajzoljuk.
   */
  maxCells?: number;
}

const ROLE_STYLE: Record<HexRole, { fill: string; stroke: string }> = {
  interior: { fill: 'var(--territory-own-fill)', stroke: 'var(--territory-own)' },
  trail: { fill: 'var(--trail-pending-fill)', stroke: 'var(--trail-pending)' },
  rival: { fill: 'var(--territory-rival-fill)', stroke: 'var(--territory-rival)' },
  stolen: { fill: 'var(--territory-own-fill)', stroke: 'var(--territory-rival)' },
};

/**
 * Hexagon-rács megjelenítése tiszta SVG-vel.
 *
 * Szándékosan NEM Mapbox: így a fejlesztői visszajátszó térkép-token nélkül
 * is működik, és pontosan azt mutatja, amit a motor számol — térképstílus,
 * címkék és egyéb zaj nélkül. A Terület képernyő éles változata majd Mapbox
 * fölé rajzolja ugyanezeket a poligonokat.
 */
export function HexMap({ layers, track, height = 300, maxCells = 3000 }: HexMapProps) {
  const scene = useMemo(() => {
    const raw = layers.map((layer) => ({ role: layer.role, cells: [...layer.cells] }));
    const total = raw.reduce((sum, l) => sum + l.cells.length, 0);

    // Ritkítás, ha túl sok a cella — az alak felismerhető marad.
    const stride = total > maxCells ? Math.ceil(total / maxCells) : 1;
    const drawn = raw.map((l) => ({
      role: l.role,
      cells: stride === 1 ? l.cells : l.cells.filter((_, i) => i % stride === 0),
    }));

    const all: CellId[] = [];
    for (const layer of drawn) for (const cell of layer.cells) all.push(cell);
    if (all.length === 0 && !track?.length) return null;

    // Befoglaló doboz az összes cellából és a nyomvonalból
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    const note = (lat: number, lng: number) => {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    };

    const boundaries = new Map<CellId, [number, number][]>();
    for (const cell of all) {
      const ring = cellToBoundary(cell) as [number, number][];
      boundaries.set(cell, ring);
      for (const [lat, lng] of ring) note(lat, lng);
    }
    for (const p of track ?? []) note(p.lat, p.lng);

    // Egyszerű síkvetítés: a hosszúságot a szélesség koszinuszával skálázzuk,
    // különben a hatszögek megnyúlnak.
    const midLat = (minLat + maxLat) / 2;
    const kx = Math.cos((midLat * Math.PI) / 180);
    const pad = 0.00015;
    const x0 = (minLng - pad) * kx;
    const x1 = (maxLng + pad) * kx;
    const y0 = minLat - pad;
    const y1 = maxLat + pad;
    const w = Math.max(x1 - x0, 1e-9);
    const h = Math.max(y1 - y0, 1e-9);

    // A viewBox szélessége mindig 1000; a magassága a valós arányból jön,
    // így a hatszögek szabályosak maradnak.
    const viewHeight = (h / w) * 1000;
    const project = (lat: number, lng: number): [number, number] => [
      ((lng * kx - x0) / w) * 1000,
      (1 - (lat - y0) / h) * viewHeight,
    ];

    const toPoints = (ring: [number, number][]) =>
      ring.map(([lat, lng]) => project(lat, lng).join(',')).join(' ');

    return {
      viewBox: `0 0 1000 ${Math.round(viewHeight) || 1000}`,
      stride,
      total,
      polygons: drawn.map((layer) => ({
        role: layer.role,
        shapes: layer.cells.map((cell) => {
          const ring = boundaries.get(cell);
          return ring ? toPoints(ring) : '';
        }),
      })),
      trackPath: (track ?? []).map((p) => project(p.lat, p.lng).join(',')).join(' '),
    };
  }, [layers, track, maxCells]);

  if (!scene) {
    return (
      <div className="hexmap hexmap--empty" style={{ height }}>
        <span className="label">Nincs mit megjeleníteni</span>
      </div>
    );
  }

  return (
    <svg
      className="hexmap"
      viewBox={scene.viewBox}
      preserveAspectRatio="xMidYMid meet"
      style={{ height }}
      role="img"
      aria-label="A bezárt terület hexagonjai"
    >
      {scene.polygons.map((layer) => {
        const style = ROLE_STYLE[layer.role];
        return (
          <g key={layer.role} fill={style.fill} stroke={style.stroke} strokeWidth={0.7}>
            {layer.shapes.map((points, i) =>
              points ? <polygon key={i} points={points} /> : null,
            )}
          </g>
        );
      })}
      {scene.trackPath ? (
        <polyline
          points={scene.trackPath}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}
