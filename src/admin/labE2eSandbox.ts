import { cellToChildren, polygonToCells } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import { buildActivityGeometry } from '@/game';
import { layerOf } from '@/game/cells';
import { distanceM } from '@/game/geo';
import { blobsFromCells } from '@/game/territoryBlobs';
import type { ActivitySummary, TerritoryBlobsResult, TilesResult } from '@/lib/api';
import type { RecorderUploadInput, RecorderUploadResult } from '@/hooks/useRecorder';
import type { CellId, CellOwnership, Layer, OwnershipMap } from '@/types';
import { applyClaimToWorld } from './labScenarioEngine';
import { labWorldOwnershipAt, processLabActivity } from './labHierarchicalWorld';

const STORAGE_PREFIX = 'grundo.lab.e2e.world.';
const MAX_VIEW_BLOCKS = 320;
const BLOCK_RESOLUTION = 9;

interface StoredSandbox {
  version: 1;
  foot: Array<[CellId, CellOwnership]>;
  bike: Array<[CellId, CellOwnership]>;
}

export interface LabE2eSandboxOptions {
  id: string;
  actorId: string;
  displayActorUid: string;
  ownerNames: ReadonlyMap<string, string>;
  /**
   * Játékos → cellaszín KULCSA (`lib/cellColors.ts`).
   *
   * ⚠️ EZ TESZI A LAB-OT AZONOSSÁ AZ ÉLES FELÜLETTEL. A production
   * `/api/tiles` a saját és a rivális területeket a tulajdonos VÁLASZTOTT
   * színével adja vissza; enélkül a sandbox minden játékost az
   * alapértelmezett palettaszínnel rajzolt volna, és a színekre vonatkozó
   * változtatásokat nem lehetett volna itt tesztelni.
   */
  ownerColors: ReadonlyMap<string, string>;
}

export class LabE2eSandbox {
  private readonly worlds: Record<Layer, OwnershipMap>;

  constructor(private readonly options: LabE2eSandboxOptions) {
    const stored = readSandbox(options.id);
    this.worlds = {
      foot: new Map(stored?.foot ?? []),
      bike: new Map(stored?.bike ?? []),
    };
  }

  reset(): void {
    this.worlds.foot.clear();
    this.worlds.bike.clear();
    this.persist();
  }

  async upload(input: RecorderUploadInput): Promise<RecorderUploadResult> {
    const layer = layerOf(input.type);
    const world = this.worlds[layer];
    const geometry = buildActivityGeometry(input.points);
    const distance = traceDistanceM(input.points);
    const result = processLabActivity({
      points: input.points,
      type: input.type,
      distanceKm: distance / 1000,
      actorId: this.options.actorId,
      ownership: world,
      streakDays: 1,
      gpEarnedToday: 0,
    }, geometry);

    applyClaimToWorld(world, result);
    this.persist();

    const summary: ActivitySummary = {
      distanceM: Math.round(distance),
      durationS: Math.round(Math.max(0, input.endedAt - input.startedAt) / 1000),
      movingS: Math.round(Math.max(0, input.movingMs) / 1000),
      cellCount: result.cellPath.length,
      loops: result.loops.length,
      claimedCells: result.claimedCellCount,
      areaGainedM2: result.areaGainedM2,
      gp: result.gp.total,
    };
    return { summary, duplicate: false };
  }

