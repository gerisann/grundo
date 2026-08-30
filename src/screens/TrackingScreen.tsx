import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cellToChildren, latLngToCell } from 'h3-js';
import { Button, SegmentedControl } from '@/components/ui';
import { HexMap } from '@/components/HexMap';
import type { MapViewProps } from '@/components/MapView';
import { SaveActivityForm } from '@/components/SaveActivityForm';
import { SavedRoutesSheet } from '@/components/SavedRoutesSheet';
import { useRecorderContext } from '@/hooks/RecorderProvider';
import { useProfile } from '@/hooks/ProfileProvider';
import { useSharedPosition } from '@/hooks/useSharedPosition';
import { useClaimProgress } from '@/hooks/useClaimProgress';
import type { RecorderApi } from '@/hooks/useRecorder';
import { mapboxConfigured } from '@/lib/mapbox';
import { GAMEPLAY } from '@/config/gameplay';
import { layerOf, traceToCellPath } from '@/game/cells';
import { decodePolyline } from '@/game/polyline';
import { hasCompactInterior, IncrementalActivityGeometry, processActivityGeometry } from '@/game';
import { api, apiConfigured, type Mission, type TerritoryBlobsResult, type TilesResult } from '@/lib/api';
import { readGhostRoute, rememberGhostRoute } from '@/lib/ghostRoute';
import { isNativeApp, isNativeIos } from '@/lib/platform';
import {
  currentSpeedMps,
  lapDistances,
  movingMs,
  paceSecPerKm,
  type RecorderState,
} from '@/tracking/recorder';
import {
  formatArea,
  formatDistance,
  formatDuration,
  formatLiveSpeed,
  formatPace,
} from '@/lib/format';
import './tracking.css';

/**
 * A Mapbox lustán töltődik: saját csomagja 521 kB tömörítve — hatszorosa a
 * belépő csomagnak (88 kB) —, és csak ezen a képernyőn kell.
 */
const MapView = lazy(() => import('@/components/MapView').then((m) => ({ default: m.MapView })));

const WAKE_NOTE_KEY = 'grundo.hint.wakelock';

/**
 * Rögzítés.
 *
 * A térkép a HÁTTÉR, minden más fölötte lebeg — rögzítés közben a felhasználó
 * azt nézi, merre jár, az adatok csak ráolvasás.
 *
 * A KORLÁT, amit nem hallgatunk el: böngészőben a mérés csak addig megy, amíg
 * az oldal látható. Ha a felhasználó lezárja a telefont vagy másik appra vált,
 * a rögzítés megszakad — sem az iOS, sem az Android nem ad webes API-t
 * háttér-helymeghatározásra.
 */
