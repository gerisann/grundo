import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cellToChildren } from 'h3-js';
import type { HexRole } from '@/components/HexMap';
import { LayerSwitch } from '@/components/ui';
import { mapboxConfigured } from '@/lib/mapbox';
import {
  api,
  apiConfigured,
  type LeaderboardEntry,
  type TilesResult,
} from '@/lib/api';
import { useProfile } from '@/hooks/ProfileProvider';
import { formatArea } from '@/lib/format';
import { ROLE_COLOR } from '@/lib/hexColors';
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

const LEGEND_KEY = 'grundo.territory.legend';
const HELP_KEY = 'grundo.territory.help';

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
  /**
   * Tiszta térkép nézet.
   *
   * A birtokviszony térbeli információ; néha egyszerűen látni akarod, mi hol
   * van, ráolvasás nélkül. A fejléc marad, hogy legyen mivel visszakapcsolni.
   */
  const [overlayVisible, setOverlayVisible] = useState(true);
  // Alapból ZÁRVA: a jelmagyarázat egyszer hasznos, utána helyet foglal.
  const [legendOpen, setLegendOpen] = useState(() => read(LEGEND_KEY) === 'open');
  const [helpOpen, setHelpOpen] = useState(() => read(HELP_KEY) !== 'closed');

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

      <div className="terr__overlay">
        {/*
          A fejléc pontosan ugyanazt a `screen-header` osztályt és belső
          térközt használja, mint a Profil — így a ranglista- és a
          beállítás-gomb ugyanoda esik fentről és jobbról is.
        */}
        <header className="screen-header terr__header" style={{ justifyContent: 'space-between' }}>
          <h1 className="screen-header__title">Grund</h1>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button
              type="button"
              className="screen-header__back"
              aria-label={overlayVisible ? 'Csak a térkép' : 'Adatok megjelenítése'}
              aria-pressed={!overlayVisible}
              onClick={() => setOverlayVisible((v) => !v)}
            >
              <EyeIcon open={overlayVisible} />
            </button>
            <button
              type="button"
              className="screen-header__back"
              aria-label={boardOpen ? 'Vissza a térképhez' : 'Ranglista'}
              aria-pressed={boardOpen}
              onClick={() => setBoardOpen((open) => !open)}
            >
              <TrophyIcon />
            </button>
          </div>
        </header>

        {overlayVisible ? (
        <div className="terr__content">

        <LayerSwitch value={layer} onChange={setLayer} />

        <div className="terr__stats">
          <div className="terr__stat">
            <span className="terr__stat-value">
              {formatArea(profile?.territoryM2[layer] ?? 0)}
            </span>
            <span className="terr__stat-label">a Te grundod</span>
          </div>
          <div className="terr__stat">
            {/* A profilból, tehát az ÖSSZES meződ — nem csak a látott
                szakaszon lévők. A korábbi „védett mező" a nézetből számolt,
                ezért változott pásztázáskor, és nem lehetett érteni. */}
            <span className="terr__stat-value">{profile?.cellCount[layer] ?? 0}</span>
            <span className="terr__stat-label">mezőid</span>
          </div>
          <div className="terr__stat">
            <span className="terr__stat-value">{groups.others.length}</span>
            <span className="terr__stat-label">másoké</span>
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

        {/*
          A szabályok magyarázata egyszer hasznos, aztán útban van. Bezárható,
          és a bezárást megjegyezzük — aki elolvasta, tudja.
        */}
        {helpOpen ? (
          <div className="terr__legend terr__legend--closable">
            <button
              type="button"
              className="terr__legend-close"
              aria-label="Magyarázat bezárása"
              onClick={() => {
                setHelpOpen(false);
                write(HELP_KEY, 'closed');
              }}
            >
              ✕
            </button>
            {showingFree
              ? 'A halvány mezők szabadok — bárkié lehetnek, aki bezár egy kört körülöttük.'
              : 'Közelíts rá, és a szabad mezők is megjelennek.'}{' '}
            A védelem naponta egy szintet veszít, de sosem esik 1 alá: a terület a tiéd marad,
            csak egyre könnyebb elvenni.
          </div>
        ) : null}

        {/* Ez viszont NEM bezárható: nem magyarázat, hanem a nézet állapota —
            enélkül a felhasználó szabadnak hinné, amiről nem kérdeztünk. */}
        {tiles?.partial ? (
          <p className="terr__legend">Közelíts rá a térképre, hogy lásd a mezőket!</p>
        ) : null}
        {/* A jelmagyarázat legalul: a térképet nézve ritkán kell,
              és felül a lényeges számok elől venné el a helyet. */}
        <div className="terr__legend-box">
          {/* A kapcsoló csak a feliratot fogja körül, nem a teljes sávot: egy
              összecsukott jelmagyarázat ne foglaljon el egy egész sort. */}
          <button
            type="button"
            className="terr__legend-toggle"
            aria-expanded={legendOpen}
            onClick={() => {
              setLegendOpen(!legendOpen);
              write(LEGEND_KEY, legendOpen ? 'closed' : 'open');
            }}
          >
            Jelmagyarázat
            <ChevronIcon up={legendOpen} />
          </button>

          {legendOpen ? (
            <div className="terr__legend-grid">
              <Swatch role="interior" label="A tiéd, védve" />
              <Swatch role="stolen" label="A tiéd, 1-es szinten" />
              <Swatch role="rival" label="Másé" />
              <Swatch role="free" label="Szabad" />
            </div>
          ) : null}
        </div>
        </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A jelmagyarázat mintája UGYANABBÓL a színtáblából dolgozik, mint a térkép.
 *
 * Korábban a kettő külön volt definiálva, és el is tért: a térkép borostyánnal
 * rajzolta a saját, 1-es szintű területet, a magyarázat halványlilát mutatott.
 */
function Swatch({ role, label }: { role: HexRole; label: string }) {
  const color = ROLE_COLOR[role];
  return (
    <span className="terr__legend-item">
      <span
        className="terr__swatch"
        aria-hidden="true"
        style={
          role === 'free'
            ? { borderColor: color, borderStyle: 'dashed', background: 'transparent' }
            : { borderColor: color, background: color }
        }
      />
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

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* privát böngészés — a választás nem marad meg, de működik */
  }
}

function ChevronIcon({ up }: { up: boolean }) {
  return (
    <svg
      className={`terr__chevron${up ? ' terr__chevron--up' : ''}`}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9.5 12 15l6-5.5" />
    </svg>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.8" />
      {open ? null : <path d="M4 4l16 16" />}
    </svg>
  );
}
