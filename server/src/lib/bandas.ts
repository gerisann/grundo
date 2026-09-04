/**
 * Bandák — csoportok, ahol a tagok területe és pontja összeadódik.
 *
 * Tiszta segédfüggvények, Firestore nélkül — a `rivals.ts`/`user.ts` mintája.
 * A séma forrása: docs/05-adatmodell.md → `bandas/{bandaId}`.
 *
 * ⚠️ NÉV, NEM MEGHÍVÓKÓD-EGYEDISÉG: a `nameLower` csak kereséshez kell
 * (prefix-illeszkedés, a `usernameLower` mintájára), NEM egyedi kulcs — több
 * banda hívhatja magát ugyanúgy, ellentétben a felhasználónévvel.
 */

import { randomInt } from 'node:crypto';

export const BANDA_NAME_MIN = 3;
export const BANDA_NAME_MAX = 40;
export const BANDA_DESCRIPTION_MAX = 300;
export const INVITE_CODE_LENGTH = 8;

/** Kizárva a összetéveszthető karakterek: `I/1`, `O/0`. */
const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type BandaVisibility = 'public' | 'private';
export type BandaRole = 'owner' | 'moderator' | 'member';

/** Ki hívhat meg / ki posztolhat — mindkét beállítás ugyanezt a három fokozatot ismeri. */
export type RolePermission = 'everyone' | 'moderators' | 'owner';
export type PublicJoinMode = 'instant' | 'approval';

export interface BandaSettings {
  whoCanInvite: RolePermission;
  inviteCodeVisibleTo: RolePermission;
  /** Ki posztolhat a hírfolyamba — a chat falra bárki tag írhat, arra nincs beállítás. */
  postPermission: RolePermission;
  /** Publikus bandánál azonnali-e a belépés, vagy moderátori jóváhagyást kér. */
  publicJoinMode: PublicJoinMode;
}

export const DEFAULT_BANDA_SETTINGS: BandaSettings = {
  whoCanInvite: 'everyone',
  inviteCodeVisibleTo: 'everyone',
  postPermission: 'everyone',
  publicJoinMode: 'instant',
};

/**
 * Teljesíti-e egy adott szerepkörű tag a banda egy adott jogosultsági
 * beállítását (`whoCanInvite`, `postPermission`) — az alapító mindig igen,
 * a beállítástól függetlenül.
 */
export function meetsRolePermission(role: BandaRole, permission: RolePermission): boolean {
  if (role === 'owner') return true;
  if (permission === 'owner') return false;
  if (permission === 'moderators') return role === 'moderator';
  return true;
}

/** Meghívhat-e — a `meetsRolePermission` a `whoCanInvite` beállításra. */
export const canInvite = meetsRolePermission;

export interface BandaAreaTotals {
  foot: number;
  bike: number;
}

export interface BandaTotals {
  /** Mindenkori — a tagok jelenlegi `territoryM2`-jének összege. */
  areaM2: BandaAreaTotals;
  areaDayM2: BandaAreaTotals;
  areaWeekM2: BandaAreaTotals;
  areaMonthM2: BandaAreaTotals;
  gpTotal: number;
  gpWeek: number;
  gpMonth: number;
}

export function zeroBandaTotals(): BandaTotals {
  return {
    areaM2: { foot: 0, bike: 0 },
    areaDayM2: { foot: 0, bike: 0 },
    areaWeekM2: { foot: 0, bike: 0 },
    areaMonthM2: { foot: 0, bike: 0 },
    gpTotal: 0,
    gpWeek: 0,
    gpMonth: 0,
  };
}

/** A név lekérdezéshez normalizált alakja — a `normalizeUsername` mintája. */
export function normalizeBandaName(raw: string): string {
  return raw.trim().toLowerCase();
}

/** A megjelenítési alak: a beírt név, csak a felesleges szóközök nélkül. */
export function displayBandaName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** `null` = rendben; egyébként a hiba magyar szövege. */
export function validateBandaName(raw: string): string | null {
  const value = displayBandaName(raw);
  if (!value) return 'Adj meg egy nevet a bandának.';
  if (value.length < BANDA_NAME_MIN) return `A név legalább ${BANDA_NAME_MIN} karakter.`;
  if (value.length > BANDA_NAME_MAX) return `A név legfeljebb ${BANDA_NAME_MAX} karakter.`;
  return null;
}

export function validateBandaDescription(raw: string | undefined): string | null {
  if (!raw) return null;
  if (raw.length > BANDA_DESCRIPTION_MAX) {
    return `A leírás legfeljebb ${BANDA_DESCRIPTION_MAX} karakter.`;
  }
  return null;
}

