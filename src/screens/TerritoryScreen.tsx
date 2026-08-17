import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cellToChildren } from 'h3-js';
import { SegmentedControl } from '@/components/ui';
import { mapboxConfigured } from '@/lib/mapbox';
import {
  api,
  apiConfigured,
  type LeaderboardEntry,
  type TilesResult,
} from '@/lib/api';
import { useProfile } from '@/hooks/ProfileProvider';
import { formatArea } from '@/lib/format';
import type { Layer } from '@/types';
import './territory.css';

const MapView = lazy(() => import('@/components/MapView').then((m) => ({ default: m.MapView })));

/**
 * Ennyi blokknál még kirajzoljuk a SZABAD cellákat is.
 *
 * Egy res 9 blokk 343 res 12 cellát tartalmaz, tehát nyolc blokk ~2 700
 * hatszög — ennyi még gyorsan rajzolódik és olvasható. Följebb a szabad
 * cellák úgyis szürke masszává folynának össze, és a lényeget takarnák el:
 * azt, hogy hol van FOGLALT terület.
 */
const FREE_CELL_BLOCK_LIMIT = 8;

type View = { south: number; west: number; north: number; east: number; zoom: number };

/**
 * Terület.
 *
 * A térkép MINDIG látszik, akkor is, ha még nincs saját területed — sőt főleg
 * akkor: aki most kezdi, épp azt akarja tudni, mi van körülötte és mi szabad.
 */