export function TrackingScreen() {
  const recorder = useRecorderContext();
  const profileUid = useProfile().profile?.uid ?? '';
  const { state } = recorder;
  const {
    pendingType: type,
    setPendingType,
    pickerOpen,
    setPickerOpen,
    countdown,
    setStatsFullView,
  } = recorder;
  const candidateRemoteState = state.status === 'idle' ? recorder.remoteState : null;
  const [dismissedRemoteId, setDismissedRemoteId] = useState<string | null>(null);
  const remoteState = candidateRemoteState?.activityId === dismissedRemoteId
    ? null
    : candidateRemoteState;
  const displayPoints = remoteState?.points ?? state.points;
  /**
   * Indítás előtt a kiválasztott típust kell megjeleníteni, nem a még el sem
   * indult rögzítő előző/alapértelmezett típusát. Enélkül a Bringa gomb aktív
   * lehetett úgy, hogy a térkép továbbra is a gyalogos réteget kérte le.
   *
   * `type` (`pendingType`) indításig `null` is lehet — a `?? 'run'` csak a
   * belső számításoknak (térképréteg, előnézet) kell, a MEGJELENÍTETT
   * választás (lásd a mozgásforma-választó modult) továbbra is `type`-ot
   * olvassa közvetlenül, üresen, amíg nincs kiválasztva semmi.
   */
  const displayType = remoteState?.type ?? (state.status === 'idle' ? (type ?? 'run') : state.type);
  const displayDistanceM = remoteState?.distanceM ?? state.distanceM;
  /**
   * A szellemvonal — a Küldetések képernyőn kiválasztott ajánlat útvonala.
   *
   * Egyszer olvassuk be, a képernyő megnyitásakor: ha közben egy másik
   * küldetést generálnának egy másik lapon, ez a rögzítés a sajátjához
   * ragaszkodik, nem cserél alattunk útvonalat félúton.
   */
  const [ghostRoute, setGhostRoute] = useState(() => readGhostRoute());
  const ghostTrack = useMemo(
    () => (ghostRoute ? decodePolyline(ghostRoute.polyline) : []),
    [ghostRoute],
  );
  const [savedRoutesOpen, setSavedRoutesOpen] = useState(false);
  const [showHexes, setShowHexes] = useState(true);

  /**
   * A statisztika-panel HÁROM nézete — Geri kérése (2026-08-27):
   *   compact  — egy sor, összecsukva
   *   expanded — 2×2 rács, ikonokkal
   *   full     — teljes képernyő, térkép nélkül
   * A csík (`.track__panel-grip`) lépteti compact→expanded→full és vissza
   * full→expanded felé; a panel törzsére koppintva compact⇄expanded, mint
   * eddig. A `full` bit külön is megy a rögzítőbe (`statsFullView`), mert
   * a Dock — más komponens — is tud róla: teljes nézetben a dokk háttere
   * beleolvad a panelbe.
   */
  const [statsView, setStatsView] = useState<'compact' | 'expanded' | 'full'>('compact');
  useEffect(() => {
    setStatsFullView(statsView === 'full');
  }, [statsView, setStatsFullView]);

  /**
   * Egy mentett útvonal kiválasztása — MÁR a rögzítés képernyőn állunk, tehát
   * nincs navigáció, csak a szellemvonal cseréje élőben.
   */
  function selectSavedRoute(mission: Mission) {
    rememberGhostRoute(mission);
    setGhostRoute({ polyline: mission.polyline, kind: mission.kind });
    setSavedRoutesOpen(false);
  }
  const distanceBucket = Math.floor(displayDistanceM / 25);

  // Az eltelt idő magától nem változik — az állapot csak mintaérkezéskor
  // frissül, márpedig állva percekig nem jön minta. Saját ütem kell hozzá.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.status !== 'recording' && remoteState?.status !== 'recording') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.status, remoteState?.status]);

  /**
   * A drága foglalási előnézetet nem minden GPS-mintára, hanem minden ÚJ
   * H3-cellára frissítjük. A korábbi öt GPS-pontos köteg bringánál 20–40
   * méteres látható lemaradást okozott, majd egyszerre „behozta” a cellákat.
   * Így ugyanabban a cellában továbbra sincs fölösleges flood fill, de a
   * térképi fal legfeljebb egyetlen cellával maradhat le.
   */
  const cellPath = useMemo(() => traceToCellPath(displayPoints).path, [displayPoints]);
  const cellRevision = `${cellPath.length}:${cellPath.at(-1) ?? ''}`;

  const [nearby, setNearby] = useState<TilesResult | null>(null);
  const [nearbyBlobs, setNearbyBlobs] = useState<TerritoryBlobsResult | null>(null);
  const [nearbyView, setNearbyView] = useState<{
    south: number;
    west: number;
    north: number;
    east: number;
    zoom: number;
  } | null>(null);

  /**
   * A hurokgeometria gyorsítótára — ugyanaz, amit a Simulation LAB használ.
   *
   * A nyomvonal rögzítés közben csak FOLYTATÓDIK, ezért felesleges minden
   * frissítésnél az egész addigi aktivitást újraszámolni. Mérve, városi
   * útvonalon: a teljes újraszámolás 4 km-en 139 ms, 11 km-en 197 ms, 20 km-en
   * 337 ms volt, és ennek a java (128 / 164 / 289 ms) maga a geometria.
   * Inkrementálisan ugyanez frissítésenként átlag 29 ms, legrosszabb 64 ms.
   *
   * Route reset vagy visszamenőleges eltérés esetén az osztály magától
   * újraépít, tehát a helyes eredmény nem függ ettől a gyorsítótártól.
   */
  const geometryCache = useRef(new IncrementalActivityGeometry());
  const geometrySession = useRef('');

  /**
   * Melyik rögzítéshez tartozik a gyorsítótár.
   *
   * Az `update()` magától újraépít, ha az új nyomvonal nem a régi folytatása —
   * DE ha valaki ugyanarról a pontról indít új futást, az első cellák
   * véletlenül egyezhetnek, és akkor az előző futás hurkai bennragadnának.
   * Ezért a rögzítés azonosságát külön nézzük.
   */
  const geometrySessionKey = `${remoteState?.activityId ?? ''}:${displayPoints[0]?.t ?? ''}`;

  /**
   * Élő előnézet: mi lenne, ha MOST fejezném be?
   *
   * A motort a térkép legutóbbi birtok-pillanatképével futtatjuk. A végleges
   * eredmény továbbra is szerveroldali, de így menet közben már külön látszik
   * az új, az elrabolt és a megerősített mező, a várható védelmi szinttel.
   */
  const preview = useMemo(() => {
    if (displayPoints.length < 2) {
      return { path: [] as string[], claimable: [] as string[], own: [], stolen: [], gp: 0 };
    }
    if (geometrySession.current !== geometrySessionKey) {
      geometryCache.current.reset();
      geometrySession.current = geometrySessionKey;
    }
    try {
      const geometry = geometryCache.current.update(displayPoints);
      /**
       * Nagy (compact belsejű) huroknál a motor SZÁNDÉKOSAN dob, ha valódi
       * ownershipet kap (`game/index.ts` `processActivityGeometry` őre) — a
       * valódi elszámolás a szerver blokkos útján történik, itt csak előnézet
       * kell. Enélkül egy nagy bringakör, ami meglévő birtok mellett halad el
       * (szinte mindig, hiszen a `nearby` majdnem sosem üres), a `catch`-ig
       * futott, és a preview NULLA claimet/GP-t mutatott — miközben a
       * feltöltés után a terület ténylegesen bekerült (HANDOFF #20 nyitott
       * ügye). Üres ownershippel hívva a compact ág ugyanazt az „üres világ"
       * elszámolást adja, mint a LAB — a GP-becslés pontos, csak a lopott/
       * visszafoglalt cellák MEGKÜLÖNBÖZTETÉSE vész el élő nézetben.
       */
      const hasCompactLoop = geometry.loops.some(hasCompactInterior);
      const ownership = hasCompactLoop
        ? new Map<string, { owner: string; defense: number }>()
        : new Map(
            (nearby?.cells ?? []).map((cell) => [cell.cell, { owner: cell.owner, defense: cell.defense }]),
          );
      const result = processActivityGeometry(
        {
          points: displayPoints,
          type: displayType,
          distanceKm: displayDistanceM / 1000,
          actorId: profileUid || 'preview',
          ownership,
          streakDays: 0,
          gpEarnedToday: 0,
        },
        geometry,
      );
      const own: { cell: string; defense: number; preview: true }[] = [];
      const stolen: { cell: string; defense: number; preview: true }[] = [];
      const claimable: string[] = [];
      for (const [cell, fate] of result.claim?.fates ?? []) {
        if (fate === 'breakthrough') continue;
        const item = { cell, defense: result.claim?.updates.get(cell)?.defense ?? 1, preview: true as const };
        (fate === 'stolen' ? stolen : own).push(item);
        claimable.push(cell);
      }
      return { path: cellPath, claimable, own, stolen, gp: result.gp.total };
    } catch {
      // A motor túl nagy hurokra kivételt dob (GPS-ugrás). A nyom attól még
      // rajzolható — az előnézet hiánya nem indok arra, hogy a térkép is
      // kiessen.
      return { path: cellPath, claimable: [] as string[], own: [], stolen: [], gp: 0 };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellRevision, distanceBucket, state.status, geometrySessionKey, displayType, nearby, profileUid]);

  const cells = preview.path;

  /**
   * A KÖRNYÉK birtokviszonya rögzítés közben.
   *
   * Futás közben az az érdekes kérdés, hogy „hova érdemes mennem" — arra pedig
   * csak akkor lehet válaszolni, ha látod, mi van már elfoglalva körülötted.
   */
  const nearbyCache = useRef(new Map<string, TilesResult>());
  const nearbyLayer = useRef(layerOf(displayType));

  /**
   * A LEGUTÓBB LEKÉRT terület — hogy ne kérjünk le mindent újra minden
   * kameramozdulatra.
   *
   * Az `onViewport` minden `moveend`-nél tüzel, a kamera pedig mostantól
   * MINDEN pozíciófrissítésnél mozdul (másodpercenként, nem 3-4
   * másodpercenként). Változatlan lekérési logikával ez háromszor-négyszer
   * annyi `/api/tiles` hívást jelentene — a hexagonok pont attól kezdenének
   * akadozni, amitől gyorsítani akartuk őket.
   *
   * Ezért a látható nézetnél NAGYOBB dobozt kérünk le, és amíg a kamera ezen
   * belül marad, nem kérünk újat. Így a mozgás közbeni hívások száma csökken,
   * miközben a képernyő széle sem marad üresen.
   */
  const requestedBox = useRef<{
    south: number;
    west: number;
    north: number;
    east: number;
    layer: 'foot' | 'bike';
  } | null>(null);

  useEffect(() => {
    if (!apiConfigured || nearbyView === null) return;

    const layer = layerOf(displayType);

    const previous = requestedBox.current;
    if (
      previous !== null &&
      previous.layer === layer &&
      previous.south <= nearbyView.south &&
      previous.west <= nearbyView.west &&
      previous.north >= nearbyView.north &&
      previous.east >= nearbyView.east
    ) {
      return;
    }

    // 40% ráhagyás minden irányban: nagyjából fél képernyőnyi tartalék, ami
    // futótempóban több tíz másodpercnyi mozgást fed le.
    const padLat = (nearbyView.north - nearbyView.south) * 0.4;
    const padLng = (nearbyView.east - nearbyView.west) * 0.4;
    const box = {
      south: nearbyView.south - padLat,
      west: nearbyView.west - padLng,
      north: nearbyView.north + padLat,
      east: nearbyView.east + padLng,
    };
    requestedBox.current = { ...box, layer };

    let alive = true;
    const key = `${layer}:${box.south.toFixed(4)}:${box.west.toFixed(4)}:` +
      `${box.north.toFixed(4)}:${box.east.toFixed(4)}`;
    const cached = nearbyCache.current.get(key);

    // Mozgás közben a régi, azonos rétegű adat marad a térképen a válaszig:
    // ettől szűnik meg a piros mezők eltűnés-visszajövés villogása. Valódi
    // rétegváltáskor viszont nem mutathatunk foot adatot bike-ként.
    if (nearbyLayer.current !== layer) {
      nearbyLayer.current = layer;
      setNearby(cached ?? null);
    } else if (cached) {
      setNearby(cached);
    }
    void api
      .tiles(layer, box)
      .then((result) => {
        if (!alive) return;
        nearbyCache.current.set(key, result);
        setNearby(result);
      })
      // Hálózati hiba alatt a legutolsó ismert pillanatkép marad látható.
      .catch(() => undefined);

    /**
     * A TERÜLETFOLTOK — ugyanaz a réteg, mint a Grundon.
     *
     * Külön kérés, mert más a természete: a `tiles` a nézet közepének
     * celláit adja a hatszögrácshoz, ez viszont a nézettől független,
     * előszámolt foltokat. Rögzítés közben ettől látszik a környék teljes
     * birtokképe akkor is, amikor kizoomolsz.
     */
    void api
      .territoryBlobs(layer, box)
      .then((result) => {
        if (alive) setNearbyBlobs(result);
      })
      .catch(() => undefined);

    // Gyors oda-vissza váltásnál a lassabban visszaérő régi kérés nem írhatja
    // felül az új mozgásformához tartozó cellákat.
    return () => {
      alive = false;
    };
  }, [displayType, nearbyView]);

  const running = state.status === 'recording';
  const paused = state.status === 'paused';
  const done = state.status === 'finished';
  const idle = state.status === 'idle';

  const remoteElapsedMs = remoteState === null
    ? 0
    : remoteState.movingMs
      + (remoteState.status === 'recording' && remoteState.updatedAt > 0
        ? Math.max(0, now - remoteState.updatedAt)
        : 0);
  const elapsed = Math.floor(
    remoteState === null ? movingMs(state, now) / 1000 : remoteElapsedMs / 1000,
  );
  const pace = remoteState === null
    ? paceSecPerKm(state, now)
    : displayDistanceM > 0
      ? elapsed / (displayDistanceM / 1000)
      : null;

  /** A 100 méteres küszöb alatt nincs terület — lásd a befejezés utáni jelzést. */
  const countsAsActivity = displayDistanceM >= GAMEPLAY.MIN_DISTANCE_M;

  /**
   * A „Mentve." panel (a mentés-űrlappal) fedésben van a felső statisztika-
   * panellel és a térkép jobb alsó gombjaival (hexagon, 2D/3D) — Geri mérése
   * (2026-08-27): a lebegő gombok a mentés-panel fölé lógtak, a felső panel
   * pedig ugyanazokat a számokat ismételte, amik a „Mentve." panelen is ott
   * vannak. Ilyenkor mindhármat elrejtjük.
   */
  const savePanelOpen = done && countsAsActivity && recorder.upload.status === 'done';

  /**
   * A környék teljes birtokképe ugyanazzal a szintadattal ÉS tulajdonossal,
   * mint a Grundon — az `owner` mező kell a térképnek ahhoz, hogy mindenkit
   * a saját választott színében rajzoljon ki, ne az általános szerep-színben.
   */
  const nearbyOthers = useMemo(
    () => (nearby?.cells ?? [])
      .filter((c) => c.owner !== profileUid)
      .map((c) => ({ cell: c.cell, defense: c.defense, owner: c.owner })),
    [nearby, profileUid],
  );
  const nearbyMine = useMemo(
    () => (nearby?.cells ?? [])
      .filter((c) => c.owner === profileUid)
      .map((c) => ({ cell: c.cell, defense: c.defense, owner: c.owner })),
    [nearby, profileUid],
  );
  const nearbyFree = useMemo(() => {
    if ((nearbyView?.zoom ?? 0) < 15) return [];
    const taken = new Set((nearby?.cells ?? []).map((cell) => cell.cell));
    const free: string[] = [];
    for (const block of nearby?.blocks ?? []) {
      for (const cell of cellToChildren(block, GAMEPLAY.H3_RESOLUTION)) {
        if (!taken.has(cell)) free.push(cell);
      }
    }
    return free;
  }, [nearby, nearbyView?.zoom]);

  /**
   * A TÉRKÉP a nyomvonalnál gyorsabb forrást követ.
   *
   * A nyomvonalba csak ötméterenként kerül pont (lásd `FILTER.MIN_MOVE_M`),
   * ezért sétatempóban a pötty 3-4 másodpercenként ugrott egyet. A
   * `livePosition` minden pontos mintát átenged, tehát a pötty, a kamera és
   * a menetirány másodpercenként frissül — a megtett táv, a cellák és a GP
   * viszont továbbra is a szűrt nyomvonalból jön, változatlanul.
   *
   * Csak SAJÁT, futó mérésnél számít: a távoli (másik eszközön futó) mérésnek
   * nincs helyi GPS-e, befejezés után pedig a nyomvonal vége a helyes vég.
   */
  const liveActive =
    remoteState === null && (state.status === 'recording' || state.status === 'paused');
  const livePosition = recorder.livePosition;
  const liveFix = useMemo(
    () =>
      liveActive && livePosition
        ? { lat: livePosition.lat, lng: livePosition.lng }
        : null,
    [liveActive, livePosition],
  );

  /**
   * A NYOMVONAL-CELLA, amiben ÉPP állunk.
   *
   * A rács a szűrt nyomvonalból épül, ami ötméterenként lép — a felhasználó
   * tehát láthatta magát olyan hatszögben, ami még nem volt kiszínezve. Az
   * élő fix cellája ezt a maradék csúszást is elviszi. Kizárólag a
   * MEGJELENÍTÉST bővíti: a `preview.path` (és vele a mezőszámláló, a GP és
   * minden, amit a szerver újraszámol) érintetlen.
   */
  const liveCell = useMemo(
    () => (liveFix ? latLngToCell(liveFix.lat, liveFix.lng, GAMEPLAY.H3_RESOLUTION) : null),
    [liveFix],
  );
  const trailCells = useMemo(
    () => (liveCell === null || cells.at(-1) === liveCell ? cells : [...cells, liveCell]),
    [cells, liveCell],
  );

  /**
   * A Mapbox-rétegek referenciája csak valódi cellaváltozáskor változhat.
   *
   * Korábban a JSX-ben minden rendernél új tömb készült. A másodperces
   * stopper-render ezért a teljes, akár több ezer hatszögből álló GeoJSON-t
   * újra felépítette és `setData`-val a Mapboxnak adta. iOS WKWebViewben ez
   * rövid idő alatt memória-/GPU-nyomást és WebContent újraindulást tudott
   * okozni — pontosan ekkor jelent meg tévesen a félbehagyott rögzítés.
   */
  const mapHexLayers = useMemo<NonNullable<MapViewProps['layers']>>(
    () => showHexes ? [
      { role: 'free', cells: nearbyFree },
      { role: 'rival', cells: nearbyOthers },
      { role: 'interior', cells: nearbyMine },
      { role: 'interior', cells: preview.own },
      { role: 'stolen', cells: preview.stolen },
      { role: 'trail', cells: trailCells },
    ] : [],
    [showHexes, nearbyFree, nearbyOthers, nearbyMine, preview.own, preview.stolen, trailCells],
  );

  /**
   * A tulajdonosszínek is MEMOIZÁLVA — és pontosan ugyanazért, amiért a
   * rétegek (lásd a fenti magyarázatot).
   *
   * ⚠️ EZ A MEMO A FENTIT VÉDI MEG. A `MapView` a rétegeket az
   * `[layers, ownerColors]` függőségpárra szinkronizálja: ha az `ownerColors`
   * minden rendernél új objektumliterál, a `mapHexLayers` memója HIÁBA fog —
   * a `syncAreaData`/`syncCellData`/`syncBlobData` akkor is lefut, és
   * cellánként egy `cellToBoundary` hívással újraépíti a teljes GeoJSON-t.
   * A másodperces stopper-render (`setNow`) így önmagában újracsempézte a
   * több ezer hatszöget. Mérve nem lett, de a kód szerint minden renderen
   * lefutott (GRUNDO #21 energiaelemzés, B3).
   */
  const mapOwnerColors = useMemo(
    () => ({ ...nearbyBlobs?.ownerColors, ...nearby?.ownerColors }),
    [nearbyBlobs?.ownerColors, nearby?.ownerColors],
  );

  const lastPoint = displayPoints.length > 0 ? displayPoints[displayPoints.length - 1]! : null;


  /**
   * Indítás előtt is oda kell állítani a térképet, ahol a felhasználó van.
   *
   * A rögzítő csak indítás után kap pozíciót, addig a térkép egy alapértelmezett
   * ponton állna — ami mindenkinek rossz, aki nem Budapest belvárosában van.
   * Ezért egyszer, olcsón elkérjük a helyet: kis pontossággal, akár
   * gyorsítótárból. Nem mérünk vele, csak a nézetet igazítjuk.
   */
  /**
   * A kiindulási fix a MEGOSZTOTT pozícióból jön.
   *
   * Asztali gépen a böngésző csak WiFi- és IP-becslést tud, ami több
   * kilométert téved — a tű a fél városban máshova került. A telefon pontos
   * GPS-fixe viszont a közös dokumentumban van, és a `useSharedPosition` azt
   * választja, amelyik pontosabb.
   */
  const sharedPosition = useSharedPosition(profileUid);

  /**
   * MEMOIZÁLVA — és ez nem apróság.
   *
   * A térkép a `position` prop AZONOSSÁGÁRA figyel. Ha itt minden
   * újrarajzoláskor új objektum születne, a térkép rögzítés közben
   * másodpercenként újraközépre animálna — és a húzás meg a zoom
   * használhatatlanná válna, mert az animáció küzd az egérrel.
   */
  const homeFix = useMemo(
    () => (sharedPosition ? { lat: sharedPosition.lat, lng: sharedPosition.lng } : null),
    [sharedPosition],
  );

  /**
   * A megosztott fix CSAK TÉTLEN ÁLLAPOTBAN számít.
   *
   * Ha elindítottad a rögzítést, a saját GPS-pontjaid az igazság — a telefon
   * legutóbbi ismert helye onnantól nem érdekes, sőt káros: visszarángatná a
   * térképet oda, ahonnan éppen elindultál.
   *
   * Amíg az első pont meg nem érkezik, a térkép ott marad, ahol volt. Ez
   * jobb, mint egy ugrás egy másik városrészbe.
   */
  const mapPosition = liveFix ?? lastPoint ?? (state.status === 'idle' ? homeFix : null);

  /**
   * Az „Indítás" nyíl — MINDEN tétlen állapotban.
   *
   * Egy körre kikapcsoltuk (csak az első indításig látszott), de a felület
   * enélkül szegényebb lett: a Play gomb a Dockban ül, és önmagában nem
   * mondja meg, hogy azzal indul a rögzítés. Amíg nincs jobb bevezető,
   * maradjon ott — a tétlen képernyő úgyis üres, nem takar semmit.
   */
  const showStartHint = true;

  /*
   * A befejezés utáni AUTOMATIKUS feltöltés innen ELKÖLTÖZÖTT a
   * `useRecorder`-be (2026-08-26). Nem stílusrendezés volt: itt a hatás csak
   * akkor futott, ha ez a képernyő fel volt csatolva — a Befejezés gomb
   * viszont a `Dock`-ban van, tehát máshonnan befejezve a mérés NÉMÁN
   * elveszett. Az indoklás és az éles mérés a `useRecorder` fejlécében áll.
   *
   * Ne tedd vissza ide. Ami ITT marad, az a hiba utáni ÚJRAPRÓBÁLÁS gombja —
   * az tudatos felhasználói döntés, és van hozzá felület.
   */

  // A képernyő-figyelmeztetés bezárható: aki egyszer elolvasta, tudja.
  const [showWakeNote, setShowWakeNote] = useState(() => readFlag(WAKE_NOTE_KEY) === null);
  return (
    <div
      className={`track${done ? ' track--finished' : ''}${savePanelOpen ? ' track--save-open' : ''}${
        pickerOpen ? ' track--picker-open' : ''
      }${statsView === 'full' ? ' track--stats-full' : ''}`}
    >
      {/*
        TELJES NÉZETBEN A TÉRKÉP EGYÁLTALÁN NINCS KIRENDERELVE — Geri kérése
        (2026-08-27): „kapcsoljuk ki a térképet, egyáltalán nem kell
        megjeleníteni". Nem csak elrejtve (`display:none`): a Mapbox-példány
        le is áll, amíg a felhasználó a teljes statisztika-nézetben van.
      */}
      {statsView !== 'full' ? (
        <div className={`track__map${mapboxConfigured ? '' : ' track__map--plain'}`}>
          {mapboxConfigured ? (
            <Suspense fallback={null}>
              <MapView
                layers={mapHexLayers}
                track={displayPoints}
                ghostTrack={ghostTrack}
                position={mapPosition}
                allowTilt
                hexesVisible={showHexes}
                onToggleHexes={() => setShowHexes((visible) => !visible)}
                follow={running || remoteState?.status === 'recording'}
                onViewport={setNearbyView}
                /* A hexagon-kapcsoló a rácsot rejti, a birtokviszonyt nem. */
                blobs={showHexes ? nearbyBlobs?.blobs : undefined}
                /* Mindenki a saját választott színében látszik a térképen — ugyanaz, mint a Grundon.
                   ⚠️ MEMOIZÁLVA (`mapOwnerColors`), nem inline objektum — az utóbbi
                   minden rendernél kiütötte a `mapHexLayers` memóját. */
                ownerColors={mapOwnerColors}
                fill
              />
            </Suspense>
          ) : displayPoints.length > 1 ? (
            <HexMap layers={[{ role: 'trail', cells }]} track={displayPoints} height={420} />
          ) : (
            <p className="track__note">
              A nyomvonalad itt jelenik meg, amint elindulsz. Utcatérkép csak beállított
              Mapbox-tokennel látszik.
            </p>
          )}
        </div>
      ) : null}

      {/*
        A SZÜNET JELZÉSE A DOKKHOZ KÖLTÖZÖTT (Geri, 2026-08-26). Korábban itt
        egy lüktető doboz ült a képernyő közepén, ami épp a térképet takarta
        el — most a `Dock` sárga panelje úszik fel a vezérlők mögül
        (`dock__pause`). Egy helyen legyen, mert a szünet a rögzítés
        állapota, nem ezé a képernyőé: a dokk minden nézetben látszik.
      */}

      <div className="track__overlay">
        {remoteState !== null ? (
          <div className="track__note track__note--sync track__note--closable">
            <button
              type="button"
              className="track__note-close"
              aria-label="Üzenet bezárása"
              onClick={() => setDismissedRemoteId(remoteState.activityId)}
            >
              ✕
            </button>
            <strong>Mobilos aktivitásod legutóbbi állapota</strong>
            <span>
              {remoteState.status === 'recording'
                ? ' folyamatban'
                : remoteState.status === 'paused'
                  ? ' szünetel'
                  : ' befejezve'}
              {remoteState.updatedAt > 0 ? ` · ${relativeSyncTime(remoteState.updatedAt, now)}` : ''}
            </span>
          </div>
        ) : null}
        {recorder.resumable !== null ? (
          <div className="track__note track__note--warn">
            <strong>Van egy félbehagyott rögzítésed.</strong>{' '}
            {recorder.resumable.points.length} pont,{' '}
            {formatDistance(recorder.resumable.distanceM)}.
            {recorder.resumableNotice !== null ? <span> {recorder.resumableNotice}</span> : null}
            <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
              <Button size="sm" onClick={() => void recorder.restore()}>
                Folytatom
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void recorder.dismissResumable()}>
                Eldobom
              </Button>
            </div>
          </div>
        ) : null}

        {(running || paused) && !recorder.supportsBackground && showWakeNote ? (
          <div className="track__note track__note--warn track__note--closable">
            <button
              type="button"
              className="track__note-close"
              aria-label="Üzenet bezárása"
              onClick={() => {
                setShowWakeNote(false);
                writeFlag(WAKE_NOTE_KEY);
              }}
            >
              ✕
            </button>
            {/*
              A NATÍV ÉS A WEBES ESET KÉT KÜLÖN ÜZENET.

              Natív appban a mérést a `BackgroundLocationPlugin` végzi, a
              képernyő elalvása nem szakítja meg — a hiányzó darab kizárólag
              az engedély. A régi szöveg („tartsd bekapcsolva a képernyőt")
              ott félrevezetett, és a képernyőzár-tiltás óta (GRUNDO #21, B1)
              a natív ágon amúgy sincs mit jelenteni róla.
            */}
            {isNativeApp() ? (
              <>
                A lezárt képernyős méréshez add meg a helyhasználati engedélyt
                {isNativeIos() ? ' „Mindig”' : ' „Mindig engedélyezve”'} szinten. Enélkül a
                mérés csak addig pontos, amíg az app előtérben van.
              </>
            ) : (
              <>
                Tartsd bekapcsolva a képernyőt. Böngészőben a rögzítés megáll, ha a telefon
                lezáródik vagy másik appra váltasz.
                {recorder.wakeLockActive
                  ? ' A képernyőt ébren tartjuk.'
                  : ' A képernyő ébren tartása nem sikerült — állítsd hosszabbra a képernyő-időkorlátot.'}
              </>
            )}
          </div>
        ) : null}

        {recorder.error !== null ? (
          <div className="track__note track__note--error" role="alert">
            {recorder.error.message}
          </div>
        ) : null}


        {!idle || remoteState !== null ? (
          <>
            {/*
              A „Mentve." panel UGYANEZEKET A SZÁMOKAT hordozza (táv, GP,
              mező/bezárás), tehát a felette lévő élő statisztika-panel csak
              megismételné őket — és felül is fedte a mentés-űrlapot. Ekkor
              elrejtjük.
            */}
            {!savePanelOpen ? (
              <div className="track__panel-wrap">
                <StatsPanel
                  view={statsView}
                  onViewChange={setStatsView}
                  paused={paused}
                  distanceM={displayDistanceM}
                  elapsed={elapsed}
                  pace={pace}
                  claimableCells={preview.claimable.length}
                  expectedGp={preview.gp}
                  /* A cellák SZÁMA, nem a területük: futás közben a „38 mező"
                     megfogható, a „11 666 m²" nem. A négyzetméter az összegzésben
                     és a profilon számít. */
                  cells={countsAsActivity ? cells.length : null}
                  speedMps={remoteState?.speedMps ?? currentSpeedMps(state)}
                  hasFix={remoteState !== null ? displayPoints.length > 0 : recorder.hasFix}
                />
                {running || paused ? <PausePanel shown={paused} /> : null}
              </div>
            ) : null}

            {remoteState === null && state.laps.length > 1 ? (
              <LapList state={state} paused={paused} />
            ) : null}

            {done && !countsAsActivity ? (
              <div className="track__note track__note--too-short track__note--closable">
                {/*
                  BEZÁRÁS GOMB, NEM „ÉRTEM" GOMB — Geri kérése (2026-08-27):
                  a jobb felső ✕ ugyanúgy eldobja a rögzítést
                  (`recorder.discard()`), csak nem foglal helyet egy külön
                  gombsorral. Ugyanaz a minta, mint a „Mobilos aktivitásod…"
                  szinkron-üzenetnél lejjebb.
                */}
                <button
                  type="button"
                  className="track__note-close"
                  aria-label="Bezárás"
                  onClick={() => void recorder.discard()}
                >
                  ✕
                </button>
                <strong>Ez a rögzítés túl rövid lett.</strong> Legalább {GAMEPLAY.MIN_DISTANCE_M}{' '}
                méter kell ahhoz, hogy az aktivitás számítson — terület és pont nem jár érte.
              </div>
            ) : null}

            {done && countsAsActivity ? (
              <UploadPanel recorder={recorder} uid={profileUid} />
            ) : null}
          </>
        ) : null}
      </div>

      {idle && remoteState === null && showStartHint && !pickerOpen && countdown === null ? (
        <div className="track__hint" aria-hidden="true">
          <span className="track__hint-text">Indítás</span>
          <svg className="track__hint-arrow" viewBox="0 0 28 40" fill="none">
            <path
              d="M14 2v24"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="5 6"
            />
            <path d="M14 38l-9-13h18z" fill="currentColor" />
          </svg>
        </div>
      ) : null}

      {/*
        A MOZGÁSFORMA-VÁLASZTÓ — a Dock indítógombja fölött lebeg, ANNAK
        NYOMÁSÁRA nyílik (Geri kérése, 2026-08-27), nem automatikusan tétlen
        állapotban. A `pickerOpen`-t a Dock állítja: első koppintásra nyit
        (és `pendingType`-ot nullázza, hogy sose emlékezzen az előzőre),
        választás után marad nyitva, a MÁSODIK koppintásra zár és indul a
        visszaszámlálás.
      */}
      {idle && pickerOpen ? (
        <div className="track__type-picker">
          {/*
            BEZÁRÁS — Geri kérése (2026-08-27). A választás visszavonása:
            a Play gomb visszaáll az eredeti (gradiens, lüktető) állapotra,
            mintha az egész nem indult volna el.
          */}
          <button
            type="button"
            className="track__type-picker-close"
            aria-label="Mozgásforma-választó bezárása"
            onClick={() => {
              setPickerOpen(false);
              setPendingType(null);
            }}
          >
            ✕
          </button>
          <SegmentedControl
            label="Mozgásforma"
            block
            value={type}
            onChange={setPendingType}
            options={[
              { value: 'run', label: 'Futás' },
              { value: 'walk', label: 'Séta' },
              { value: 'ride', label: 'Bringa' },
            ]}
          />
          <Button block variant="ghost" size="sm" onClick={() => setSavedRoutesOpen(true)}>
            Mentett útvonalak
          </Button>
        </div>
      ) : null}

      {savedRoutesOpen ? (
        <SavedRoutesSheet
          onSelect={selectSavedRoute}
          onClose={() => setSavedRoutesOpen(false)}
        />
      ) : null}
    </div>
  );
}

