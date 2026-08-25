import { api, type TilesResult } from '@/lib/api';

type TileLoader = (
  layer: 'foot' | 'bike',
  view: { south: number; west: number; north: number; east: number; zoom?: number },
) => Promise<TilesResult>;

const originalTiles = api.tiles;
const active = new Map<symbol, TileLoader>();

/**
 * A production TrackingScreen változtatás nélkül használható LAB-ban.
 *
 * Mount alatt csak az `api.tiles()` olvasást irányítjuk át. A feltöltést a
 * Recorder saját sandbox uploaderének injektálása kezeli, tehát ezen a bridge-en
 * semmilyen írás nem mehet keresztül.
 *
 * Tokenes stack kell React StrictMode miatt: fejlesztésben mount/unmount/remount
 * történik, és egy egyszerű „mentsd el / állítsd vissza” páros a második mount
 * alól visszatehetné az első példány függvényét.
 */
export function activateLabTileBridge(loader: TileLoader): () => void {
  const token = Symbol('lab-tile-loader');
  active.set(token, loader);
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
    return;
  }
  api.tiles = (layer, view) => top(layer, view);
}
