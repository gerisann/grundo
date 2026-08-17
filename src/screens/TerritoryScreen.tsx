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
 * Ez alatt a nagyítás alatt nem rajzoljuk ki a szabad mezőket.
 *
 * Nem teljesítmény kérdése, hanem olvashatóságé: egy res 12 hatszög ~18 m
 * átmérőjű, ami 14-es nagyításnál nagyjából KÉT képpont. Az ilyen háló nem
 * információ, hanem szürke zaj a térképen — és pont azt takarná el, ami
 * számít: hol van foglalt terület.
 *
 * A FOGLALT cellákat viszont minden nagyításnál kirajzoljuk, mert azok
 * összefüggő foltot alkotnak, és távolról is felismerhetők.
 */
const FREE_CELL_MIN_ZOOM = 15;

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
  const [zoom, setZoom] = useState(0);
  const [boardOpen, setBoardOpen] = useState(false);

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
      setZoom(next.zoom);
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
    if (zoom >= FREE_CELL_MIN_ZOOM) {
      for (const block of blocks) {
        for (const child of cellToChildren(block, 12)) {
          if (!taken.has(child)) free.push(child);
        }
      }
    }

    return { mineDefended, mineExposed, others, free };
  }, [tiles, uid, zoom]);

  const showingFree = groups.free.length > 0;

  return (
    <div className="terr">
      {/*
        A térkép a képernyő HÁTTERE, nem doboz a tartalomban — ugyanaz a
        felépítés, mint a rögzítésnél. A birtokviszony térbeli információ: minél
        többet látsz belőle egyszerre, annál használhatóbb.
      */}
      <div className="terr__map">
        {mapboxConfigured ? (
          <Suspense fallback={null}>
            <MapView
              layers={[
                { role: 'free', cells: groups.free },
                { role: 'rival', cells: groups.others },
                { role: 'stolen', cells: groups.mineExposed },
                { role: 'interior', cells: groups.mineDefended },
              ]}
              position={position}
              follow={false}
              onViewport={onViewport}
              fill
            />
          </Suspense>
        ) : null}
      </div>

      <header
        className="screen-header"
        style={{ justifyContent: 'space-between', paddingLeft: 'var(--sp-4)' }}
      >
        <h1 className="screen-header__title">Terület</h1>
        <button
          type="button"
          className="screen-header__back"
          aria-label={boardOpen ? 'Vissza a térképhez' : 'Ranglista'}
          aria-pressed={boardOpen}
          onClick={() => setBoardOpen((open) => !open)}
        >
          <TrophyIcon />
        </button>
      </header>

      <div className="terr__overlay">
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

        {boardOpen ? (
          <Leaderboard entries={board} meUid={uid} onClose={() => setBoardOpen(false)} />
        ) : null}

        {!mapboxConfigured ? (
          <div className="card">
            A térképhez Mapbox-token kell. Enélkül a birtokviszony nem jeleníthető meg.
          </div>
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
            : 'Közelíts rá, és a szabad mezők is megjelennek.'}{' '}
          {tiles?.partial
            ? 'A háló most csak a nézet közepét fedi le — a széleken nem tudjuk, mi van. '
            : ''}
          A védelem naponta egy szintet veszít, de sosem esik 1 alá: a terület a tiéd marad, csak
          egyre könnyebb elvenni.
        </p>
      </div>
    </div>
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

function Leaderboard({
  entries,
  meUid,
  onClose,
}: {
  entries: LeaderboardEntry[] | null;
  meUid: string;
  onClose: () => void;
}) {
  const head = (
    <div className="terr__board-head">
      <h2 className="terr__board-title">Legnagyobb területek</h2>
      <button type="button" className="terr__board-close" aria-label="Bezárás" onClick={onClose}>
        ✕
      </button>
    </div>
  );

  if (entries === null) {
    return (
      <div className="terr__board">
        {head}
        <p className="terr__board-message">Betöltés…</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="terr__board">
        {head}
        <p className="terr__board-message">Még senkinek nincs területe. Légy te az első.</p>
      </div>
    );
  }

  return (
    <div className="terr__board">
      {head}
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

function TrophyIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3" />
      <path d="M12 14v4M9 20h6" />
    </svg>
  );
}
