/**
 * A valós idejű cellahang tesztjei.
 *
 * Két dolog romolhat el itt, és mindkettő hallható: rossz hang a rossz
 * mezőre, illetve géppuskatűz, amikor egyszerre sok mező érkezik (natív
 * ébredés, visszaállítás).
 */

import { describe, expect, it } from 'vitest';
import { GAMEPLAY } from '@/config/gameplay';
import {
  cellStepSound,
  cellStepSounds,
  CELL_STEP_BURST_CAP,
  type CellOwner,
} from './cellStepSound';
import type { CellId } from '@/types';

const ME = 'user-me';
const RIVAL = 'user-rival';

function world(entries: Record<string, CellOwner>): Map<CellId, CellOwner> {
  return new Map(Object.entries(entries) as [CellId, CellOwner][]);
}

describe('cellStepSound', () => {
  it('szabad mező — a foglalás hangja', () => {
    expect(cellStepSound(undefined, ME)).toBe('cell-captured');
  });

  it('riválisé — a lopás hangja, akármilyen erős', () => {
    expect(cellStepSound({ owner: RIVAL, defense: 1 }, ME)).toBe('cell-stolen');
    expect(cellStepSound({ owner: RIVAL, defense: GAMEPLAY.MAX_DEFENSE }, ME)).toBe('cell-stolen');
  });

  it('saját, még emelhető mező — a megerősítés hangja', () => {
    for (let defense = 1; defense < GAMEPLAY.MAX_DEFENSE; defense += 1) {
      expect(cellStepSound({ owner: ME, defense }, ME)).toBe('cell-defend');
    }
  });

  it('saját, maximumon álló mező — külön hang', () => {
    expect(cellStepSound({ owner: ME, defense: GAMEPLAY.MAX_DEFENSE }, ME)).toBe('cell-max');
  });
});

describe('cellStepSounds', () => {
  const map = world({
    a: { owner: ME, defense: 2 },
    b: { owner: RIVAL, defense: 1 },
    c: { owner: ME, defense: GAMEPLAY.MAX_DEFENSE },
  });

  it('csak az ÚJ mezők szólalnak meg', () => {
    const path = ['a', 'b', 'c', 'd'] as CellId[];
    expect(cellStepSounds(2, path, map, ME)).toEqual(['cell-max', 'cell-captured']);
  });

  it('változatlan lánc — csend', () => {
    const path = ['a', 'b'] as CellId[];
    expect(cellStepSounds(2, path, map, ME)).toEqual([]);
  });

  it('rövidebb lánc — csend (a geometria újraépült)', () => {
    expect(cellStepSounds(5, ['a', 'b'] as CellId[], map, ME)).toEqual([]);
  });

  it('nagy köteg esetén csak az UTOLSÓ néhány mező szól', () => {
    // Natív ébredés vagy visszaállítás: több száz pont egyszerre. Korlát
    // nélkül percnyi géppuskatűz lenne belőle.
    const path = Array.from({ length: 300 }, (_, index) => `cell-${index}`) as CellId[];
    const sounds = cellStepSounds(0, path, new Map(), ME);
    expect(sounds.length).toBe(CELL_STEP_BURST_CAP);
    expect(sounds.every((sound) => sound === 'cell-captured')).toBe(true);
  });

  it('ismeretlen (még le nem kért) mező szabadnak számít', () => {
    // A csempeválasz a nézet közepét fedi; a szélén nem tudunk semmit. A
    // rács alapállapota a szabad mező, tehát ez a helyes feltételezés.
    expect(cellStepSounds(0, ['ismeretlen'] as CellId[], map, ME)).toEqual(['cell-captured']);
  });
});
