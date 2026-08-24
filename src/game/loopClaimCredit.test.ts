import { describe, expect, it } from 'vitest';
import type { CellId, DetectedLoop } from '@/types';
import { resolveSequentialLoopClaims } from './index';

const cell = (id: string) => id as CellId;

function loop(
  fromIndex: number,
  toIndex: number,
  wall: readonly CellId[],
  interior: readonly CellId[],
): DetectedLoop {
  return {
    fromIndex,
    toIndex,
    wall: new Set(wall),
    interior: new Set(interior),
  };
}

describe('activity-local loop claim credit', () => {
  it('a korábban lezárt területet nem erősíti meg egy ugyanabból a traversalból létrejövő nagyobb hurok', () => {
    const a = cell('a');
    const b = cell('b');
    const c = cell('c');
    const d = cell('d');

    // Először bezárul egy kisebb terület a traversal közepén.
    const first = loop(10, 20, [a], [b]);

    // Később létrejön egy nagyobb geometriai hurok, amely tartalmazza az első
    // teljes területét is, de a saját traversalja MÉG AZ ELSŐ JÓVÁÍRÁS ELŐTT
    // kezdődött. Ez a 8-as alakzat tipikus esete: a második bezárás nem jelenti
    // azt, hogy az első lebenyt újra megkerültük.
    const enclosing = loop(0, 30, [a, c], [b, d]);

    const result = resolveSequentialLoopClaims(
      [first, enclosing],
      new Map(),
      'u1',
    );

    expect(result.running.get(a)?.defense).toBe(1);
    expect(result.running.get(b)?.defense).toBe(1);
    expect(result.running.get(c)?.defense).toBe(1);
    expect(result.running.get(d)?.defense).toBe(1);

    // A második hurok auditként megmarad, de csak a valóban új területrész
    // kap claim-jóváírást.
    expect(result.perLoop).toHaveLength(2);
    expect(result.perLoop[1]!.updates.has(a)).toBe(false);
    expect(result.perLoop[1]!.updates.has(b)).toBe(false);
    expect(result.perLoop[1]!.updates.has(c)).toBe(true);
    expect(result.perLoop[1]!.updates.has(d)).toBe(true);
  });

  it('egy teljesen új traversal újra bezárhatja és erősítheti ugyanazt a területet', () => {
    const a = cell('a');
    const b = cell('b');
    const c = cell('c');

    const first = loop(0, 20, [a], [b]);

    // Az új hurok az előző bezárásnál/utána kezdődik: ez már tényleges új
    // körbejárás, ezért a közös cellák defense-et építhetnek.
    const secondLap = loop(20, 40, [a, c], [b]);

    const result = resolveSequentialLoopClaims(
      [first, secondLap],
      new Map(),
      'u1',
    );

    expect(result.running.get(a)?.defense).toBe(2);
    expect(result.running.get(b)?.defense).toBe(2);
    expect(result.running.get(c)?.defense).toBe(1);
  });
});