/** 8 karakteres meghívókód, kriptográfiailag erős forrásból. */
export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_ALPHABET[randomInt(0, INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

export interface NewBandaInput {
  name: string;
  description?: string;
  visibility: BandaVisibility;
  city?: string;
  ownerId: string;
}

/** A `bandas/{id}` dokumentum kezdőállapota — meghívókód nélkül. */
export function newBandaDoc(input: NewBandaInput, now: Date) {
  const name = displayBandaName(input.name);
  return {
    name,
    nameLower: normalizeBandaName(name),
    description: input.description?.trim() || null,
    photoURL: null,
    coverURL: null,
    city: input.city?.trim() || null,
    countryCode: null,
    visibility: input.visibility,
    ownerId: input.ownerId,
    memberCount: 1,
    settings: { ...DEFAULT_BANDA_SETTINGS },
    totals: zeroBandaTotals(),
    createdAt: now,
  };
}

export type BandaDoc = ReturnType<typeof newBandaDoc>;

/** Egy tag aggregálandó mezői — pontosan azok, amiket a rollup összead. */
export interface BandaMemberAggregate {
  territoryM2?: { foot?: number; bike?: number } | null;
  areaDay?: { foot?: number; bike?: number } | null;
  areaWeek?: { foot?: number; bike?: number } | null;
  areaMonth?: { foot?: number; bike?: number } | null;
  gpTotal?: number;
  gpWeek?: number;
  gpMonth?: number;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sumArea(members: readonly BandaMemberAggregate[], key: 'territoryM2' | 'areaDay' | 'areaWeek' | 'areaMonth'): BandaAreaTotals {
  let foot = 0;
  let bike = 0;
  for (const member of members) {
    const value = member[key];
    foot += num(value?.foot);
    bike += num(value?.bike);
  }
  return { foot, bike };
}

/** A sportágankénti ranglista mindenkori mezői egy felhasználóra. */
export interface BandaLifetimeStats {
  areaTotalM2: number;
  gpTotal: number;
}

/** Amit egy aktivitás-dokumentumból az összesítéshez felhasználunk. */
export interface BandaActivityRecord {
  userId?: unknown;
  type?: unknown;
  areaGainedM2?: unknown;
  gp?: unknown;
}

export const BANDA_SPORTS = ['run', 'walk', 'ride'] as const;
export type BandaSport = typeof BANDA_SPORTS[number];

function isSport(value: unknown): value is BandaSport {
  return value === 'run' || value === 'walk' || value === 'ride';
}

/**
 * Az aktivitás GP-je. Az `activityCommit` a teljes bontást tárolja
 * (`gp: result.gp`), a felhasználó `gpTotal`-ját viszont a `gp.total` növeli —
 * tehát az összesítésnek is azt kell néznie. A puszta szám a régebbi
 * dokumentumok miatt van megengedve.
 */
function activityGp(value: unknown): number {
  if (typeof value === 'number') return num(value);
  if (value !== null && typeof value === 'object') return num((value as { total?: unknown }).total);
  return 0;
}

/**
 * A sportágankénti MINDENKORI számlálók újraszámolása az aktivitás-
 * előtörténetből, felhasználónként.
 *
 * ── MIÉRT LEHET EZT UTÓLAG MEGTENNI ──────────────────────────────────────
 *
 * A `bandaStats` bevezetésekor úgy tűnt, hogy a történelmi adat elveszett: a
 * felhasználón tárolt terület `foot`/`bike` RÉTEG szerint áll, abból a futás
 * és a séta valóban nem választható szét. Az aktivitás-dokumentum viszont
 * megőrzi a `type`-ot, az `areaGainedM2`-t és a `gp`-t — a bontás tehát nem
 * hiányzik, csak egy szinttel lejjebb van.
 *
 * ⚠️ A TÖRÖLT AKTIVITÁS IS SZÁMÍT. A törlés puha (`deletedAt`), és kizárólag
 * az aktivitás- meg a távolságszámlálót csökkenti — a területet és a GP-t nem
 * (`routes/activities.ts` → `DELETE /:id`). Ha itt kiszűrnénk őket, a
 * visszaszámolt érték kevesebb lenne, mint amit a felhasználó ténylegesen
 * begyűjtött.
 */
export function aggregateBandaStatsFromActivities(
  activities: Iterable<BandaActivityRecord>,
): Map<string, Record<BandaSport, BandaLifetimeStats>> {
  const byUser = new Map<string, Record<BandaSport, BandaLifetimeStats>>();

  for (const activity of activities) {
    const userId = activity.userId;
    if (typeof userId !== 'string' || userId === '') continue;
    if (!isSport(activity.type)) continue;

    let stats = byUser.get(userId);
    if (!stats) {
      stats = {
        run: { areaTotalM2: 0, gpTotal: 0 },
        walk: { areaTotalM2: 0, gpTotal: 0 },
        ride: { areaTotalM2: 0, gpTotal: 0 },
      };
      byUser.set(userId, stats);
    }

    const sport = stats[activity.type];
    sport.areaTotalM2 += num(activity.areaGainedM2);
    sport.gpTotal += activityGp(activity.gp);
  }

  return byUser;
}

/**
 * A banda-összesítés — tiszta függvény, hogy a rollup job unit-tesztelhető
 * legyen Firestore nélkül is.
 */
export function sumBandaTotals(members: readonly BandaMemberAggregate[]): BandaTotals {
  return {
    areaM2: sumArea(members, 'territoryM2'),
    areaDayM2: sumArea(members, 'areaDay'),
    areaWeekM2: sumArea(members, 'areaWeek'),
    areaMonthM2: sumArea(members, 'areaMonth'),
    gpTotal: members.reduce((sum, m) => sum + num(m.gpTotal), 0),
    gpWeek: members.reduce((sum, m) => sum + num(m.gpWeek), 0),
    gpMonth: members.reduce((sum, m) => sum + num(m.gpMonth), 0),
  };
}