  async tiles(
    layer: Layer,
    view: { south: number; west: number; north: number; east: number },
  ): Promise<TilesResult> {
    const polygon: [number, number][][] = [[
      [view.south, view.west],
      [view.south, view.east],
      [view.north, view.east],
      [view.north, view.west],
      [view.south, view.west],
    ]];
    let blocks = polygonToCells(polygon, BLOCK_RESOLUTION) as CellId[];
    const partial = blocks.length > MAX_VIEW_BLOCKS;
    if (partial) blocks = blocks.slice(0, MAX_VIEW_BLOCKS);

    const world = this.worlds[layer];
    const cells: TilesResult['cells'] = [];
    const owners: Record<string, string> = {};

    for (const block of blocks) {
      for (const child of cellToChildren(block, GAMEPLAY.H3_RESOLUTION) as CellId[]) {
        const ownership = labWorldOwnershipAt(world, child);
        if (!ownership) continue;
        const displayOwner = ownership.owner === this.options.actorId
          ? this.options.displayActorUid
          : ownership.owner;
        cells.push({ cell: child, owner: displayOwner, defense: ownership.defense });
        owners[displayOwner] = ownership.owner === this.options.actorId
          ? (this.options.ownerNames.get(this.options.actorId) ?? 'LAB player')
          : (this.options.ownerNames.get(ownership.owner) ?? ownership.owner);
      }
    }

    const ownerColors: Record<string, string> = {};
    for (const displayOwner of Object.keys(owners)) {
      const color = this.options.ownerColors.get(displayOwner);
      if (color) ownerColors[displayOwner] = color;
    }

    return { layer, cells, blocks, owners, ownerColors, ...(partial ? { partial: true } : {}) };
  }

  /**
   * A TERÜLETFOLTOK a sandbox világból.
   *
   * ⚠️ MIÉRT KELL EZ EGYÁLTALÁN? Mert enélkül a LAB E2E képernyő a
   * `TrackingScreen`-en át a VALÓDI `/api/tiles/blobs` végpontot hívta: a
   * tile-bridge (`labE2eTileBridge.ts`) csak a cellákat irányította át, a
   * foltokat nem. A sandbox térképére így az éles világ birtokviszonya
   * rajzolódott rá — ugyanazon a helyen, ugyanabban a rétegben, mint a
   * sandbox saját cellái.
   *
   * A foltokat a MÁR KISZÁMOLT nézetbeli cellákból építjük, tulajdonosonként.
   * A LAB világ kicsi, ezért ez olcsó, és pontosan azt mutatja, amit a
   * cellaréteg — nincs két, egymásnak ellentmondó igazság a képernyőn.
   */
  async blobs(
    layer: Layer,
    view: { south: number; west: number; north: number; east: number },
  ): Promise<TerritoryBlobsResult> {
    const tiles = await this.tiles(layer, view);

    const byOwner = new Map<string, CellId[]>();
    for (const cell of tiles.cells) {
      const cells = byOwner.get(cell.owner);
      if (cells) cells.push(cell.cell);
      else byOwner.set(cell.owner, [cell.cell]);
    }

    const blobs: TerritoryBlobsResult['blobs'] = [];
    for (const [owner, cells] of byOwner) {
      for (const blob of blobsFromCells(cells)) {
        blobs.push({
          // A folt azonosítója a komponensé; tulajdonossal előtagolva
          // sosem ütközik két játékos szomszédos foltja.
          id: `${owner}:${blob.id}`,
          owner,
          areaM2: blob.areaM2,
          cellCount: blob.cellCount,
          rings: blob.rings,
        });
      }
    }

    return {
      layer,
      blobs,
      owners: tiles.owners,
      ...(tiles.ownerColors ? { ownerColors: tiles.ownerColors } : {}),
      // A LAB-ban minden folt látszik: itt a nézet nem több százezer
      // felhasználó adata, hanem egy szándékosan kicsi próbavilág.
      minAreaM2: 0,
    };
  }

  private persist(): void {
    const value: StoredSandbox = {
      version: 1,
      foot: [...this.worlds.foot],
      bike: [...this.worlds.bike],
    };
    try {
      sessionStorage.setItem(STORAGE_PREFIX + this.options.id, JSON.stringify(value));
    } catch (error) {
      console.warn('[GRUNDO LAB] E2E sandbox persistence failed', error);
    }
  }
}

function readSandbox(id: string): StoredSandbox | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSandbox>;
    if (parsed.version !== 1 || !Array.isArray(parsed.foot) || !Array.isArray(parsed.bike)) return null;
    return parsed as StoredSandbox;
  } catch {
    return null;
  }
}

function traceDistanceM(points: readonly { lat: number; lng: number }[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distanceM(points[index - 1]!, points[index]!);
  }
  return total;
}