/* A jelzések megjegyzése. Privát böngészésben a tárolás dobhat — ilyenkor úgy
   vesszük, hogy a jelzést már látta: jobb egyszer kihagyni, mint minden
   megnyitásnál újra az arcába tolni. */

/**
 * A mentés folyamata — VALÓDI haladással.
 *
 * Egy hétköznapi futás mentése egy pillanat: ott csak a „Mentés folyamatban"
 * felirat és a lélegző hatszögek látszanak. Egy nagyon nagy körnél viszont a
 * foglalás blokkcsoportokra bomlik, és a szerver csoportonként megírja, hol
 * tart — ilyenkor a felhasználó a TÉNYLEGES állapotot látja, nem egy előre
 * felvett folyamatjelzőt.
 *
 * Miért fontos ez? Egy Balaton-méretű mentés ~25 másodperc. Enélkül a
 * felhasználó egy néma feliratot néz, és azt hiszi, lefagyott az app.
 */
function SavingPanel({ activityId }: { activityId: string | null }) {
  const progress = useClaimProgress(activityId, true);
  const chunked = progress !== null && progress.total > 1;
  const ratio = chunked ? progress.done / progress.total : 0;

  /** Tizenkét hatszög — ennyi elég a látványhoz, és bármennyi szakaszra igaz. */
  const HEXES = 12;
  const filled = chunked ? Math.round(ratio * HEXES) : 0;

  return (
    <div className="track__panel track__saving" role="status" aria-live="polite">
      <div className="track__saving-hexes" aria-hidden="true">
        {Array.from({ length: HEXES }, (_, index) => (
          <span
            key={index}
            className={
              'track__saving-hex' +
              (chunked
                ? index < filled
                  ? ' track__saving-hex--on'
                  : ''
                : ' track__saving-hex--pulse')
            }
            /* Lépcsőzetes késleltetés: a hatszögek egymás után lélegzenek,
               ettől lesz mozgás akkor is, ha nincs mérhető haladás. */
            style={chunked ? undefined : { animationDelay: `${index * 90}ms` }}
          />
        ))}
      </div>

      <strong className="track__saving-title">
        {chunked ? 'Területek mentése' : 'Mentés folyamatban'}
      </strong>

      {chunked ? (
        <>
          <div className="track__saving-bar">
            <div
              className="track__saving-fill"
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </div>
          <span className="track__saving-note">
            {progress.done} / {progress.total} szakasz · nagy kör, ez eltarthat egy kicsit
          </span>
        </>
      ) : (
        <span className="track__saving-note">Az útvonal feltöltése és a terület elszámolása…</span>
      )}
    </div>
  );
}

