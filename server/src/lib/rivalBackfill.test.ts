import { describe, expect, it } from 'vitest';
import { aggregateRivalEvents } from './rivalBackfill';

describe('aggregateRivalEvents', () => {
  it('a teljes történetből pontos, tükrözött mérleget készít', () => {
    const result = aggregateRivalEvents([
      { type: 'territory_stolen', actorId: 'a', recipientId: 'b', cellCount: 10 },
      { type: 'territory_stolen', actorId: 'b', recipientId: 'a', cellCount: 4 },
    ]);

    expect(result.aggregates.get('a|b')).toMatchObject({
      gainedCells: 10,
      lostCells: 4,
      gainedEvents: 1,
      lostEvents: 1,
    });
    expect(result.aggregates.get('b|a')).toMatchObject({
      gainedCells: 4,
      lostCells: 10,
      gainedEvents: 1,
      lostEvents: 1,
    });
  });

  it('az áttörést, hibás számot és önmagától lopást kihagyja', () => {
    const result = aggregateRivalEvents([
      { type: 'territory_defended', actorId: 'a', recipientId: 'b', cellCount: 3 },
      { type: 'territory_stolen', actorId: 'a', recipientId: 'b', cellCount: 0 },
      { type: 'territory_stolen', actorId: 'a', recipientId: 'a', cellCount: 2 },
    ]);
    expect(result.aggregates.size).toBe(0);
  });
});
