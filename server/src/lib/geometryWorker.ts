/**
 * A bezárt cellahalmaz kiszámítása KÜLÖN SZÁLON.
 *
 * MIÉRT VAN? Mert ez a művelet CPU-nehéz és nem megszakítható: mérve
 * (2026-09-12) 158 ms és 778 000 ms között szór, és a költség a nyomvonal
 * ALAKJÁTÓL függ, nem a hosszától — tehát előre nem lehet megbecsülni. A fő
 * szálon futtatva egy rossz alakú kör az event loopot foglalja, és a
 * kiszolgáló addig SENKI mást nem szolgál ki.
 *
 * Külön szálon két dolgot nyerünk: az event loop szabad marad, és a számítás
 * MEGSZAKÍTHATÓ (`worker.terminate()`) — ezért lehet időkorlátot szabni a
 * távolság helyett, ami a mérés szerint amúgy is rossz prediktor.
 *
 * ⚠️ EZ A FÁJL CSAK A KÖZÖS MOTORT HASZNÁLHATJA. Nincs Firestore, nincs
 * Express, nincs kérés-kontextus — a `src/game/` szabálya (CLAUDE.md 3.) épp
 * ezért teszi lehetővé, hogy szálra költöztessük. A birtokviszony (Firestore)
 * szándékosan a fő szálon marad: az I/O, az nem blokkol.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { shapeCandidateCells } from './missionEvaluate';
import { loopCellCount } from '../../../src/game/loopInterior';
import type { TracePoint } from '../../../src/types';

export interface GeometryJob {
  trace: TracePoint[];
}

export interface GeometryResult {
  cellCount: number;
  loopCount: number;
  /**
   * A fal és a határsáv pontos cellái — ezekre kérdezünk birtokviszonyt.
   *
   * ⚠️ NEM a teljes belső. Nagy huroknál a motor szándékosan tömören tartja a
   * belsőt; kibontva több millió cella lenne, amit sem átadni, sem
   * Firestore-ból lekérdezni nem lehet.
   */
  cells: string[];
}

function run({ trace }: GeometryJob): GeometryResult {
  const shaped = shapeCandidateCells(trace);
  return {
    cellCount: shaped.geometry.loops.reduce((sum, loop) => sum + loopCellCount(loop), 0),
    loopCount: shaped.loopCount,
    cells: [...shaped.cells] as string[],
  };
}

/* Csak akkor fut, ha tényleg workerként töltődött be — teszt importnál nem. */
if (parentPort && workerData) {
  parentPort.postMessage(run(workerData as GeometryJob));
}

export { run as computeGeometry };