function readFlag(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return '1';
  }
}

function writeFlag(key: string, value = '1'): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* nem baj */
  }
}

function relativeSyncTime(updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (seconds < 10) return 'éppen most frissült';
  if (seconds < 60) return `${seconds} mp-e frissült`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} perce frissült`;
  return `${Math.floor(minutes / 60)} órája frissült`;
}

/**
 * Körök: alapból csak az AKTUÁLIS és az ELŐZŐ.
 *
 * Egy órás futásnál húsz kör is lehet — kilistázva ellepné a képernyőt, és
 * pont azt takarná el, amiért a felhasználó odanéz: a térképet és az élő
 * adatokat. Futás közben az érdekes kérdés az, hogy „az előzőhöz képest
 * hogy állok", nem az, hogy mi volt a negyedik körben. A teljes lista egy
 * koppintással előhozható.
 */
function LapList({ state, paused }: { state: RecorderState; paused: boolean }) {
  const [expanded, setExpanded] = useState(false);
  /**
   * A kör-lista TELJESEN elrejthető.
   *
   * Futás közben a térkép a fontos: a körök panelje sok helyet vesz el
   * belőle, és a felhasználó nem mindig kíváncsi rá. Összecsukva csak egy
   * stopper ikon marad a bal szélen — arra koppintva visszajön.
   *
   * A döntést SZÁNDÉKOSAN nem jegyezzük meg: egy kör alatt hozott döntés a
   * következő futásra ne kösse meg a kezét.
   */
  const [collapsed, setCollapsed] = useState(false);

  /**
   * SZÜNETBEN AUTOMATIKUSAN ÖSSZECSUKVA — Geri kérése (2026-08-27): nyitva
   * a körök panelje a szünet-jelzés (`.track__pause`) MÖGÉ töltött be,
   * eltakarva azt. Felold folytatáskor: PONTOSAN oda áll vissza, ahol
   * szünet előtt volt (ha a felhasználó már összecsukta, nyitva marad
   * összecsukva, nem nyílik ki magától).
   */
  const beforePause = useRef<boolean | null>(null);
  useEffect(() => {
    if (paused) {
      setCollapsed((current) => {
        beforePause.current = current;
        return true;
      });
    } else if (beforePause.current !== null) {
      const restore = beforePause.current;
      beforePause.current = null;
      setCollapsed(restore);
    }
  }, [paused]);
  const distances = lapDistances(state);

  // Fordított sorrend: a legfrissebb kör legyen elöl.
  const rows = distances
    .map((meters, index) => ({ meters, index }))
    .reverse();
  const shown = expanded ? rows : rows.slice(0, 2);
  const hidden = rows.length - shown.length;

  if (collapsed) {
    return (
      <button
        type="button"
        className="track__laps-open"
        aria-label={`Körök megjelenítése (${distances.length})`}
        onClick={() => setCollapsed(false)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="13.5" r="7.5" />
          <path d="M12 9.5v4l2.5 1.8M9.5 2.5h5M12 2.5v3" />
        </svg>
        <span className="track__laps-count">{distances.length}</span>
      </button>
    );
  }

  return (
    <div className="track__laps">
      {/*
        A SAJÁT SORÁBAN ül az összecsukó gomb, nem a kártya sarkába lebegtetve.

        Lebegő gombként ráült a legfelső kör távolságára („0,00 km"), és pont
        azt takarta ki, amiért a panel létezik. Egy saját fejlécsáv nem tud
        ütközni: a sorok alatta kezdődnek, akármilyen hosszú a szám.
      */}
      <div className="track__laps-head">
        <button
          type="button"
          className="track__laps-close"
          aria-label="Körök elrejtése"
          title="Körök elrejtése"
          onClick={() => setCollapsed(true)}
        >
          <MinimizeIcon />
        </button>
      </div>
      {/*
        A sorok KÜLÖN, görgethető dobozban élnek, nem a kártyában közvetlenül.
        Enélkül egy húszkörös futásnál a lista lelógott a képernyőről, és vele
        együtt az összecsukó gomb is — vagyis a lenyitást nem lehetett
        visszavonni.
      */}
      <div className={`track__lap-rows${expanded ? ' track__lap-rows--scroll' : ''}`}>
        {shown.map(({ meters, index }) => (
          <div className="track__lap" key={state.laps[index]!.at}>
            <span className="track__lap-index">
              {index + 1}. kör
              {index === distances.length - 1 && state.status !== 'finished' ? (
                <span className="track__lap-now">most</span>
              ) : null}
            </span>
            <span className="track__lap-value">{formatDistance(meters)}</span>
          </div>
        ))}
      </div>

      {hidden > 0 || expanded ? (
        <button
          type="button"
          className="track__lap-toggle"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Kevesebb' : `Mind a ${rows.length} kör`}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Az élő adatok panelje — koppintásra kinyílik.
 *
 * Összecsukva egy sor, négy értékkel: futás közben egy pillantásra ennyi
 * fogyasztható. Kinyitva 2×2-es rács, nagyobb számokkal és ikonokkal — ez az
 * a nézet, amit a felhasználó megáll megnézni, vagy amit kitesz a kormányra.
 *
 * TODO(F2): a kinyitott nézet lesz a helye a felhasználó által választott
 * mérőszámoknak (pulzus, emelkedés, szakasztempó).
 */
type StatsView = 'compact' | 'expanded' | 'full';

function StatsPanel({
  view,
  onViewChange,
  paused,
  distanceM,
  elapsed,
  pace,
  cells,
  claimableCells,
  expectedGp,
  speedMps,
  hasFix,
}: {
  view: StatsView;
  onViewChange: (view: StatsView) => void;
  /** Csak a TELJES nézetben számít — ott nincs hely a dokk-fölötti sárga
      panelnek (lásd `PausePanel`), tehát maga ez a panel vált sárgára, és
      egy kis sáv úszik be fentről. Lásd lent, `.track__full-pause`. */
  paused: boolean;
  distanceM: number;
  elapsed: number;
  pace: number | null;
  cells: number | null;
  /** Amit MOST megkapnál, ha befejeznéd — a bezárt területtel együtt. */
  claimableCells: number;
  expectedGp: number;
  speedMps: number | null;
  hasFix: boolean;
}) {
  const expanded = view !== 'compact';
  const full = view === 'full';

  /**
   * Zárójelben a VÁRHATÓ érték.
   *
   * A fő szám az, amin már áthaladtál; a zárójeles az, amit a bezárásokkal
   * együtt megszerzel, ha most fejezed be. A kettő közti különbség épp az a
   * motiváció, amiért a játék létezik — de a fő szám marad a biztos tény.
   *
   * Csak akkor mutatjuk, ha van különbség: „356 (356)" zaj lenne.
   */
  const withExpected = (main: number, expected: number) =>
    expected > main ? `${main} (${expected})` : String(main);

  const stats = [
    { key: 'time', label: 'idő', value: formatDuration(elapsed), icon: <ClockIcon /> },
    {
      key: 'pace',
      label: 'tempó',
      value: pace === null ? '—' : formatPace(pace),
      icon: <PaceIcon />,
    },
    {
      key: 'cells',
      label: 'mező',
      value: cells === null ? '—' : withExpected(cells, claimableCells),
      icon: <HexIcon />,
    },
    {
      key: 'gp',
      label: 'GP',
      value: String(expectedGp),
      icon: <SignalIcon />,
      /*
        A JELÁLLAPOT ITT VAN, mert a nyerspont-számláló megszűnt.

        Korábban külön „pont" mezőt mutattunk (hány GPS-pontot vettünk fel), és
        a jelzőpötty is ott ült. Geri kérésére a nyerspont kikerült: a
        felhasználónak nem mond semmit, a panel viszont ötödik értékként
        eltörte a négyes rácsot (egy sor, kinyitva 2×2). A jelzés a GP mellé
        költözött — így a négy érték megvan, és a „van-e fix" továbbra is
        egy pillantással látszik.
      */
      dot: hasFix ? 'live' : 'searching',
    },
  ] as const;

  /**
   * A CSÍK KÜLÖN GOMB, nem a törzsé — HTML nem enged gombot gombba ágyazni.
   * Geri kérése (2026-08-27, pontosítva): a csíkra koppintva egy RÖGZÍTETT,
   * körkörös sorrendben lép — compact→expanded→full→compact→... —, tehát
   * teljes nézetből EGYENESEN kompaktra ugrik, nem áll meg útközben
   * expanded-en. A törzsre koppintva továbbra is KI/BE kapcsol (compact⇄
   * expanded, teljesből pedig expanded-re lép vissza) — ez egy MÁSIK,
   * finomabb gesztus, szándékosan eltér a csíktól.
   */
  function stepGrip() {
    if (view === 'compact') return onViewChange('expanded');
    if (view === 'expanded') return onViewChange('full');
    return onViewChange('compact'); // full → compact, egyenesen
  }

  function toggleBody() {
    if (view === 'compact') return onViewChange('expanded');
    if (view === 'expanded') return onViewChange('compact');
    return onViewChange('expanded'); // full → expanded (a törzsre koppintva finomabban lép ki)
  }

  /** A csík nyilának iránya — Geri kérése (2026-08-27): mutassa, MERRE
      lép a következő koppintás, ne csak egy semleges vonal legyen. */
  const gripDirection: 'down' | 'up' = view === 'full' ? 'up' : 'down';

  return (
    <div
      className={`track__panel${expanded ? ' track__panel--open' : ''}${
        full ? ' track__panel--full' : ''
      }${full && paused ? ' track__panel--paused' : ''}`}
    >
      {/*
        TELJES NÉZETBEN NINCS HELYE a dokk-fölötti sárga panelnek (az ott
        marad compact/expanded módban, változatlanul) — Geri kérése
        (2026-08-27): itt maga a képernyő váltson sárgára, és egy kis sáv
        ússzon be FENTRŐL, ne a felső panelből nőjön ki, hiszen ez MAGA a
        panel. MINDIG KI VAN RENDERELVE (csak eltolva), hogy a ki- és
        becsukódás is animált legyen, ugyanaz a technika, mint a
        `.track__pause`-nál.
      */}
      {full ? (
        <div
          className={`track__full-pause${paused ? ' track__full-pause--shown' : ''}`}
          aria-hidden={!paused}
        >
          <strong className="track__full-pause-title">Szünet</strong>
          <span className="track__full-pause-hint">A mérés áll — a PLAY gombbal folytathatod.</span>
        </div>
      ) : null}

      <button
        type="button"
        className="track__panel-tap"
        onClick={toggleBody}
        aria-expanded={expanded}
        aria-label={expanded ? 'Adatok összecsukása' : 'Adatok kinyitása'}
      >
        {/* Első sor: sebesség balra, megtett táv jobbra — azonos mérettel.
            Futás közben ez a két szám az, amit egy pillantással leolvasol.
            Teljes nézetben (`full`) EGYMÁS ALATT, még nagyobban — Geri
            kérése (2026-08-27), lásd `.track__panel--full .track__primary`. */}
        <div className="track__primary">
          <span className="track__primary-cell">
            {/* A mértékegység a SZÁMMAL egy sorban, azonos méretben és színben —
                ugyanúgy, ahogy a megtett távnál („1,55 km"). A címke alatta a
                mérőszám neve, nem a mértékegysége. */}
            <span className="track__primary-value">{formatLiveSpeed(speedMps)}</span>
            <span className="track__primary-label">sebesség</span>
          </span>
          <span className="track__primary-cell">
            <span className="track__primary-value">{formatDistance(distanceM)}</span>
            <span className="track__primary-label">megtett táv</span>
          </span>
        </div>

        <div className="track__stats">
          {stats.map((stat) => (
            <div className="track__stat" key={stat.key}>
              {expanded ? <span className="track__stat-icon">{stat.icon}</span> : null}
              <span className="track__stat-value">{stat.value}</span>
              <span className="track__stat-label">
                {'dot' in stat ? <span className={`track__dot track__dot--${stat.dot}`} /> : null}
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </button>

      <button
        type="button"
        className="track__panel-grip"
        onClick={stepGrip}
        aria-label={
          view === 'compact'
            ? 'Adatok kinyitása'
            : view === 'expanded'
              ? 'Teljes képernyős nézet'
              : 'Kilépés a teljes képernyős nézetből'
        }
      >
        <GripArrowIcon direction={gripDirection} />
      </button>
    </div>
  );
}

/**
 * SZÜNET — sárga panel, ami a felső statisztika-panel ALÓL nő ki.
 *
 * Geri kérése (2026-08-27): korábban a dokk mögül úszott fel, önálló
 * dobozként — ez viszont takarásban volt a lenti gombokkal, és nem tűnt a
 * felső panel folytatásának. Most a `.track__panel-wrap` (a StatsPanel
 * közvetlen szülője) alján, ANNAK RÉSZEKÉNT jelenik meg: a teteje szögletes
 * és 20 px-et ALÁJA nyúlik a statisztika-panelnek, hogy annak lekerekített
 * alsó sarkai mögött is sárga legyen, ne a térkép látsszon át.
 *
 * ⚠️ MINDIG KI VAN RENDERELVE (amíg fut vagy szünetel a mérés), csak
 * felfelé eltolva — így a visszacsukódás is animált, nem csak eltűnik.
 *
 * ⚠️ `aria-hidden` REJTETT ÁLLAPOTBAN. A képernyőolvasó különben folyamatosan
 * bemondaná a szünet-szöveget rögzítés közben is, amikor nincs is szünet.
 */
function PausePanel({ shown }: { shown: boolean }) {
  return (
    <div
      className={`track__pause${shown ? ' track__pause--shown' : ''}`}
      role="status"
      aria-hidden={!shown}
    >
      <strong className="track__pause-title">Szünet</strong>
      <span className="track__pause-hint">A mérés áll — a PLAY gombbal folytathatod.</span>
    </div>
  );
}

/* Ikonok — inline SVG, hogy ne kelljen ikonkészletet behúzni. */

const iconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function MinimizeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 16.5h12" />
    </svg>
  );
}

/**
 * A csík nyila — nyújtott, vastag, lekerekített chevron (Geri kérése,
 * 2026-08-27, konkrét referenciaképpel). A `direction` a `stepGrip()`
 * KÖVETKEZŐ lépését mutatja, nem a jelenlegi állapotot.
 */
function GripArrowIcon({ direction }: { direction: 'down' | 'up' }) {
  return (
    <svg
      width="28"
      height="14"
      viewBox="0 0 28 14"
      fill="none"
      aria-hidden="true"
      style={direction === 'up' ? { transform: 'rotate(180deg)' } : undefined}
    >
      <path
        d="M3 2.5 14 11.5 25 2.5"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2M9 2h6" />
    </svg>
  );
}

function PaceIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 20a8 8 0 1 1 8-8" />
      <path d="M12 13l4.5-4.5" />
    </svg>
  );
}

function HexIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9z" />
    </svg>
  );
}

function SignalIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M7.5 7.5a6.5 6.5 0 0 0 0 9M16.5 7.5a6.5 6.5 0 0 1 0 9" />
    </svg>
  );
}

/**
 * A mentés állapota és a szerver által számolt eredmény.
 *
 * Fontos, hogy AMIT ITT MUTATUNK, az a szerveré, nem a klienstől jön. A
 * képernyőn futás közben látott táv és mezőszám előnézet; a hiteles értéket a
 * szerver számolja újra a nyers nyomvonalból, és eltérés esetén az számít.
 */
function UploadPanel({ recorder, uid }: { recorder: RecorderApi; uid: string }) {
  const navigate = useNavigate();
  const { upload } = recorder;

  if (upload.status === 'sending') {
    return <SavingPanel activityId={recorder.state.id} />;
  }

  if (upload.status === 'error') {
    return (
      <div className="track__note track__note--error" role="alert">
        <strong>A mentés nem sikerült.</strong> {upload.message}
        {upload.retryable ? (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <Button size="sm" onClick={() => void recorder.uploadActivity()}>
              Újrapróbálom
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (upload.status === 'done') {
    const { summary, duplicate } = upload;
    /*
      A `--upload` változat a képernyő maradék magasságát kapja, és belül
      görget: az űrlap mezői mozognak, a Mentés gomb pedig a panel alján
      marad. Indoklás a tracking.css-ben.

      ⚠️ NINCS ITT „Új rögzítés" gomb — a Dock már ad egyet (Geri kérése,
      2026-08-27): befejezett méréssel a Dock középső gombja magától
      kiszélesedik, „Új rögzítés" felirattal, és ugyanazt a `discard()`-ot
      hívja. A kétszeres gomb csak azért kellett korábban, mert a Dock ekkor
      még nem viselte ezt a feliratot mindenhol — most már igen.
    */
    return (
      <div className="track__panel track__panel--upload">
        <p className="track__saved">
          {duplicate ? 'Ez a rögzítés már mentve volt.' : 'Mentve.'}
        </p>
        <div className="track__stats">
          <div className="track__stat">
            <span className="track__stat-value">{formatDistance(summary.distanceM)}</span>
            <span className="track__stat-label">táv</span>
          </div>
          <div className="track__stat">
            <span className="track__stat-value">{formatArea(summary.areaGainedM2)}</span>
            <span className="track__stat-label">terület</span>
          </div>
          <div className="track__stat">
            <span className="track__stat-value">{summary.gp}</span>
            <span className="track__stat-label">GP</span>
          </div>
          <div className="track__stat">
            <span className="track__stat-value">{summary.loops}</span>
            <span className="track__stat-label">bezárás</span>
          </div>
        </div>

        {/*
          A név, a leírás és a képek a feltöltés UTÁN jönnek.

          A területfoglalás nem várhat arra, hogy a felhasználó címet
          találjon ki: a nyomvonal a befejezéskor felmegy, a terület azonnal
          a tiéd. Ez az űrlap már csak kiegészít, és nyugodtan kihagyható.

          Ismételt mentésnél (`duplicate`) nem mutatjuk: olyankor az
          aktivitásnak már lehet neve és fotója, és az üres űrlap mentése
          felülcsapná őket.
        */}
        {!duplicate && uid && recorder.state.id ? (
          <SaveActivityForm
            activityId={recorder.state.id}
            uid={uid}
            /*
              ⚠️ A MENTÉS UTÁN EL IS DOBJUK A RÖGZÍTÉST, nem csak elnavigálunk.

              Enélkül az elnavigálás csak elrejti a panelt: a `recorder`
              állapota `done` marad, és a Rögzítés fülre visszalépve ugyanaz
              a mentés-ablak fogadja a felhasználót, mintha semmi nem történt
              volna. Ez volt a „ragadt képernyő" hiba maradéka — az első
              javítás csak az átirányítást tette hozzá, a takarítást nem.

              Az azonosítót a `discard()` ELŐTT kell kimenteni, mert utána a
              `recorder.state.id` már üres.
            */
            onSaved={() => {
              const activityId = recorder.state.id;
              void recorder.discard();
              navigate(`/aktivitas/${activityId}`);
            }}
          />
        ) : null}
      </div>
    );
  }

  return null;
}
