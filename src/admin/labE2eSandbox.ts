import { cellToChildren, polygonToCells } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import { buildActivityGeometry } from '@/game';
import { layerOf } from '@/game/cells';
import { distanceM } from '@/game/geo';
import { blobsFromCells } from '@/game/territoryBlobs';
import type {
  ActivitySummary,
  ActivityUploadStatusResult,
  TerritoryBlobsResult,
  TilesResult,
} from '@/lib/api';
import { ApiError } from '@/lib/api';
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

/**
 * A MENTÉS SZIMULÁCIÓJA — ez a LAB egyik fő haszna.
 *
 * A mentés a rögzítés legkockázatosabb lépése, és éppen azt volt eddig a
 * legnehezebb kipróbálni: a hosszú feldolgozáshoz több órás valódi
 * aktivitás kellett, a hibaághoz pedig szerverhiba (Geri kérése,
 * 2026-09-03 — közvetlenül a `ebb3c240…` beragadt kör után).
 *
 * A modell UGYANAZ, mint élesben: a szerver azonnal nyugtáz és a háttérben
 * dolgozik (`processing`), a kliens pedig a státuszt kérdezgeti, amíg
 * eredményt nem kap. Ezért van külön `upload` és `uploadStatus`.
 */
export type LabSaveMode =
  /** Azonnali siker — ez a rendes eset. */
  | 'instant'
  /** Sikerül, de sokáig tart: a „Nyugodtan bezárhatod" út. */
  | 'slow'
  /** Elhasal, de újraküldhető — ezt kapta jamal a 143 km-es körnél. */
  | 'retryable_error'
  /** Végleges hiba: az újrapróbálásnak nincs értelme. */
  | 'final_error'
  /** A kérés meg sem érkezik (offline): a kliens hálózati hibát lát. */
  | 'network_error';

export interface LabSaveSimulation {
  mode: LabSaveMode;
  /** A `slow` mód feldolgozási ideje másodpercben. */
  delayS: number;
}

export const DEFAULT_LAB_SAVE_SIMULATION: LabSaveSimulation = { mode: 'instant', delayS: 12 };

/** A háttérben „futó" feldolgozás állapota — a valódi szerver megfelelője. */
interface PendingUpload {
  finishAt: number;
  outcome:
    | { kind: 'done'; summary: ActivitySummary }
    | { kind: 'failed'; message: string; retryable: boolean };
}

export class LabE2eSandbox {
  private readonly worlds: Record<Layer, OwnershipMap>;
  private simulation: LabSaveSimulation = DEFAULT_LAB_SAVE_SIMULATION;
  private pending = new Map<string, PendingUpload>();
  /** A mentőlapon megadott név/leírás — csak hogy legyen hova elmenteni. */
  private saved = new Map<string, { title: string; description: string }>();

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
    this.pending.clear();
    this.saved.clear();
    this.persist();
  }

  setSaveSimulation(simulation: LabSaveSimulation): void {
    this.simulation = simulation;
  }

  getSaveSimulation(): LabSaveSimulation {
    return this.simulation;
  }

  /**
   * A leíró mezők mentése — a production `PATCH /api/activities/:id` helyett.
   *
   * A sandbox aktivitás csak a böngészőben létezik, ezért az éles végpont
   * „Nincs ilyen aktivitás." hibával szállt el. A hibaágat itt is ugyanaz a
   * szimuláció vezérli, hogy a mentőlap hibakezelése is kipróbálható legyen.
   */
  async saveActivity(
    activityId: string,
    patch: { title: string; description: string },
  ): Promise<void> {
    if (this.simulation.mode === 'slow') await delay(this.simulation.delayS * 1000);
    if (this.simulation.mode === 'retryable_error' || this.simulation.mode === 'final_error') {
      throw new ApiError(
        this.simulation.mode === 'final_error' ? 400 : 503,
        'save_failed',
        'A LAB szimulált hibát adott a mentésre.',
      );
    }
    if (this.simulation.mode === 'network_error') {
      throw new ApiError(0, 'network', 'Nincs kapcsolat a szerverrel.');
    }
    this.saved.set(activityId, { title: patch.title, description: patch.description });
  }

  /** A mentőlapon rögzített név/leírás — ellenőrzéshez. */
  savedActivity(activityId: string): { title: string; description: string } | null {
    return this.saved.get(activityId) ?? null;
  }

  /**
   * A hosszú feldolgozás állapota — a production státuszvégpont megfelelője.
   *
   * A `processing` állapotból KIZÁRÓLAG ez vezet ki, ezért a LAB uploader
   * mellé kötelező átadni a rögzítőnek (`RecorderOptions.uploadStatus`).
   */
  async uploadStatus(activityId: string): Promise<ActivityUploadStatusResult> {
    const job = this.pending.get(activityId);
    if (!job) return { status: 'missing' };
    if (Date.now() < job.finishAt) return { status: 'processing' };

    this.pending.delete(activityId);
    return job.outcome.kind === 'done'
      ? { status: 'done', summary: job.outcome.summary }
      : { status: 'failed', message: job.outcome.message, retryable: job.outcome.retryable };
  }

  async upload(input: RecorderUploadInput): Promise<RecorderUploadResult> {
    /**
     * A HIBAÁGAK A FOGLALÁS ELŐTT dőlnek el.
     *
     * Így egy szimulált hiba után a sandbox világa érintetlen marad, és az
     * újrapróbálás ugyanabból az állapotból indul — pontosan úgy, ahogy egy
     * elhasalt szerveroldali tranzakció után is.
     */
    if (this.simulation.mode === 'network_error') {
      throw new ApiError(0, 'network', 'Nincs kapcsolat a szerverrel.');
    }
    if (this.simulation.mode === 'final_error') {
      throw new ApiError(400, 'activity_rejected', 'A LAB szimulált, végleges mentési hibája.');
    }
    if (this.simulation.mode === 'retryable_error') {
      // 5xx: a rögzítő ilyenkor a státuszvégpontot kérdezi, nem ad fel azonnal
      // — ugyanaz az út, amit jamal köre bejárt.
      this.pending.set(input.activityId, {
        finishAt: Date.now() + Math.max(0, this.simulation.delayS) * 1000,
        outcome: {
          kind: 'failed',
          message: 'A mentés feldolgozása megszakadt. Próbáld újra.',
          retryable: true,
        },
      });
      throw new ApiError(503, 'activity_processing', 'A LAB szimulált, átmeneti mentési hibája.');
    }

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

    /**
     * A LASSÚ ÚT: a foglalás ELKÉSZÜLT, csak a válasz várat magára.
     *
     * Élesben is ez a sorrend — a szerver a háttérben dolgozik, a kliens
     * pedig a státuszt kérdezi. A `processing` válasszal a rögzítő megkapja
     * a „nyugodtan bezárhatod" állapotot, amit így végig lehet játszani.
     */
    if (this.simulation.mode === 'slow') {
      this.pending.set(input.activityId, {
        finishAt: Date.now() + Math.max(0, this.simulation.delayS) * 1000,
        outcome: { kind: 'done', summary },
      });
      return { processing: true };
    }

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { globalThis.setTimeout(resolve, Math.max(0, ms)); });
}
