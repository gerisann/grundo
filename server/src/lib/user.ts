/**
 * Felhasználói profil — létrehozás és névszabályok.
 *
 * Tiszta függvények, Firestore nélkül. A séma forrása: docs/05-adatmodell.md
 */

const USERNAME_PATTERN = /^[a-z0-9._]{3,20}$/;

const RESERVED = new Set([
  'admin', 'administrator', 'grund', 'grundo', 'support', 'help', 'root',
  'system', 'moderator', 'mod', 'official', 'team', 'api', 'null', 'undefined',
]);

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** null = rendben; egyébként a hiba magyar szövege. */
export function validateUsername(raw: string): string | null {
  const value = normalizeUsername(raw);
  if (!value) return 'Adj meg egy felhasználónevet.';
  if (value.length < 3) return 'A felhasználónév legalább 3 karakter.';
  if (value.length > 20) return 'A felhasználónév legfeljebb 20 karakter.';
  if (!USERNAME_PATTERN.test(value)) {
    return 'A felhasználónévben csak kisbetű, szám, pont és alulvonás lehet.';
  }
  if (RESERVED.has(value)) return 'Ez a felhasználónév foglalt.';
  return null;
}

export interface NewUserInput {
  uid: string;
  username: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  timezone?: string;
}

/**
 * A `users/{uid}` dokumentum kezdőállapota.
 *
 * Az alapértékek a specifikációból jönnek, nem véletlenszerűek:
 * a privát zóna BE van kapcsolva 200 m-en (adatvédelem alapból),
 * a bizalmi szint `new` (szigorúbb Trust Score küszöbök az első 10 aktivitásra),
 * a téma `auto` (nappal világos, este sötét).
 */
export function newUserDoc(input: NewUserInput, now: Date) {
  const username = normalizeUsername(input.username);
  return {
    username,
    displayName: input.displayName?.trim() || username,
    email: input.email,
    emailVerified: false,
    photoURL: input.photoURL ?? null,
    bio: '',
    city: null,
    countryCode: null,
    timezone: input.timezone ?? 'Europe/Budapest',

    pro: { active: false, plan: null, source: null },

    level: 1,
    gpTotal: 0,
    gpWeek: 0,
    gpMonth: 0,

    territoryM2: { foot: 0, bike: 0 },
    cellCount: { foot: 0, bike: 0 },
    zoneCount: { foot: 0, bike: 0 },

    streak: {
      current: 0,
      longest: 0,
      lastActiveDate: null,
      freezesLeftThisWeek: 1,
      weeks: 0,
    },

    counters: {
      activities: 0,
      followers: 0,
      following: 0,
      distanceKm: { run: 0, walk: 0, ride: 0 },
    },

    privacy: {
      account: 'public' as const,
      defaultVisibility: 'everyone' as const,
      allowComments: true,
      hideStart: true,
      startRadiusM: 200,
      hideEnd: true,
      endRadiusM: 200,
      privacyZoneSetAt: null,
    },

    units: { distance: 'km' as const, weight: 'kg' as const, height: 'cm' as const },
    body: {},

    trust: {
      level: 'new' as const,
      cleanActivities: 0,
      upheldReports: 0,
    },

    status: 'active' as const,
    createdAt: now,
    updatedAt: now,
  };
}

export type UserDoc = ReturnType<typeof newUserDoc>;
