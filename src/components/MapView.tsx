import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import mapboxgl from 'mapbox-gl';
import { cellToBoundary, cellToLatLng } from 'h3-js';
import type { CellId } from '@/types';
import { useThemeContext } from '@/hooks/ThemeProvider';
import { mapStyleFor } from '@/lib/theme';
import { mapboxConfigured, mapboxToken } from '@/lib/mapbox';
import { smoothBearing, trackBearing } from '@/lib/heading';
import {
  interpolateMapPosition,
  isUserCameraMove,
  mapMotionDuration,
  type MapPosition,
} from '@/lib/mapMotion';
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
  /**
   * AZ ÖSSZEFÜGGŐ TERÜLETFOLTOK — a térkép fő területrétege.
   *
   * Előszámolt, nézettől független egységek a `/api/tiles/blobs`-ból. Ezek
   * adják a birtokviszony képét MINDEN nagyításon; a `layers` cellái csak
   * közelről, a hatszögrács és a védelmi szintek megmutatására jönnek rá.
   */
  blobs?: readonly { id: string; owner: string; areaM2: number; rings: [number, number][][] }[];
  /** uid → választott cellaszín kulcsa, a `/api/tiles` válaszából. */
  ownerColors?: Record<string, string>;
  /**
   * A NYOMVONAL színe HEXKÓDKÉNT — a felhasználó választott cellaszíne.
   *
   * Geri kérése (2026-09-01): rögzítés közben a saját út és a saját mezők ne
   * az általános lila szerep-színben legyenek. Hiányában marad a
   * `ROLE_COLOR.trail`.
   */
  trailColor?: string | null;
  position?: MapPosition | null;
  follow?: boolean;
  hideRecenter?: boolean;
  allowTilt?: boolean;
  /** A 2D/3D felirat helyett észak-fent / menetirány-fent kapcsoló. */
  navigationModeControl?: boolean;
  hexesVisible?: boolean;
  onToggleHexes?: () => void;
  fitTrack?: boolean;
  height?: number;
  fill?: boolean;
  onViewport?: (view: { south: number; west: number; north: number; east: number; zoom: number }) => void;
  onCellPress?: (info: { cell: CellId; owner: string }) => void;
  cellPopup?: ReactNode;
  /**
   * Aktívan növekvő nyomvonal-e a `track`?
   *
   * `true`-nál a nyomvonal-rajzolás (nem a pozíciópötty!) legfeljebb
   * `TRACK_SYNC_MIN_INTERVAL_MS`-enként frissül — lásd a `syncTrackData`
   * hívási helyén lévő magyarázatot. Alapból `false`: a befejezett
   * aktivitásokat mutató képernyők (Feed, Aktivitás, Grund) egyszer kapják
   * meg a nyomvonalat, ott a throttle semmit nem gyorsítana, csak
   * feleslegesen bonyolítaná a viselkedést.
   */
  live?: boolean;
}

const TRACK_SOURCE = 'grundo-track';
const GHOST_SOURCE = 'grundo-ghost';
const CELL_SOURCE = 'grundo-cells';
/** A szabad hatszogracs KULON forrasa — lasd `addLayers` magyarazatat. */
const GRID_SOURCE = 'grundo-grid';
const AREA_SOURCE = 'grundo-areas';
const BLOB_SOURCE = 'grundo-blobs';
const CELL_DETAIL_MIN_ZOOM = 15;
/**
 * A cellánkénti területréteg (`AREA_SOURCE`) alsó nagyítási határa.
 *
 * Eggyel a hatszögrács alatt: a védelmi szintek árnyalása még azelőtt
 * megjelenik, hogy az egyes hatszögek kirajzolódnának, de már nem olyan
 * távolról, ahonnan a nyers hatszög-körvonal recés szegélyként látszana a
 * sima területfolton.
 */
const AREA_DETAIL_MIN_ZOOM = CELL_DETAIL_MIN_ZOOM - 1;
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
 * A kézi visszaközpontosítás rövid, de jól követhető átmenete. Az automatikus
 * követés hossza a GPS-minták időközéből jön (`mapMotionDuration`), hogy a
 * kamera két minta között is folyamatosan haladjon.
 */
const RECENTER_DURATION_MS = 400;