export function TerritoryScreen() {
  const { profile } = useProfile();
  const [layer, setLayer] = useState<Layer>('foot');
  const [tiles, setTiles] = useState<TilesResult | null>(null);
  const [board, setBoard] = useState<LeaderboardEntry[] | null>(null);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);

  /**
   * A látott szakasz REFBEN, nem állapotban.
   *
   * Ha állapot lenne, minden térképmozgatás újrarajzolást indítana, az pedig
   * újabb `moveend` eseményt — körbe. Az újrarajzolást a `tiles` változása
   * hajtja, ami a lekérdezés után egyszer következik be. A refre csak azért
   * van szükség, hogy rétegváltáskor tudjuk, melyik szakaszt kell újrakérni.
   */
  const viewRef = useRef<View | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setPosition({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => undefined,
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, []);

  useEffect(() => {
    if (!apiConfigured) return;
    void api
      .leaderboard(layer)
      .then((r) => setBoard(r.entries))
      .catch(() => setBoard([]));
  }, [layer]);

  const loadTiles = useCallback(
    async (next: View) => {
      if (!apiConfigured) return;
      try {
        setTiles(await api.tiles(layer, next));
      } catch {
        setTiles(null);
      }
    },
    [layer],
  );

  const onViewport = useCallback(
    (next: View) => {
      viewRef.current = next;
      void loadTiles(next);
    },
    [loadTiles],
  );

  // Rétegváltásnál újra kell kérdezni ugyanarra a szakaszra.
  useEffect(() => {
    if (viewRef.current) void loadTiles(viewRef.current);
  }, [loadTiles]);

  const uid = profile?.uid ?? '';

  /**
   * A cellák három csoportba kerülnek, mert a felhasználót három kérdés
   * érdekli: mi az enyém, mi máséé, és mi szabad.
   */
  const groups = useMemo(() => {
    const mineDefended: string[] = [];
    const mineExposed: string[] = [];
    const others: string[] = [];
    const taken = new Set<string>();

    for (const c of tiles?.cells ?? []) {
      taken.add(c.cell);
      if (c.owner === uid) (c.defense > 1 ? mineDefended : mineExposed).push(c.cell);
      else others.push(c.cell);
    }

    /**
     * A SZABAD cella nem tárolódik sehol — az a foglalt cellák hiánya.
     * Ezért a nézetet lefedő blokkok gyerekeiből vonjuk ki a foglaltakat.
     * Csak közeli nézetben: távolról tízezres nagyságrendű hatszög lenne.
     */
    const blocks = tiles?.blocks ?? [];
    const free: string[] = [];
    if (blocks.length > 0 && blocks.length <= FREE_CELL_BLOCK_LIMIT) {
      for (const block of blocks) {
        for (const child of cellToChildren(block, 12)) {
          if (!taken.has(child)) free.push(child);
        }
      }
    }

    return { mineDefended, mineExposed, others, free };
  }, [tiles, uid]);

  const showingFree = groups.free.length > 0;

  return (
    <>
      <header className="screen-header">
        <h1 className="screen-header__title">Terület</h1>
      </header>

      <div className="screen-body stack">
        <SegmentedControl
          label="Réteg"
          block
          value={layer}
          onChange={setLayer}
          options={[
            { value: 'foot', label: 'Gyalogos' },
            { value: 'bike', label: 'Bringás' },
          ]}
        />

        <div className="terr__stats">
          <div className="terr__stat">
            <span className="terr__stat-value">
              {formatArea(profile?.territoryM2[layer] ?? 0)}
            </span>
            <span className="terr__stat-label">a tiéd</span>
          </div>
          <div className="terr__stat">
            <span className="terr__stat-value">{groups.mineDefended.length}</span>
            <span className="terr__stat-label">védett mező</span>
          </div>
          <div className="terr__stat">
            <span className="terr__stat-value">{groups.others.length}</span>
            <span className="terr__stat-label">másé itt</span>
          </div>
        </div>

        {mapboxConfigured ? (
          <Suspense fallback={<div className="card">Térkép betöltése…</div>}>
            <MapView
              layers={[
                { role: 'free', cells: groups.free },
                { role: 'rival', cells: groups.others },
                { role: 'stolen', cells: groups.mineExposed },
                { role: 'interior', cells: groups.mineDefended },
              ]}
              position={position}
              follow={false}
              height={400}
              onViewport={onViewport}
            />
          </Suspense>
        ) : (
          <div className="card">
            A térképhez Mapbox-token kell. Enélkül a birtokviszony nem jeleníthető meg.
          </div>
        )}

        {tiles?.tooWide ? (
          <p className="terr__legend">
            Túl nagy a nézet — közelíts rá, hogy lásd a mezőket.
          </p>
        ) : null}

        <div className="terr__legend-grid">
          <Swatch className="terr__swatch--mine" label="A tiéd, védve" />
          <Swatch className="terr__swatch--exposed" label="A tiéd, 1-es szinten" />
          <Swatch className="terr__swatch--rival" label="Másé" />
          <Swatch className="terr__swatch--free" label="Szabad" />
        </div>

        <p className="terr__legend">
          {showingFree
            ? 'A halvány mezők szabadok — bárkié lehetnek, aki bezár egy kört körülöttük.'
            : 'Közelíts rá jobban, és a szabad mezők is megjelennek.'}{' '}
          A védelem naponta egy szintet veszít, de sosem esik 1 alá: a terület a tiéd marad, csak
          egyre könnyebb elvenni.
        </p>

        <Leaderboard entries={board} meUid={uid} />
      </div>
    </>
  );
}

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="terr__legend-item">
      <span className={`terr__swatch ${className}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function Leaderboard({ entries, meUid }: { entries: LeaderboardEntry[] | null; meUid: string }) {
  if (entries === null) return <div className="card">Ranglista betöltése…</div>;

  if (entries.length === 0) {
    return (
      <div className="card">
        <h2 className="terr__board-title">Ranglista</h2>
        <p className="terr__legend">Még senkinek nincs területe. Légy te az első.</p>
      </div>
    );
  }

  return (
    <div className="terr__board">
      <h2 className="terr__board-title">Legnagyobb területek</h2>
      {entries.map((entry, index) => (
        <div
          key={entry.uid}
          className={`terr__board-row${entry.uid === meUid ? ' terr__board-row--me' : ''}`}
        >
          <span className="terr__board-rank">{index + 1}.</span>
          <span className="terr__board-name">{entry.username}</span>
          <span className="terr__board-area">{formatArea(entry.areaM2)}</span>
        </div>
      ))}
    </div>
  );
}
