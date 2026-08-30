import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RivalBadge } from '@/components/RivalBadge';
import { cellToChildren } from 'h3-js';
import type { HexRole } from '@/components/HexMap';
import { Avatar } from '@/components/ActivityCard';
import { LayerSwitch } from '@/components/ui';
import { mapboxConfigured } from '@/lib/mapbox';
import {
  api,
  apiConfigured,
  type LeaderboardEntry,
  type LeaderboardWindow,
  type TerritoryBlobsResult,
  type TileOwner,
  type TilesResult,
} from '@/lib/api';
import { useProfile } from '@/hooks/ProfileProvider';
import { formatArea } from '@/lib/format';
import { useSharedPosition } from '@/hooks/useSharedPosition';
import { RIVAL_MAX_COLOR, ROLE_COLOR } from '@/lib/hexColors';
import type { Layer } from '@/types';
import './territory.css';

import type { MapViewProps } from '@/components/MapView';

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

/**
 * Az a nagyítás, amitől már MINDEN területfolt látszik.
 *
 * A méretszűrés a `TERRITORY_FULL_DETAIL_WIDTH_KM` (70 km) nézetszélességnél
 * kapcsol be, ami mérve a 10-es nagyítás környéke. Efölött nincs elrejtett
 * terület, tehát a „közelíts rá" felszólítás sem indokolt.
 */
const FULL_DETAIL_MIN_ZOOM = 10;

const LEGEND_KEY = 'grundo.territory.legend';
const HELP_KEY = 'grundo.territory.help';

type View = { south: number; west: number; north: number; east: number; zoom: number };

/**
 * A `tiles`-hívás határát a látható terület szélén TÚLRA kell tolni, hogy a
 * cellák a képernyő szélének elérése ELŐTT betöltődjenek, ne a felhasználó
 * szeme láttára, mozgás/nagyítás közben (HANDOFF #20, Geri megfigyelése).
 * A `blobs` ettől független, előszámolt egységben jön (lásd `api.ts`
 * `territoryBlobs` docstring), azt nem kell kitolni.
 */
const TILE_PREFETCH_PAD = 0.75;

function padView(view: View): View {
  const latPad = (view.north - view.south) * TILE_PREFETCH_PAD;
  const lngPad = (view.east - view.west) * TILE_PREFETCH_PAD;
  return {
    south: view.south - latPad,
    west: view.west - lngPad,
    north: view.north + latPad,
    east: view.east + lngPad,
    zoom: view.zoom,
  };
}

/**
 * Terület.
 *
 * A térkép MINDIG látszik, akkor is, ha még nincs saját területed — sőt főleg
 * akkor: aki most kezdi, épp azt akarja tudni, mi van körülötte és mi szabad.
 */