/**
 * Élő rögzítésnél ennyi ideig várunk KÉT nyomvonal-`setData` hívás között.
 *
 * Futótempón (~3 m/s) ez ~6 méteres, bringatempón (~8 m/s) ~16 méteres
 * lemaradást jelent a vonal VÉGÉN — a követő nagyításon (16-os zoom, kb.
 * 100-200 m látható szélesség) ez nem észrevehető, cserébe a `setData`
 * hívások száma a töredékére csökken (GRUNDO #21 energiaelemzés, B7). A
 * POZÍCIÓ ettől függetlenül minden mintánál frissül.
 */
const TRACK_SYNC_MIN_INTERVAL_MS = 3_000;

/**
 * A menetirány simítása.
 *
 * A navigációs nézetnek gyorsan kell befordulnia a kanyarba, de az új irányt
 * nem ugorhatja meg egyetlen képkockában. A 0,65-ös súly két-három mintán
 * belül beáll, a 15 méteres navigációs bázis pedig a zaj nagy részét előtte
 * már kiszűri.
 */
const BEARING_SMOOTHING = 0.65;
/** Navigációban rövidebb bázis kell, hogy a térkép hamarabb vegye a kanyart. */
const NAVIGATION_BEARING_BASE_M = 15;

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
  blobs,
  ownerColors,
  trailColor = null,
  position,
  follow = true,
  hideRecenter = false,
  allowTilt = false,
  navigationModeControl = false,
  hexesVisible,
  onToggleHexes,
  fitTrack = false,
  height = 320,
  fill = false,
  onViewport,
  onCellPress,
  cellPopup,
  live = false,
}: MapViewProps) {
  const { theme } = useThemeContext();
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const marker = useRef<mapboxgl.Marker | null>(null);
  const markerPosition = useRef<MapPosition | null>(null);
  const markerAnimation = useRef(0);
  const ready = useRef(false);
  const centered = useRef(false);
  const fitted = useRef(false);
  const trackRef = useRef(track);
  const ghostTrackRef = useRef(ghostTrack);
  const layersRef = useRef(layers);
  const ownerColorsRef = useRef(ownerColors);
  const trailColorRef = useRef(trailColor);
  const blobsRef = useRef(blobs);
  const fitTrackRef = useRef(fitTrack);
  trackRef.current = track;
  ghostTrackRef.current = ghostTrack;
  layersRef.current = layers;
  ownerColorsRef.current = ownerColors;
  trailColorRef.current = trailColor;
  blobsRef.current = blobs;
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
  const lastTrackSyncAt = useRef(0);
  const lastTrackSyncLength = useRef(0);

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
      addLayers(instance, trailColorRef.current);
      syncData(instance, trackRef.current, ghostTrackRef.current, layersRef.current, ownerColorsRef.current, trailColorRef.current, blobsRef.current);
      fitTrackOnce(instance, trackRef.current, fitTrackRef.current, fitted);
      report(instance);
    });

    instance.on('moveend', () => report(instance));

    const pauseFollow = (event: unknown) => {
      if (!isUserCameraMove(event as { originalEvent?: unknown })) return;
      followPaused.current = true;
      setShowRecenter(true);
    };
    // Egyetlen Mapbox-esemény lefedi a húzást, csippentést, görgős zoomot és
    // forgatást. A három külön `dragstart`/`zoomstart`/`rotatestart` figyelő
    // mobilon nem minden gesztussorozatot látott, ezért a visszaközpontosító
    // hol megjelent, hol nem.
    instance.on('movestart', pauseFollow);

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
      markerPosition.current = null;
      cancelAnimationFrame(markerAnimation.current);
      instance.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (instance === null || !ready.current) return;
    const restore = () => {
      addLayers(instance, trailColorRef.current);
      syncData(instance, trackRef.current, ghostTrackRef.current, layersRef.current, ownerColorsRef.current, trailColorRef.current, blobsRef.current);
    };
    instance.once('style.load', restore);
    instance.setStyle(mapStyleFor(theme));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null || !ready.current) return;

    const length = track?.length ?? 0;
    /**
     * ⚠️ A NYOMVONAL-RAJZOLÁS THROTTOLVA, HA `live` — A POZÍCIÓPÖTTY NEM.
     *
     * A `setData` a teljes koordinátatömböt újraküldi a Mapboxnak, ami a
     * belső tesszellálást és a GPU-feltöltést is újrafuttatja — élő
     * rögzítésnél korábban ez MINDEN GPS-mintánál lefutott, a nyomvonal
     * hosszával arányosan növekvő költséggel (GRUNDO #21 energiaelemzés,
     * B7). A pozíció (`position` prop, `mapview__dot`) külön hatókörben,
     * throttle nélkül frissül továbbra is — a felhasználó AZT nézi menet
     * közben, a mögötte húzódó vonal néhány másodperces lemaradása a
     * követő nagyításon (16-os zoom) nem észrevehető.
     *
     * MINDIG AZONNAL SZINKRONIZÁL: üres/rövid nyomvonalnál (indítás), ha a
     * hossz CSÖKKENT (visszaállás/reset), és — ez a legfontosabb — amikor
     * `live` HAMISRA VÁLT. Utóbbi a befejezés pillanata: enélkül az utolsó,
     * throttle-ban ragadt néhány másodpercnyi szakasz véglegesen hiányozna
     * a térképről, mert utána már nem érkezik új GPS-minta, ami a
     * feleslegessé vált időzítést újra kioldaná.
     */
    const isReset = length < lastTrackSyncLength.current;
    const mustSyncNow = !live || length <= 2 || isReset;
    const dueByTime = Date.now() - lastTrackSyncAt.current >= TRACK_SYNC_MIN_INTERVAL_MS;

    if (mustSyncNow || dueByTime) {
      lastTrackSyncAt.current = Date.now();
      lastTrackSyncLength.current = length;
      syncTrackData(instance, track);
    }
    fitTrackOnce(instance, track, fitTrack, fitted);
  }, [track, fitTrack, live]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null || !ready.current) return;
    syncGhostData(instance, ghostTrack);
  }, [ghostTrack]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null || !ready.current) return;
    syncAreaData(instance, layers, ownerColors);
    syncCellData(instance, layers, ownerColors, trailColor);
  }, [layers, ownerColors, trailColor]);

  /**
   * A SZABAD RÁCS KÜLÖN HATÁS, KÜLÖN FÜGGŐSÉGGEL.
   *
   * A háttérháló csak új csempeválasznál változik, a nyomvonal viszont pár
   * másodpercenként. A `layers` tömb minden rendernél új, a benne lévő
   * szabad cellák tömbje viszont memoizált (`TrackingScreen` `nearbyFree`) —
   * ezért a hatás ARRA a hivatkozásra figyel, nem a burkoló tömbre. Így egy
   * új nyomvonal-cella nem építi újra a tizenháromezres hálót.
   */
  useEffect(() => {
    const instance = map.current;
    if (instance === null || !ready.current) return;
    if (!instance.getLayer(`${TRACK_SOURCE}-line`)) return;
    instance.setPaintProperty(
      `${TRACK_SOURCE}-line`,
      'line-color',
      trailColor ?? cssColor(ROLE_COLOR.trail),
    );
  }, [trailColor]);

  const gridCells = layers?.find((layer) => layer.role === 'free')?.cells;
  useEffect(() => {
    const instance = map.current;
    if (instance === null || !ready.current) return;
    syncGridData(instance, layersRef.current);
  }, [gridCells]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null || !ready.current) return;
    syncBlobData(instance, blobs, ownerColors);
  }, [blobs, ownerColors]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null || position == null) return;

    if (marker.current === null) {
      const dot = document.createElement('div');
      dot.className = 'mapview__dot';
      marker.current = new mapboxgl.Marker({ element: dot })
        .setLngLat([position.lng, position.lat])
        .addTo(instance);
      markerPosition.current = position;
    } else {
      const from = markerPosition.current ?? position;
      const duration = prefersReducedMotion() ? 0 : mapMotionDuration(from, position);
      cancelAnimationFrame(markerAnimation.current);
      if (duration === 0) {
        marker.current.setLngLat([position.lng, position.lat]);
        markerPosition.current = position;
      } else {
        const startedAt = performance.now();
        const step = (now: number) => {
          const progress = Math.min(1, (now - startedAt) / duration);
          const current = interpolateMapPosition(from, position, progress);
          marker.current?.setLngLat([current.lng, current.lat]);
          markerPosition.current = current;
          if (progress < 1) markerAnimation.current = requestAnimationFrame(step);
        };
        markerAnimation.current = requestAnimationFrame(step);
      }
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
        const measured = trackBearing(
          bearingTrack(trackRef.current, position),
          NAVIGATION_BEARING_BASE_M,
        );
        if (measured !== null) {
          bearingRef.current =
            bearingRef.current === null
              ? measured
              : smoothBearing(bearingRef.current, measured, BEARING_SMOOTHING);
        }
      }
      const bearing = tilted ? bearingRef.current : null;
      const previous = markerPosition.current ?? position;
      instance.easeTo({
        center: [position.lng, position.lat],
        duration: prefersReducedMotion() ? 0 : mapMotionDuration(previous, position),
        easing: linearEasing,
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
          aria-label={
            navigationModeControl
              ? tilted
                ? 'Észak legyen felfelé'
                : 'Térkép forgatása a haladási irányba'
              : tilted
                ? 'Felülnézet (2D)'
                : 'Bedöntött nézet (3D)'
          }
          title={
            navigationModeControl
              ? tilted
                ? 'Észak felfelé'
                : 'Haladási irány felfelé'
              : tilted
                ? 'Felülnézet'
                : 'Bedöntött nézet'
          }
          onClick={() => {
            const next = !tilted;
            setTilted(next);
            writeTiltPreference(next);
          }}
        >
          {navigationModeControl ? (
            tilted ? <NavigationIcon /> : <CompassIcon />
          ) : tilted ? '2D' : '3D'}
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
                pitch: tilted ? TILTED_PITCH : 0,
                bearing: tilted ? (bearingRef.current ?? target.getBearing()) : 0,
                duration: RECENTER_DURATION_MS,
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

function linearEasing(progress: number): number {
  return progress;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function CompassIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m12 5 3.2 8.3L12 12l-3.2 1.3L12 5Z" fill="currentColor" />
      <path d="m12 19-3.2-8.3L12 12l3.2-1.3L12 19Z" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

function NavigationIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.1 10.7 20.2 3.8a.7.7 0 0 1 .9.9l-6.9 16.1a.7.7 0 0 1-1.3-.1l-2.2-7.4-7.4-2.2a.7.7 0 0 1-.1-1.3Z" />
    </svg>
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

function addLayers(instance: mapboxgl.Map, trailColor: string | null): void {
  /**
   * A FOLTRÉTEG MEGY LEGALULRA — szándékosan ELSŐKÉNT hozzáadva.
   *
   * A Mapbox a hozzáadás sorrendjében rétegez, tehát ami előbb kerül fel, az
   * kerül hátrébb. Így a közeli nézet cellánkénti hatszögei (`AREA`/`CELL`)
   * ráülnek a foltra, nem alá. A kettő ugyanazt a területet írja le, csak más
   * részletességgel: a folt minden nagyításon ott van, a hatszögek csak
   * közelről jönnek rá.
   */
  if (!instance.getSource(BLOB_SOURCE)) {
    instance.addSource(BLOB_SOURCE, { type: 'geojson', data: emptyCollection() });
    instance.addLayer({
      id: `${BLOB_SOURCE}-fill`,
      type: 'fill',
      source: BLOB_SOURCE,
      paint: {
        'fill-color': ['get', 'color'],
        /**
         * KÖZELRŐL HALVÁNYABB. Ott a cellánkénti réteg mutatja a részleteket
         * (védelmi szint, rács), és ha a folt teli erővel alatta maradna, a
         * kettő egymásra rakódva sötét, olvashatatlan pacát adna.
         */
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], CELL_DETAIL_MIN_ZOOM - 1, 0.34, CELL_DETAIL_MIN_ZOOM + 1, 0.16],
      },
    });
    instance.addLayer({
      id: `${BLOB_SOURCE}-line`,
      type: 'line',
      source: BLOB_SOURCE,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['get', 'outlineColor'],
        // Kizoomolva vékonyabb, hogy a kis foltok ne olvadjanak vonalpacává.
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 1.8, 16, 2.6],
        'line-opacity': 0.95,
      },
    });
  }

  /**
   * A CELLÁNKÉNTI területréteg CSAK KÖZELRŐL.
   *
   * ⚠️ EZ EGY VALÓDI HIBA VOLT (Geri jelezte, 2026-08-28): a réteg a nyers,
   * hatszögről hatszögre pontos körvonalat rajzolja, és `minzoom` nélkül
   * MINDEN nagyításon látszott. Kizoomolva ez a ~9 méteres fűrészfog finom,
   * recés szegélyként ült rá a sima területfoltra — „túl részletes rajzolat"
   * olyan távolságból, ahonnan már nem szabadna látszania.
   *
   * A birtokviszonyt kizoomolva a foltréteg (`BLOB_SOURCE`) mutatja; ennek a
   * rétegnek egyetlen dolga maradt, amit a folt nem tud: a védelmi szint
   * szerinti árnyalás közelről. Ezért indul ott, ahol a hatszögrács is
   * értelmessé válik.
   */
  if (!instance.getSource(AREA_SOURCE)) {
    instance.addSource(AREA_SOURCE, { type: 'geojson', data: emptyCollection(), ...HEX_SOURCE });
    instance.addLayer({
      id: `${AREA_SOURCE}-fill`,
      type: 'fill',
      source: AREA_SOURCE,
      minzoom: AREA_DETAIL_MIN_ZOOM,
      paint: {
        'fill-color': ['get', 'color'],
        // Átúszás, hogy a réteg ne pattanjon be egyik képkockáról a másikra.
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          AREA_DETAIL_MIN_ZOOM,
          0,
          AREA_DETAIL_MIN_ZOOM + 1,
          ['coalesce', ['get', 'opacity'], 0.2],
        ],
      },
    });
    instance.addLayer({
      id: `${AREA_SOURCE}-line`,
      type: 'line',
      source: AREA_SOURCE,
      minzoom: AREA_DETAIL_MIN_ZOOM,
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
        'line-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          AREA_DETAIL_MIN_ZOOM,
          0,
          AREA_DETAIL_MIN_ZOOM + 1,
          0.9,
        ],
      },
    });
  }

  /**
   * A SZABAD RÁCS SAJÁT FORRÁSBAN — és ez egy MÉRT teljesítményhiba javítása.
   *
   * ⚠️ A szabad hatszögek (a „létezik itt rács" háttérháló) ugyanabban a
   * GeoJSON-forrásban ültek, mint a nyomvonal és a birtokolt mezők. Mérve,
   * rögzítés közben (2026-09-01): a forrásban **13 733 poligon** volt, ebből
   * 13 700 a szabad rács és mindössze 13–33 a nyomvonal. Minden ÚJ
   * nyomvonal-cellánál — vagyis pár másodpercenként — a teljes,
   * tizenháromezres réteg újraépült és újracsempéződött.
   *
   * A következmény pontosan az volt, amit Geri jelzett: a nyomvonal VONALA
   * (külön, egyelemű forrás) mindig naprakész, a hatszögek viszont
   * lemaradnak. Ugyanabban a mérésben: az app 33 cellát tartott számon, a
   * forrás is 33-at, a ténylegesen KIRAJZOLT viszont csak 12-t.
   *
   * A háttérháló ritkán változik (csak új csempeválasznál), a nyomvonal
   * sűrűn. Külön forrásban a kettő nem rántja magával egymást.
   */
  if (!instance.getSource(GRID_SOURCE)) {
    instance.addSource(GRID_SOURCE, { type: 'geojson', data: emptyCollection(), ...HEX_SOURCE });
    instance.addLayer({
      id: `${GRID_SOURCE}-line`,
      type: 'line',
      source: GRID_SOURCE,
      minzoom: CELL_DETAIL_MIN_ZOOM,
      paint: {
        'line-color': cssColor(ROLE_COLOR.free),
        'line-width': 1.2,
        'line-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          CELL_DETAIL_MIN_ZOOM,
          0,
          16.5,
          ROLE_LINE_OPACITY.free,
        ],
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
        /*
          A NYOMVONAL SŰRŰBBEN TÖLT. Egy 2-5. szintű saját területen áthaladva
          a 0,08-as egységes kitöltés gyakorlatilag eltűnt a mezők alatt —
          nem lehetett látni, merre jártunk (Geri, 2026-09-01).
        */
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          CELL_DETAIL_MIN_ZOOM,
          0,
          16.5,
          ['case', ['coalesce', ['get', 'trail'], false], 0.3, 0.08],
        ],
      },
    });
    instance.addLayer({
      id: `${CELL_SOURCE}-line`,
      type: 'line',
      source: CELL_SOURCE,
      minzoom: CELL_DETAIL_MIN_ZOOM,
      paint: {
        'line-color': ['get', 'color'],
        // Vastagabb körvonal a nyomvonalnak — ugyanaz az indok, mint fent.
        'line-width': ['case', ['coalesce', ['get', 'trail'], false], 2.8, 1.2],
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
    /**
     * SZEGÉLY A NYOMVONAL ALATT.
     *
     * ⚠️ Ez teszi lehetővé, hogy a vonal a felhasználó SAJÁT színét viselje.
     * Enélkül a saját területen áthaladva a vonal ugyanolyan színű lenne,
     * mint alatta a birtok, és egyszerűen eltűnne benne (Geri, 2026-09-01).
     * A világos/sötét felületszínű szegély minden területszíntől elüt, tehát
     * az útvonal bármilyen háttéren olvasható marad.
     */
    instance.addLayer({
      id: `${TRACK_SOURCE}-casing`,
      type: 'line',
      source: TRACK_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': cssColor('var(--bg-elevated)'),
        'line-width': 8,
        'line-opacity': 0.9,
      },
    });
    instance.addLayer({
      id: `${TRACK_SOURCE}-line`,
      type: 'line',
      source: TRACK_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': trailColor ?? cssColor(ROLE_COLOR.trail), 'line-width': 4 },
    });
  }
}

