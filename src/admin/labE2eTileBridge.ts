import { api, type TerritoryBlobsResult, type TilesResult } from '@/lib/api';

type ViewBox = { south: number; west: number; north: number; east: number; zoom?: number };

type TileLoader = (layer: 'foot' | 'bike', view: ViewBox) => Promise<TilesResult>;
type BlobLoader = (layer: 'foot' | 'bike', view: ViewBox) => Promise<TerritoryBlobsResult>;

export interface LabWorldLoaders {
  tiles: TileLoader;
  /**
   * ⚠️ A FOLTOK IS IDE TARTOZNAK, nem csak a cellák.
   *
   * Korábban csak az `api.tiles` volt átirányítva, a `TrackingScreen`
   * viszont a `api.territoryBlobs`-ot is hívja — ugyanarra a nézetre, egy
   * másik rétegbe. A LAB térképén így az ÉLES világ birtokviszonya
   * rajzolódott a sandbox cellái alá: két egymásnak ellentmondó igazság
   * ugyanazon a képernyőn, ráadásul valódi felhasználók adatával.
   */
  blobs: BlobLoader;
}

const originalTiles = api.tiles;
const originalBlobs = api.territoryBlobs;

/**
 * A production TrackingScreen változtatás nélkül használható LAB-ban: mount
 * alatt a világ OLVASÁSÁT irányítjuk át a sandboxba. A feltöltést a Recorder
 * saját sandbox uploaderének injektálása kezeli, tehát ezen a hídon
 * semmilyen írás nem mehet keresztül.
 *
 * ── EGY SLOT, NEM VEREM (2026-09-01) ─────────────────────────────────────
 *
 * ⚠️ EZ EGY MÉRT HIBA JAVÍTÁSA. Korábban tokenes verem volt, és a hívó
 * `useState(() => activateLabTileBridge(...))`-gel, RENDER KÖZBEN aktiválta
 * — mert a gyerek `TrackingScreen` első csempe-lekérésének már ide kell
 * futnia, a szülő `useEffect`-je pedig ehhez késő (a gyerekek hatásai előbb
 * futnak).
 *
 * A React `StrictMode` viszont a `useState` inicializálóját KÉTSZER hívja
 * meg: két token került a verembe, de a komponens csak az EGYIK feloldó
 * függvényét tartotta meg. A másik örökre bent ragadt — és mivel a
 * leválasztáskor csak a megtartottat hívtuk, az `api.tiles` és az
 * `api.territoryBlobs` a LAB elhagyása UTÁN IS a sandboxra mutatott.
 *
 * Mérve (2026-09-01): a LAB-ból a `/grund`-ra navigálva a Grund képernyő a
 * sandbox világot mutatta, és egyetlen `/api/tiles` kérés sem ment ki a
 * hálózatra. Fejlesztői módra korlátozódik (élesben nincs kettőzött hívás),
 * de pont a tesztelés közben téveszt meg — ott, ahol a legdrágább.
 *
 * A javítás nem a verem megerősítése, hanem az elhagyása: EGYSZERRE EGY LAB
 * képernyő él, tehát az aktiválás egyszerűen FELÜLÍRJA az előzőt, a
 * feloldás pedig mindig az EREDETI függvényeket állítja vissza. Így akárhány
 * kettőzött aktiválás után is egyetlen feloldás elég, és nem marad árva
 * bejegyzés.
 */
export function activateLabTileBridge(loaders: LabWorldLoaders): void {
  api.tiles = (layer, view) => loaders.tiles(layer, view);
  api.territoryBlobs = (layer, view) => loaders.blobs(layer, view);
}

/** A production olvasás visszaállítása. Többszöri hívása ártalmatlan. */
export function releaseLabTileBridge(): void {
  api.tiles = originalTiles;
  api.territoryBlobs = originalBlobs;
}

/** Kizárólag tesztekhez: átirányítva van-e éppen a világ olvasása. */
export function labTileBridgeActive(): boolean {
  return api.tiles !== originalTiles || api.territoryBlobs !== originalBlobs;
}
