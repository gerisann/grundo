import { describe, expect, it } from 'vitest';
import { cellToChildren, cellToChildrenSize, cellToParent, getResolution, gridDisk, latLngToCell } from 'h3-js';
import { buildActivityGeometry, loopCells } from '@/game';
import { DEFAULT_GAMEPLAY } from '@/config/gameplay';
import { buildTrace, figureEight, multiLap, ORIGIN, selfTouch, simpleLoop, squareWaypoints } from '@/game/fixtures';
import type { OwnershipMap } from '@/types';
import {
  countLabPlayerCells,
  countLabPlayerDefense,
  materializeFineOwnership,
  processLabActivity,
  summarizeLabWorld,
} from './labHierarchicalWorld';

function apply(world: OwnershipMap, result: ReturnType<typeof processLabActivity>): void {
  for (const [cell, ownership] of result.claim?.updates ?? []) world.set(cell, ownership);
}

function process(
  world: OwnershipMap,
  actorId: string,
  sideM: number,
  stepM: number,
) {
  const points = buildTrace(squareWaypoints(ORIGIN, sideM), {
    stepM,
    intervalS: 1,
    accuracy: 1,
  });
  const geometry = buildActivityGeometry(points);
  return processLabActivity({
    points,
    type: 'ride',
    distanceKm: (sideM * 4) / 1000,
    actorId,
    ownership: world,
    streakDays: 1,
    gpEarnedToday: 0,
  }, geometry);
}

describe('hierarchical multiplayer LAB world', () => {
  it('compact nagy területet másik player bulk módon el tud lopni', () => {
    const world: OwnershipMap = new Map();

    const first = process(world, 'A', 5_000, 250);
    expect(first.compactClaim).not.toBeNull();
    expect(first.claimedCellCount).toBeGreaterThan(40_000);
    apply(world, first);

    expect([...world.keys()].some((cell) => getResolution(cell) < 12)).toBe(true);
    const aBefore = countLabPlayerCells(world, 'A');
    expect(aBefore).toBe(first.claimedCellCount);

    const second = process(world, 'B', 5_000, 250);
    expect(second.compactClaim).not.toBeNull();
    expect(second.claim?.counts.stolen ?? 0).toBeGreaterThan(40_000);
    apply(world, second);

    expect(countLabPlayerCells(world, 'B')).toBe(first.claimedCellCount);
    expect(countLabPlayerCells(world, 'A')).toBe(0);
  });

  it('kis normál hurok csak res12 override-okkal harap bele egy compact parent worldbe', () => {
    const world: OwnershipMap = new Map();

    const large = process(world, 'A', 5_000, 250);
    apply(world, large);
    const aBefore = countLabPlayerCells(world, 'A');
    const parentEntriesBefore = [...world.keys()].filter((cell) => getResolution(cell) < 12).length;
    expect(parentEntriesBefore).toBeGreaterThan(0);

    const small = process(world, 'B', 400, 12);
    expect(small.compactClaim).toBeNull();
    expect(small.claim?.counts.stolen ?? 0).toBeGreaterThan(0);
    apply(world, small);

    const bAfter = countLabPlayerCells(world, 'B');
    const aAfter = countLabPlayerCells(world, 'A');
    expect(bAfter).toBeGreaterThan(0);
    expect(aAfter).toBeLessThan(aBefore);
    expect(aAfter + bAfter).toBe(aBefore);
    expect([...world.keys()].filter((cell) => getResolution(cell) < 12).length).toBe(parentEntriesBefore);
  });
});

describe('summarizeLabWorld', () => {
  it('egy bejárásból ugyanazt adja, mint a playerenkénti számlálás', () => {
    const gameplayRes = DEFAULT_GAMEPLAY.H3_RESOLUTION;
    const parentRes = gameplayRes - 2;
    const fine = latLngToCell(ORIGIN.lat, ORIGIN.lng, gameplayRes);
    const parent = cellToParent(fine, parentRes);
    const childCount = Number(cellToChildrenSize(parent, gameplayRes));
    const overrides = cellToChildren(parent, gameplayRes).slice(0, 7);

    // Homogén parent A-nál 2× védelemmel, benne 7 res12 override B-nél 1×-en.
    const world: OwnershipMap = new Map();
    world.set(parent, { owner: 'A', defense: 2 });
    for (const cell of overrides) world.set(cell, { owner: 'B', defense: 1 });

    const totals = summarizeLabWorld(world);
    const a = totals.get('A');
    const b = totals.get('B');

    expect(a?.cells).toBe(childCount - overrides.length);
    expect(b?.cells).toBe(overrides.length);
    expect(a?.byDefense[1]).toBe(childCount - overrides.length);
    expect(a?.byDefense[0]).toBe(0);
    expect(b?.byDefense[0]).toBe(overrides.length);

    // A védelmi bontás összege sosem térhet el a teljes cellaszámtól.
    expect(a?.byDefense.reduce((sum, value) => sum + value, 0)).toBe(a?.cells);
    expect(b?.byDefense.reduce((sum, value) => sum + value, 0)).toBe(b?.cells);

    // A publikus, playerenkénti számlálók ugyanezt kell adják.
    expect(countLabPlayerCells(world, 'A')).toBe(a?.cells);
    expect(countLabPlayerCells(world, 'B')).toBe(b?.cells);
    expect(countLabPlayerDefense(world, 'A', 2)).toBe(a?.cells);
    expect(countLabPlayerDefense(world, 'B', 1)).toBe(b?.cells);
    expect(countLabPlayerCells(world, 'nincs-ilyen')).toBe(0);
  });
});

describe('materializeFineOwnership', () => {
  /**
   * A korábbi változat MINDEN hurokcella köré húzott két gyűrűt. Az új csak a
   * fal köré — a belső cellákat a fal definíció szerint elválasztja a
   * külvilágtól, tehát nem adhatnak új cellát. Ez a teszt azt rögzíti, hogy a
   * két számítás eredménye tényleg azonos; ha valaha eltérne, az azt jelentené,
   * hogy a hurok belseje nem zárt.
   */
  function legacyScope(geometry: ReturnType<typeof buildActivityGeometry>): Set<string> {
    const scope = new Set<string>();
    for (const loop of geometry.loops) {
      for (const cell of loopCells(loop)) {
        if (getResolution(cell) !== DEFAULT_GAMEPLAY.H3_RESOLUTION) continue;
        for (const near of gridDisk(cell, 2)) scope.add(near);
      }
    }
    return scope;
  }

  const fixtures: [string, () => ReturnType<typeof simpleLoop>][] = [
    ['egyszerű négyzet', () => simpleLoop(200)],
    ['nagyobb négyzet', () => simpleLoop(600)],
    ['nyolcas', () => figureEight(160)],
    ['többkörös', () => multiLap(3, 200)],
    ['önérintő', () => selfTouch()],
  ];

  for (const [name, build] of fixtures) {
    it(`${name}: a fal-alapú scope azonos a teljes felfújással`, () => {
      const geometry = buildActivityGeometry(build());
      const legacy = legacyScope(geometry);
      const { scope } = materializeFineOwnership(new Map(), geometry, DEFAULT_GAMEPLAY);

      expect([...scope].sort()).toEqual([...legacy].sort());
      // Ha nincs hurok, nincs mit összehasonlítani — az nem bizonyítana semmit.
      if (geometry.loops.length > 0) expect(scope.size).toBeGreaterThan(0);
    });
  }
});