export function TerritoryScreen() {
  const { profile } = useProfile();
  /**
   * A megnyitott réteg MEGMARAD a következő látogatásra.
   *
   * Aki bringás, annak minden egyes belépésnél átkapcsolni bosszantó — a
   * felület ne felejtse el, min dolgozik. A `localStorage` a helyes tár erre:
   * eszközfüggő beállítás, nem játékadat, tehát nem a profilba való.
   */
  const [layer, setLayer] = useState<Layer>(() => (read(LAYER_KEY) === 'bike' ? 'bike' : 'foot'));

  useEffect(() => {
    write(LAYER_KEY, layer);
  }, [layer]);
  const [tiles, setTiles] = useState<TilesResult | null>(null);
  const [blobs, setBlobs] = useState<TerritoryBlobsResult | null>(null);
  const [board, setBoard] = useState<LeaderboardEntry[] | null>(null);
  const [boardWindow, setBoardWindow] = useState<LeaderboardWindow>('alltime');
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
  /**
   * Látszanak-e a hexmezők a térképen?
   *
   * Külön kapcsoló a szem ikontól: az az ADATOKAT (fejléc, statisztikák,
   * ranglista) rejti el, ez pedig a MEZŐKET. Aki a puszta térképet akarja
   * nézni — mert egy utcanevet keres, vagy csak a nyomvonalára kíváncsi —,
   * annak a háló zavaró.
   */
  const [cellsVisible, setCellsVisible] = useState(true);
  /** A megkoppintott mező tulajdonosa. `null` = nincs nyitva kártya. */
  const [ownerCard, setOwnerCard] = useState<TileOwner | null>(null);
  const [ownerLoading, setOwnerLoading] = useState(false);
  // Alapból ZÁRVA: a jelmagyarázat egyszer hasznos, utána helyet foglal.
  const [legendOpen, setLegendOpen] = useState(() => read(LEGEND_KEY) === 'open');
  const [helpOpen, setHelpOpen] = useState(() => read(HELP_KEY) !== 'closed');

  /**
   * A pozíció a MEGOSZTOTT fixből jön, nem közvetlenül a böngészőtől.
   *
   * Asztali gépen a böngésző WiFi- és IP-becslést ad, ami több kilométert
   * téved — a felhasználó a saját grundja helyett egy másik kerületet látna.
   * A `useSharedPosition` a telefon pontosabb fixét is figyelembe veszi.
   */
  const sharedPosition = useSharedPosition(profile?.uid);
  useEffect(() => {
    if (sharedPosition) setPosition({ lat: sharedPosition.lat, lng: sharedPosition.lng });
  }, [sharedPosition]);

  useEffect(() => {
    if (!apiConfigured) return;
    // Nézetváltáskor a régi lista eltűnik, amíg az új be nem jön — különben
    // egy pillanatra a MÁSIK ablak számai látszanának a friss fejléc alatt.
    setBoard(null);
    void api
      .leaderboard(layer, boardWindow)
      .then((r) => setBoard(r.entries))
      .catch(() => setBoard([]));
  }, [layer, boardWindow]);

  const loadTiles = useCallback(
    async (next: View) => {
      if (!apiConfigured) return;
      /**
       * A KÉT RÉTEG EGYSZERRE, de EGYMÁSTÓL FÜGGETLENÜL.
       *
       * A `tiles` a nézet közepének celláit adja (hatszögrács, védelmi
       * szintek), a `blobs` az összefüggő területfoltokat — az utóbbi
       * nézettől független, előszámolt egység, ezért az marad a
       * birtokviszony képe akkor is, amikor a cellák már rég kiestek a
       * szűk sugárból. `allSettled`, hogy az egyik hibája ne vigye el a
       * másikat: inkább lássunk foltokat rács nélkül, mint üres térképet.
       */
      const [tilesResult, blobsResult] = await Promise.allSettled([
        api.tiles(layer, padView(next)),
        api.territoryBlobs(layer, next),
      ]);
      setTiles(tilesResult.status === 'fulfilled' ? tilesResult.value : null);
      setBlobs(blobsResult.status === 'fulfilled' ? blobsResult.value : null);
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
   * Koppintás egy foglalt mezőre → a tulajdonos kártyája.
   *
   * A kártya adatát KOPPINTÁSKOR kérjük le, nem a csempékkel együtt: a
   * profilkép, a rang és az összesítők minden csempe-lekérésnél átvinni
   * pazarlás lenne, hiszen egyszerre legfeljebb egy kártya látszik.
   */
  const onCellPress = useCallback(
    async ({ owner }: { cell: string; owner: string }) => {
      if (!apiConfigured || !owner) return;
      setOwnerLoading(true);
      setOwnerCard(null);
      try {
        const result = await api.tileOwner(owner, layer);
        setOwnerCard(result.owner);
      } catch {
        // A tulajdonos időközben törölhette a fiókját — ilyenkor nincs kártya.
        setOwnerCard(null);
      } finally {
        setOwnerLoading(false);
      }
    },
    [layer],
  );

  /**
   * A cellák három csoportba kerülnek, mert a felhasználót három kérdés
   * érdekli: mi az enyém, mi máséé, és mi szabad.
   */
  const groups = useMemo(() => {
    const mine: Array<{ cell: string; defense: number; owner: string }> = [];
    const others: Array<{ cell: string; defense: number; owner: string }> = [];
    const taken = new Set<string>();

    for (const c of tiles?.cells ?? []) {
      taken.add(c.cell);
      // A tulajdonos is átmegy a térképnek: koppintásra ebből lesz a kártya.
      const rendered = { cell: c.cell, defense: c.defense, owner: c.owner };
      if (c.owner === uid) mine.push(rendered);
      else others.push(rendered);
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

    return { mine, others, free };
  }, [tiles, uid, zoom]);

  const showingFree = groups.free.length > 0;

  /**
   * A TÉRKÉP PROPJAI MEMOIZÁLVA — nem apróság, hanem a Grund képernyő
   * legdrágább ismétlődő munkája.
   *
   * A `MapView` az `[layers, ownerColors]`, illetve a `[blobs, ownerColors]`
   * függőségpárokra szinkronizál. Amíg ez a kettő a JSX-ben született
   * literál volt, MINDEN render — minden pásztázás, minden koppintás, minden
   * betöltés — újraépítette a teljes hexagon-GeoJSON-t, cellánként egy
   * `cellToBoundary` hívással, majd `setData`-val újracsempéztette a
   * Mapboxszal. A `groups` memója emiatt semmit sem ért.
   *
   * (GRUNDO #21 energiaelemzés, B3 — ugyanez a hiba a rögzítés képernyőn is.)
   */
  const mapLayers = useMemo<NonNullable<MapViewProps['layers']>>(
    () =>
      cellsVisible
        ? [
            { role: 'free', cells: groups.free },
            { role: 'rival', cells: groups.others },
            { role: 'interior', cells: groups.mine },
          ]
        : [],
    [cellsVisible, groups.free, groups.others, groups.mine],
  );

  const mapOwnerColors = useMemo(
    () => ({ ...blobs?.ownerColors, ...tiles?.ownerColors }),
    [blobs?.ownerColors, tiles?.ownerColors],
  );

  /**
   * A tulajdonos kártyája — a MEGKOPPINTOTT MEZŐHÖZ horgonyozva.
   *
   * A térkép popupjába megy, nem a felületi rétegbe: így pontosan ott jelenik
   * meg, ahova koppintottál, pásztázáskor a mezővel együtt mozog, és a Mapbox
   * gondoskodik arról, hogy a képernyő szélén befelé forduljon. Korábban a
   * képernyő aljára volt kötve, ahol a Dock takarta.
   */
  const ownerPopup =
    ownerLoading || ownerCard ? (
      <div className="terr__owner" role="dialog" aria-label="A mező tulajdonosa">
        {ownerCard ? (
          <>
            <div className="terr__owner-avatar">
              {ownerCard.photoURL ? (
                <img src={ownerCard.photoURL} alt="" />
              ) : (
                <span>{ownerCard.username.slice(0, 1).toUpperCase()}</span>
              )}
            </div>
            <div className="terr__owner-body">
              <strong className="terr__owner-name">
                {ownerCard.username} <RivalBadge uid={ownerCard.uid} />
              </strong>
              <span className="terr__owner-rank">{ownerCard.rankName}</span>
              <span className="terr__owner-stats">
                {formatArea(ownerCard.areaM2)} · {ownerCard.gpTotal.toLocaleString('hu-HU')} GP
              </span>
            </div>
          </>
        ) : (
          <span className="terr__owner-loading">Betöltés…</span>
        )}
        <button
          type="button"
          className="terr__owner-close"
          aria-label="Bezárás"
          onClick={() => {
            setOwnerCard(null);
            setOwnerLoading(false);
          }}
        >
          ×
        </button>
      </div>
    ) : null;

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
              /* ⚠️ MEMOIZÁLVA — lásd `mapLayers`/`mapOwnerColors` fent. */
              layers={mapLayers}
              /*
                A területfoltok MINDEN nagyításon látszanak — a hexagonok
                csak közelről jönnek rájuk. A hexagon-kapcsoló a rácsot
                rejti el, nem a birtokviszonyt.
              */
              blobs={cellsVisible ? blobs?.blobs : undefined}
              /* Mindenki a saját választott színében látszik a térképen. */
              ownerColors={mapOwnerColors}
              position={position}
              follow={false}
              /* Nyitott ranglistánál a pozíció-gomb a lista elé lógna. */
              hideRecenter={boardOpen}
              onViewport={onViewport}
              onCellPress={onCellPress}
              cellPopup={ownerPopup}
              allowTilt
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
              aria-label={cellsVisible ? 'Mezők elrejtése' : 'Mezők megjelenítése'}
              aria-pressed={!cellsVisible}
              onClick={() => setCellsVisible((v) => !v)}
            >
              <HexIcon on={cellsVisible} />
            </button>
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

        {/*
          A RANGLISTA SAJÁT ÁG, és NEM függ a szem ikontól.

          Két oka van. (1) A szem ikon a térkép ADATRÁTÉTEIT rejti el — a
          ranglista nem rátét, hanem külön nézet; aki tiszta térképet kért,
          attól még ne tűnjön el a lista, amit épp megnyitott. (2) Nyitott
          ranglistánál a rétegváltó és a statisztika-panel csak elveszi a
          helyet: iOS-en a dobogóval együtt annyi maradt, hogy a tabella
          egyáltalán nem fért ki. Nyitva tehát CSAK a lista látszik, és az
          kapja a teljes maradék magasságot.
        */}
        {boardOpen ? (
          <div className="terr__content terr__content--board">
            <Leaderboard
              entries={board}
              meUid={uid}
              boardWindow={boardWindow}
              onWindowChange={setBoardWindow}
              onClose={() => setBoardOpen(false)}
            />
          </div>
        ) : overlayVisible ? (
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

        {/*
          Ez NEM bezárható: nem magyarázat, hanem a nézet állapota — enélkül a
          felhasználó szabadnak hinné, amiről nem kérdeztünk.

          ⚠️ CSAK KIZOOMOLVA. Geri kérése (2026-08-28): a 10-es nagyítás fölött
          elrejtjük. Onnantól ugyanis MINDEN területfolt látszik (lásd
          `TERRITORY_FULL_DETAIL_WIDTH_KM`), tehát a „közelíts rá" felszólítás
          félrevezető lenne — nincs elrejtett terület, amit elő kellene hívni.
          Alatta viszont a méretszűrés valóban elhagy foltokat, ott van értelme.
        */}
        {tiles?.partial && zoom <= FULL_DETAIL_MIN_ZOOM ? (
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
              <Swatch role="interior" label="A te területed" />
              <Swatch role="rival" defense={1} label="Másé · 1-es" />
              <Swatch role="rival" defense={2} label="Másé · 2-es" />
              <Swatch role="rival" defense={3} label="Másé · 3-as" />
              <Swatch role="rival" defense={4} label="Másé · 4-es" />
              <Swatch role="rival" defense={5} label="Másé · 5-ös" />
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
function Swatch({ role, label, defense = 3 }: { role: HexRole; label: string; defense?: number }) {
  const color = role === 'rival' && defense === 5 ? RIVAL_MAX_COLOR : ROLE_COLOR[role];
  const opacity = defense === 1 ? 0 : defense === 2 ? 15 : defense === 3 ? 50 : defense === 4 ? 90 : 100;
  return (
    <span className="terr__legend-item">
      <span
        className="terr__swatch"
        aria-hidden="true"
        style={
          role === 'free' || defense === 1
            ? {
                borderColor: color,
                borderStyle: role === 'free' ? 'dashed' : 'solid',
                background: 'transparent',
              }
            : {
                borderColor: color,
                background: `color-mix(in srgb, ${color} ${opacity}%, transparent)`,
              }
        }
      />
      {label}
    </span>
  );
}

/** Cím és üres-állapot szövege nézetenként — a `WINDOW_TABS` sorrendjét lásd lent. */
const WINDOW_COPY: Record<LeaderboardWindow, { title: string; empty: string }> = {
  alltime: { title: 'Legnagyobb területek', empty: 'Még senkinek nincs területe. Légy te az első.' },
  day: { title: 'Ma szerzett terület', empty: 'Ma még senki nem szerzett területet.' },
  week: { title: 'E héten szerzett terület', empty: 'Ezen a héten még senki nem szerzett területet.' },
  month: { title: 'E hónapban szerzett terület', empty: 'Ebben a hónapban még senki nem szerzett területet.' },
};

const WINDOW_TABS: { key: LeaderboardWindow; label: string }[] = [
  { key: 'day', label: 'Napi' },
  { key: 'week', label: 'Heti' },
  { key: 'month', label: 'Havi' },
  { key: 'alltime', label: 'Mindenkori' },
];

function Leaderboard({
  entries,
  meUid,
  boardWindow,
  onWindowChange,
  onClose,
}: {
  entries: LeaderboardEntry[] | null;
  meUid: string;
  boardWindow: LeaderboardWindow;
  onWindowChange: (window: LeaderboardWindow) => void;
  onClose: () => void;
}) {
  const copy = WINDOW_COPY[boardWindow];
  const head = (
    <div className="terr__board-head">
      <h2 className="terr__board-title">{copy.title}</h2>
      <button type="button" className="terr__board-close" aria-label="Bezárás" onClick={onClose}>
        ✕
      </button>
    </div>
  );

  /*
    A fülsor MINDIG látszik, betöltés és üres állapot alatt is — különben aki
    egy üres napi nézeten landol, nem tudna átváltani anélkül, hogy bezárná
    és újranyitná a lapot.
  */
  const tabs = (
    <div className="terr__board-tabs" role="tablist" aria-label="Ranglista időszaka">
      {WINDOW_TABS.map((tab) => (
        <button
          type="button"
          key={tab.key}
          role="tab"
          aria-selected={tab.key === boardWindow}
          className={`terr__board-tab${tab.key === boardWindow ? ' terr__board-tab--active' : ''}`}
          onClick={() => onWindowChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  if (entries === null) {
    return (
      <div className="terr__board">
        {head}
        {tabs}
        <p className="terr__board-message">Betöltés…</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="terr__board">
        {head}
        {tabs}
        <p className="terr__board-message">{copy.empty}</p>
      </div>
    );
  }

  const navigate = useNavigate();
  const podium = entries.slice(0, 3);

  return (
    <div className="terr__board">
      {head}
      {tabs}
      {podium.length > 0 ? <Podium entries={podium} meUid={meUid} /> : null}
      {/*
        A SZÁMOZOTT LISTA KÜLÖN GÖRGET, a fejléc, a fülsor és a dobogó marad.
        Így a felhasználó akkor is végig tudja nézni a mezőnyt, ha a dobogó
        elvitte a képernyő felét — és mindig látja, melyik nézetben van.
      */}
      <div className="terr__board-list">
        {entries.map((entry, index) => (
          <button
            type="button"
            key={entry.uid}
            className={`terr__board-row${entry.uid === meUid ? ' terr__board-row--me' : ''}`}
            onClick={() => navigate(`/felhasznalo/${encodeURIComponent(entry.username)}`)}
            aria-label={`${entry.username} profiljának megnyitása`}
          >
            <span className="terr__board-rank">{index + 1}.</span>
            <Avatar url={entry.photoURL} name={entry.username} size={28} />
            <span className="terr__board-identity">
              <span className="terr__board-name">{entry.username}</span>
              <RivalBadge uid={entry.uid} />
            </span>
            <span className="terr__board-area">{formatArea(entry.areaM2)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Top 3 — pódium.
 *
 * A megjelenítési sorrend BALRÓL JOBBRA ezüst-arany-bronz, a hagyományos
 * dobogó szerint, nem a helyezés szerint. A sávok magassága a legjobb
 * helyezetthez viszonyított, arányos terület — így egy szoros mezőnyben a
 * sávok is közel egyformák, egy nagy előnynél pedig azonnal látszik a
 * különbség. Visszafogott, egyszínű jelmagyarázat (Geri kérésére): a
 * sávok a meglévő `--tier-*` tokenekből kapnak halvány tónust, nem a
 * referenciakép élénk zöld/lila/kék hátterét másoljuk.
 */
function Podium({ entries, meUid }: { entries: LeaderboardEntry[]; meUid: string }) {
  const navigate = useNavigate();
  const top = entries[0]?.areaM2 || 1;
  const order = [entries[1], entries[0], entries[2]] as const;
  const tone = ['silver', 'gold', 'bronze'] as const;
  /** Legmagasabb sáv 88 px (arany), legalacsonyabb sose 28 px alá — üres
      terület mellett is látszódjon, hogy ott áll valaki. */
  const MAX_BAR_PX = 88;
  const MIN_BAR_PX = 28;

  return (
    <div className="terr__podium">
      {order.map((entry, slot) => {
        if (!entry) return <div key={`empty-${slot}`} className="terr__podium-col" aria-hidden="true" />;
        const rank = entries.indexOf(entry) + 1;
        const heightPx = Math.max(MIN_BAR_PX, Math.round((entry.areaM2 / top) * MAX_BAR_PX));
        return (
          <button
            type="button"
            key={entry.uid}
            className={`terr__podium-col${entry.uid === meUid ? ' terr__podium-col--me' : ''}`}
            onClick={() => navigate(`/felhasznalo/${encodeURIComponent(entry.username)}`)}
            aria-label={`${rank}. hely: ${entry.username}, ${formatArea(entry.areaM2)}`}
          >
            {rank === 1 ? <CrownIcon /> : null}
            <Avatar url={entry.photoURL} name={entry.username} size={rank === 1 ? 44 : 36} />
            <span className="terr__podium-name">{entry.username}</span>
            <span className="terr__podium-area">{formatArea(entry.areaM2)}</span>
            <span
              className={`terr__podium-bar terr__podium-bar--${tone[slot]}`}
              style={{ height: `${heightPx}px` }}
            >
              <span className="terr__podium-rank">{rank}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CrownIcon() {
  return (
    <svg
      className="terr__podium-crown"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19.5 18h-15L3 8.5Z" />
    </svg>
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

/** A legutóbb választott réteg kulcsa. */
const LAYER_KEY = 'grundo.territory.layer';

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

/**
 * Hexagon — a mezők ki/be kapcsolása.
 *
 * A hatszög a GRUNDO alapegysége, ezért ez a legbeszédesebb ikon erre. Kikapcsolt
 * állapotban áthúzzuk, ugyanúgy, ahogy a szem ikonnál is — így a két gomb
 * állapota egy pillantással összehasonlítható.
 */
function HexIcon({ on }: { on: boolean }) {
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
      <path d="M12 2.6 20.2 7.3v9.4L12 21.4 3.8 16.7V7.3z" />
      {on ? null : <path d="M4 4l16 16" />}
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
