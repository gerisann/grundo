/**
 * Felhasználói profil — létrehozás és névszabályok.
 *
 * Tiszta függvények, Firestore nélkül. A séma forrása: docs/05-adatmodell.md
 */

import { GAMEPLAY } from '../../../src/config/gameplay';
import { localDay, nextLocalMidnight } from './gridMath';

const USERNAME_PATTERN = /^[a-z0-9._]{3,20}$/;

const RESERVED = new Set([
  'admin', 'administrator', 'grund', 'grundo', 'support', 'help', 'root',
  'system', 'moderator', 'mod', 'official', 'team', 'api', 'null', 'undefined',
]);

/**
 * A név KÉT alakban él, és a kettőnek külön dolga van.
 *
 * `usernameLower` — az egyediségi kulcs. Ez a `usernames/{id}` dokumentum
 * azonosítója, és minden keresés, névfeloldás és ütközésvizsgálat ezen megy.
 * Így a „Geri" és a „geri" ugyanaz a név: nem lehet mindkettőt lefoglalni,
 * és a belépésnél sem számít, hogyan írja be a felhasználó.
 *
 * `username` — a megjelenítési alak, ahogy a felhasználó beírta. Ez látszik a
 * profilon és a ranglistán. Ha csak a kisbetűs alakot tárolnánk, a „Geri"-ből
 * végleg „geri" lenne — a felhasználó a saját nevét látná elrontva.
 *
 * Ugyanaz a minta, mint a GitHubon: kis-nagybetűre érzéketlen, de a beírt
 * alakot megőrzi.
 */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** A megjelenítési alak: a beírt név, csak a felesleges szóközök nélkül. */
export function displayUsername(raw: string): string {
  return raw.trim();
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
  const username = displayUsername(input.username);
  return {
    username,
    usernameLower: normalizeUsername(input.username),
    /**
     * A megjelenített név alapból a FELHASZNÁLÓNÉV.
     *
     * Korábban a Google-fiók valódi nevét vettük át ide, ami két bajt okozott:
     * a felhasználó a saját, választott neve helyett a polgári nevét látta az
     * appban, és ez a név a ranglistára is kikerült volna anélkül, hogy valaha
     * beleegyezett volna. A valódi név megadása maradjon szándékos döntés.
     */
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
      /**
       * A legutóbbi aktív nap NAPSZÁMKÉNT, a felhasználó helyi ideje szerint.
       *
       * Nem dátumszöveg: abból nem lehet napokat kivonni (20260901 − 20260831
       * = 70 volna, nem 1), a sorozat-értékelés pedig pontosan ezt a kivonást
       * végzi. A mező korábban `lastActiveDate` néven, szövegként szerepelt a
       * sémában, de a kód sosem írta — a napszámos alak nyert.
       */
      lastActiveDay: null,
      freezesLeftThisWeek: GAMEPLAY.STREAK_FREEZES_PER_WEEK,
      weeks: 0,
      /** Az ebben a folyó héten eddig aktív napok száma — a heti sorozathoz. */
      weekActiveDays: 0,
      /** Már kiosztott heti mérföldkövek (4/12/26/52), hogy ne járjanak kétszer. */
      milestonesAwarded: [] as number[],
    },

    /**
     * A napi forduló könyvelése. A `nextDueAt` a felhasználó KÖVETKEZŐ helyi
     * éjfele — a job egyetlen indexelt lekérdezéssel megtalálja, kire jár le az
     * óra, ahelyett hogy óránként végigolvasná a teljes felhasználói kört.
     */
    rollover: {
      lastDay: localDay(now, input.timezone ?? 'Europe/Budapest'),
      nextDueAt: nextLocalMidnight(now, input.timezone ?? 'Europe/Budapest'),
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
      routeRevision: 0,
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
