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
const active = new Map<symbol, LabWorldLoaders>();

/**
 * A production TrackingScreen változtatás nélkül használható LAB-ban.
 *
 * Mount alatt csak az OLVASÁST irányítjuk át. A feltöltést a Recorder saját
 * sandbox uploaderének injektálása kezeli, tehát ezen a bridge-en semmilyen
 * írás nem mehet keresztül.
 *
 * Tokenes stack kell React StrictMode miatt: fejlesztésben mount/unmount/remount
 * történik, és egy egyszerű „mentsd el / állítsd vissza” páros a második mount
 * alól visszatehetné az első példány függvényét.
 */
export function activateLabTileBridge(loaders: LabWorldLoaders): () => void {
  const token = Symbol('lab-world-loaders');
  active.set(token, loaders);
  installTop();

  return () => {
    active.delete(token);
    installTop();
  };
}

function installTop(): void {
  const loaders = [...active.values()];
  const top = loaders.at(-1);
  if (!top) {
    api.tiles = originalTiles;
    api.territoryBlobs = originalBlobs;
    return;
  }
  api.tiles = (layer, view) => top.tiles(layer, view);
  api.territoryBlobs = (layer, view) => top.blobs(layer, view);
}
