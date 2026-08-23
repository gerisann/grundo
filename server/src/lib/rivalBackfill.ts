import type { Timestamp } from 'firebase-admin/firestore';

export interface HistoricalTerritoryEvent {
  type?: unknown;
  actorId?: unknown;
  recipientId?: unknown;
  victimId?: unknown;
  cellCount?: unknown;
  createdAt?: unknown;
}

export interface RivalAggregate {
  gainedCells: number;
  lostCells: number;
  gainedEvents: number;
  lostEvents: number;
  lastAt: Timestamp | null;
}

export interface RivalBackfillResult {
  aggregates: Map<string, RivalAggregate>;
  touchedUsers: Set<string>;
  stolenEvents: number;
  stolenCells: number;
}

/** A teljes történet determinisztikus, kétoldalú riválismérlege. */
export function aggregateRivalEvents(
  events: readonly HistoricalTerritoryEvent[],
): RivalBackfillResult {
  const aggregates = new Map<string, RivalAggregate>();
  const touchedUsers = new Set<string>();
  let stolenEvents = 0;
  let stolenCells = 0;

  for (const data of events) {
    if (String(data.type ?? '') !== 'territory_stolen') continue;
    const actorId = String(data.actorId ?? '');
    const victimId = String(data.recipientId ?? data.victimId ?? '');
    const cells = Math.round(Number(data.cellCount ?? 0));
    if (!actorId || !victimId || actorId === victimId || !(cells > 0)) continue;

    const createdAt = isTimestamp(data.createdAt) ? data.createdAt : null;
    add(aggregates, actorId, victimId, cells, true, createdAt);
    add(aggregates, victimId, actorId, cells, false, createdAt);
    touchedUsers.add(actorId);
    touchedUsers.add(victimId);
    stolenEvents += 1;
    stolenCells += cells;
  }

  return { aggregates, touchedUsers, stolenEvents, stolenCells };
}

function add(
  aggregates: Map<string, RivalAggregate>,
  uid: string,
  otherUid: string,
  cells: number,
  gained: boolean,
  createdAt: Timestamp | null,
): void {
  const key = `${uid}|${otherUid}`;
  const current = aggregates.get(key) ?? {
    gainedCells: 0,
    lostCells: 0,
    gainedEvents: 0,
    lostEvents: 0,
    lastAt: null,
  };
  if (gained) {
    current.gainedCells += cells;
    current.gainedEvents += 1;
  } else {
    current.lostCells += cells;
    current.lostEvents += 1;
  }
  if (createdAt && (!current.lastAt || createdAt.toMillis() > current.lastAt.toMillis())) {
    current.lastAt = createdAt;
  }
  aggregates.set(key, current);
}

function isTimestamp(value: unknown): value is Timestamp {
  return typeof (value as { toMillis?: unknown } | null)?.toMillis === 'function';
}
