import { describe, expect, it } from 'vitest';
import type { DetectedLoop } from '../../../src/types';
import { requiresChunkedClaim } from './activityRouting';

function loop(compact: boolean): DetectedLoop {
  return {
    fromIndex: 0,
    toIndex: 4,
    wall: new Set(),
    interior: new Set(),
    ...(compact
      ? {
          compactInterior: {
            parentResolution: 10,
            fullParents: new Set(['8a1e2d84c937fff']),
            cellCount: 49,
          },
        }
      : {}),
  } as DetectedLoop;
}

describe('requiresChunkedClaim', () => {
  it('a normál kis claim maradhat fast-pathon', () => {
    expect(requiresChunkedClaim([loop(false)], true)).toBe(false);
  });

  it('a normál túl nagy claim chunked', () => {
    expect(requiresChunkedClaim([loop(false)], false)).toBe(true);
  });

  it('a compact claim mindig chunked, akkor is ha az explicit blokkszám kicsi', () => {
    expect(requiresChunkedClaim([loop(true)], true)).toBe(true);
  });
});