function syncData(
  instance: mapboxgl.Map,
  track: MapViewProps['track'],
  ghostTrack: MapViewProps['ghostTrack'],
  layers: MapViewProps['layers'],
  ownerColors: MapViewProps['ownerColors'],
  trailColor: string | null,
  blobs: MapViewProps['blobs'],
): void {
  syncBlobData(instance, blobs, ownerColors);
  syncGridData(instance, layers);
  syncAreaData(instance, layers, ownerColors);
  syncCellData(instance, layers, ownerColors, trailColor);
  syncTrackData(instance, track);
  syncGhostData(instance, ghostTrack);
}

/**
 * AZ ÖSSZEFÜGGŐ FOLTOK kirajzolása.
 *
 * A körvonal készen érkezik a szerverről (előszámolt, egyszerűsített), ezért
 * itt nincs se cellaösszevonás, se geometriai munka — pontosan ettől stabil
 * a kép: ugyanaz a folt ugyanazt a poligont adja, akárhonnan nézzük.
 */
function syncBlobData(
  instance: mapboxgl.Map,
  blobs: MapViewProps['blobs'],
  ownerColors: MapViewProps['ownerColors'],
): void {
  const source = instance.getSource(BLOB_SOURCE) as mapboxgl.GeoJSONSource | undefined;
  if (!source) return;

  const features = [];
  for (const blob of blobs ?? []) {
    if (blob.rings.length === 0) continue;
    const color = cellColorHex(ownerColors?.[blob.owner]);
    features.push({
      type: 'Feature' as const,
      properties: { id: blob.id, owner: blob.owner, color, outlineColor: color },
      geometry: { type: 'Polygon' as const, coordinates: blob.rings },
    });
  }

  source.setData({ type: 'FeatureCollection', features });
}

