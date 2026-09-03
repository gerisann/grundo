export interface ColorTerritoryCell {
  q: number;
  r: number;
  delayMs: number;
  durationMs: number;
}

const NEIGHBORS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
] as const;

const MAX_RADIUS = 3;
const MAX_LIFETIME_MS = 5_000;

/** Builds a connected axial-hex cluster around the selected center cell. */
export function generateColorTerritory(random: () => number = Math.random): ColorTerritoryCell[] {
  const targetCount = 14 + Math.floor(random() * 7);
  const occupied = new Set<string>(['0,0']);
  const frontier = neighborsOf(0, 0);
  const result: ColorTerritoryCell[] = [];

  while (result.length < targetCount && frontier.length > 0) {
    const index = Math.min(frontier.length - 1, Math.floor(random() * frontier.length));
    const [q, r] = frontier.splice(index, 1)[0];
    const key = `${q},${r}`;
    if (occupied.has(key)) continue;

    occupied.add(key);
    const delayMs = Math.floor(random() * 350);
    const minimumDuration = 1_300;
    const durationMs = minimumDuration
      + Math.floor(random() * (MAX_LIFETIME_MS - delayMs - minimumDuration));
    result.push({ q, r, delayMs, durationMs });

    for (const neighbor of neighborsOf(q, r)) {
      const neighborKey = `${neighbor[0]},${neighbor[1]}`;
      if (!occupied.has(neighborKey) && !frontier.some(([fq, fr]) => fq === neighbor[0] && fr === neighbor[1])) {
        frontier.push(neighbor);
      }
    }
  }

  return result;
}

export function areConnectedToCenter(cells: readonly Pick<ColorTerritoryCell, 'q' | 'r'>[]): boolean {
  const remaining = new Set(cells.map(({ q, r }) => `${q},${r}`));
  const reached = new Set<string>(['0,0']);
  const queue: [number, number][] = [[0, 0]];

  while (queue.length > 0) {
    const [q, r] = queue.shift()!;
    for (const [nextQ, nextR] of neighborsOf(q, r)) {
      const key = `${nextQ},${nextR}`;
      if (!remaining.delete(key)) continue;
      reached.add(key);
      queue.push([nextQ, nextR]);
    }
  }

  return remaining.size === 0 && reached.size === cells.length + 1;
}

function neighborsOf(q: number, r: number): [number, number][] {
  return NEIGHBORS
    .map(([dq, dr]) => [q + dq, r + dr] as [number, number])
    .filter(([nextQ, nextR]) => axialDistance(nextQ, nextR) <= MAX_RADIUS);
}

function axialDistance(q: number, r: number): number {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}
