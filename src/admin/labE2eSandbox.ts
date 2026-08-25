import { cellToChildren, polygonToCells } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import { buildActivityGeometry } from '@/game';
import { layerOf } from '@/game/cells';
import { distanceM } from '@/game/geo';
import type { ActivitySummary, TilesResult } from '@/lib/api';
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

    return { layer, cells, blocks, owners, ...(partial ? { partial: true } : {}) };
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