/**
 * A SZABAD HATSZÖGRÁCS kirajzolása — saját, ritkán frissülő forrásba.
 *
 * Csak körvonal: a háló tájékozódási segéd, kitöltés nélkül (a régi 0,006-os
 * kitöltés a gyakorlatban láthatatlan volt, viszont minden hatszöghöz egy
 * felesleges kitöltés-geometriát jelentett).
 */
function syncGridData(instance: mapboxgl.Map, layers: MapViewProps['layers']): void {
  const source = instance.getSource(GRID_SOURCE) as mapboxgl.GeoJSONSource | undefined;
  if (!source) return;

  const features = [];
  for (const layer of layers ?? []) {
    if (layer.role !== 'free') continue;
    for (const entry of layer.cells) {
      const cell = typeof entry === 'string' ? entry : entry.cell;
      features.push({
        type: 'Feature' as const,
        properties: { cell },
        geometry: { type: 'Polygon' as const, coordinates: [closedRing(cell)] },
      });
    }
  }
  source.setData({ type: 'FeatureCollection', features });
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
  trailColor: string | null,
): void {
  const cellSource = instance.getSource(CELL_SOURCE) as mapboxgl.GeoJSONSource | undefined;
  if (!cellSource) return;

  const features = [];
  for (const layer of layers ?? []) {
    // A szabad rács a saját, ritkán frissülő forrásába megy (`syncGridData`).
    if (layer.role === 'free') continue;
    for (const entry of layer.cells) {
      const cell = typeof entry === 'string' ? entry : entry.cell;
      const defense = clampDefense(typeof entry === 'string' ? 1 : entry.defense ?? 1);
      const owner = typeof entry === 'string' ? '' : (entry.owner ?? '');
      const territory = isTerritoryRole(layer.role);
      const trail = layer.role === 'trail';
      /**
       * A NYOMVONAL A FELHASZNÁLÓ SAJÁT SZÍNÉBEN — Geri kérése (2026-09-01):
       * „ne a default lilát használjuk". Ha nincs választott szín, marad a
       * szerep alapszíne.
       */
      const color = territory
        ? areaColor(layer.role, defense, owner, ownerColors)
        : trail && trailColor
          ? trailColor
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
          trail,
          lineOpacity: trail ? 1 : ROLE_LINE_OPACITY[layer.role],
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
