/**
 * Jelvények — katalógus és kiértékelés.
 *
 * docs/04-pontrendszer.md → Jelvények.
 *
 * A KATALÓGUS KÓDBAN VAN, nem csak Firestore-ban, jóllehet a spec „adatvezérelt,
 * `badges` kollekció"-t ír. Az admin CRUD-szerkesztő (docs/06 → 8. Jelvény- és
 * szintkatalógus) még nincs megírva — amíg nincs felület, ami módosítaná, a
 * kódban tartott katalógus egyszerűbb és típusbiztos, ugyanúgy, ahogy a
 * `GAMEPLAY.LEVEL_NAMES` is kódban él. A `badges/{id}` Firestore-dokumentumok
 * erről a katalógusról vannak vetítve (lásd `server/src/scripts/seedBadges.ts`),
 * hogy a séma a jövőbeli admin-szerkesztéshez és a kihívások
 * `rewardBadgeId` hivatkozásaihoz is készen álljon.
 *
 * MIÉRT NEM MINDEN KATEGÓRIA VAN ITT? A specben tíz kategória van, ebben a
 * körben HAT készült el — csak azok, amikhez MA VAN valódi adat:
 *
 *   - Első lépések (3/4): „első visszaszerzés" kimaradt, mert a
 *     `territoryEvents` ma nem különbözteti meg a lopást a visszaszerzéstől
 *     (ugyanaz a `territory_stolen` esemény) — ez játékegyensúly-kérdés,
 *     „Amit kérdezz meg, ne találj ki" (AGENTS.md).
 *   - Védő, Felfedező, Közösség, Pro: KIMARADT, mert az alattuk lévő adat
 *     nincs megírva (nincs védekezés-eseménynapló, a `passport` sosem
 *     íródik, nincs klub/kihívás-tagság, az előfizetés-életciklus nincs
 *     megépítve). Ezeket kitalálni hazugság lenne a felhasználónak.
 */

import { GAMEPLAY } from '@/config/gameplay';

export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'platinum';
export type BadgeCategory =
  | 'first_steps'
  | 'distance'
  | 'territory'
  | 'conqueror'
  | 'streak'
  | 'week_streak'
  | 'loyalty';

export interface BadgeDef {
  id: string;
  category: BadgeCategory;
  name: string;
  description: string;
  tier: BadgeTier;
  rewardGp: number;
}

/** A kiértékeléshez szükséges, MÁR ISMERT állapot — mindig a friss profilból jön. */
export interface BadgeContext {
  activitiesCount: number;
  distanceKm: { run: number; walk: number; ride: number };
  /** Összesen elfoglalt terület, mindkét réteg összegezve, m²-ben. */
  territoryM2Total: number;
  /** Hányszor indított sikeres területrablást — `territoryEvents` darabszám. */
  stealCount: number;
  /** A valaha elért leghosszabb napi sorozat (`streak.longest`, sosem csökken). */
  streakLongestDays: number;
  /** A valaha elért heti mérföldkövek (`streak.milestonesAwarded`, sosem törlődik). */
  weekMilestonesAwarded: readonly number[];
  /** A fiók kora napokban (`Date.now() - createdAt`). */
  accountAgeDays: number;
}

function badge(
  id: string,
  category: BadgeCategory,
  name: string,
  description: string,
  tier: BadgeTier,
  rewardGp: number,
): BadgeDef {
  return { id, category, name, description, tier, rewardGp };
}

/**
 * A négy fokozat egy létrán belül egyenletesen oszlik el.
 *
 * Az utolsó fokozat mindig platina — az a legritkább, legrangosabb elem egy
 * létrán. A többi a hossztól függően bronz→ezüst→arany sorrendben tölt fel.
 */
function tierFor(index: number, total: number): BadgeTier {
  if (index === total - 1) return 'platinum';
  const ratio = index / Math.max(1, total - 1);
  if (ratio < 0.34) return 'bronze';
  if (ratio < 0.67) return 'silver';
  return 'gold';
}

/* ── Első lépések ────────────────────────────────────────────────── */

const FIRST_STEPS: BadgeDef[] = [
  badge('first_activity', 'first_steps', 'Első lépés', 'Rögzítetted az első aktivitásodat.', 'bronze', 20),
  badge(
    'first_loop',
    'first_steps',
    'Első bezárt kör',
    'Bezártál egy kört, és terület lett a tiéd.',
    'bronze',
    50,
  ),
  badge(
    'first_steal',
    'first_steps',
    'Első hódítás',
    'Elvettél egy darab területet egy másik játékostól.',
    'silver',
    80,
  ),
];

/* ── Távolság (rétegenként) ──────────────────────────────────────── */

const DISTANCE_REWARDS: readonly number[] = [
  50, 150, 300, 600, 1000, 1800, 3000, 5000, 8000, 14000,
];

function distanceBadges(layer: 'foot' | 'bike', label: string): BadgeDef[] {
  const ladder = GAMEPLAY.DISTANCE_BADGE_LADDER_KM;
  return ladder.map((km, index) =>
    badge(
      `distance_${layer}_${km}`,
      'distance',
      `${label} — ${km} km`,
      `Összesen ${km} km-t tettél meg ${label.toLowerCase()}.`,
      tierFor(index, ladder.length),
      DISTANCE_REWARDS[index] ?? 100,
    ),
  );
}

const DISTANCE = [...distanceBadges('foot', 'Gyalogos táv'), ...distanceBadges('bike', 'Bringás táv')];

/* ── Terület ─────────────────────────────────────────────────────── */

const TERRITORY_LADDER_M2: readonly number[] = [
  100_000, 500_000, 1_000_000, 5_000_000, 25_000_000, 50_000_000,
];
const TERRITORY_REWARDS: readonly number[] = [80, 250, 500, 1500, 4000, 8000];

const TERRITORY: BadgeDef[] = TERRITORY_LADDER_M2.map((m2, index) =>
  badge(
    `territory_${m2}`,
    'territory',
    `Birodalom — ${formatKm2(m2)} km²`,
    `Összesen ${formatKm2(m2)} km² terület a tiéd, valaha egyszerre birtokolva.`,
    tierFor(index, TERRITORY_LADDER_M2.length),
    TERRITORY_REWARDS[index] ?? 100,
  ),
);

function formatKm2(m2: number): string {
  const km2 = m2 / 1_000_000;
  return km2 >= 1 ? String(km2) : km2.toFixed(1);
}

/* ── Hódító ──────────────────────────────────────────────────────── */

const CONQUEROR_LADDER: readonly number[] = [10, 50, 100, 500];
const CONQUEROR_REWARDS: readonly number[] = [100, 400, 900, 3000];

const CONQUEROR: BadgeDef[] = CONQUEROR_LADDER.map((count, index) =>
  badge(
    `conqueror_${count}`,
    'conqueror',
    `Hódító — ${count}×`,
    `${count} sikeres területrablás áll mögötted.`,
    tierFor(index, CONQUEROR_LADDER.length),
    CONQUEROR_REWARDS[index] ?? 100,
  ),
);

/* ── Kitartás — napi sorozat ─────────────────────────────────────── */

const STREAK_LADDER_DAYS: readonly number[] = [7, 30, 100, 365];
const STREAK_REWARDS: readonly number[] = [50, 300, 1200, 6000];

const STREAK: BadgeDef[] = STREAK_LADDER_DAYS.map((days, index) =>
  badge(
    `streak_${days}`,
    'streak',
    `${days} napos sorozat`,
    `${days} egymást követő napon voltál aktív.`,
    tierFor(index, STREAK_LADDER_DAYS.length),
    STREAK_REWARDS[index] ?? 100,
  ),
);

/* ── Kitartás — heti sorozat ─────────────────────────────────────── */

/**
 * A KÜSZÖBÖK MEGEGYEZNEK a `GAMEPLAY.WEEK_STREAK_MILESTONES` kulcsaival.
 *
 * Ez nem véletlen: a heti mérföldkő GP-jutalma már létezik és működik
 * (`dailyRollover.ts` → `milestonesAwarded`), a jelvény csak egy MÁSODIK,
 * vizuális elismerést ad ugyanahhoz a pillanathoz — nem talál ki új
 * küszöböt.
 */
const WEEK_STREAK_LADDER: readonly number[] = Object.keys(GAMEPLAY.WEEK_STREAK_MILESTONES)
  .map(Number)
  .sort((a, b) => a - b);
const WEEK_STREAK_REWARDS: readonly number[] = [50, 200, 500, 1500];

const WEEK_STREAK: BadgeDef[] = WEEK_STREAK_LADDER.map((weeks, index) =>
  badge(
    `week_streak_${weeks}`,
    'week_streak',
    `${weeks} hetes sorozat`,
    `${weeks} egymást követő héten voltál aktív.`,
    tierFor(index, WEEK_STREAK_LADDER.length),
    WEEK_STREAK_REWARDS[index] ?? 100,
  ),
);

/* ── Hűség ───────────────────────────────────────────────────────── */

const LOYALTY_LADDER_DAYS: readonly number[] = [30, 182, 365, 730];
const LOYALTY_NAMES: readonly string[] = ['1 hónap', '6 hónap', '1 év', '2 év'];
const LOYALTY_REWARDS: readonly number[] = [30, 150, 400, 1000];

const LOYALTY: BadgeDef[] = LOYALTY_LADDER_DAYS.map((days, index) =>
  badge(
    `loyalty_${days}`,
    'loyalty',
    `${LOYALTY_NAMES[index]} a GRUNDO-ban`,
    `${LOYALTY_NAMES[index]} telt el a csatlakozásod óta.`,
    tierFor(index, LOYALTY_LADDER_DAYS.length),
    LOYALTY_REWARDS[index] ?? 50,
  ),
);

/* ── A teljes katalógus ──────────────────────────────────────────── */

export const BADGES: readonly BadgeDef[] = [
  ...FIRST_STEPS,
  ...DISTANCE,
  ...TERRITORY,
  ...CONQUEROR,
  ...STREAK,
  ...WEEK_STREAK,
  ...LOYALTY,
];

export const BADGES_BY_ID: ReadonlyMap<string, BadgeDef> = new Map(
  BADGES.map((entry) => [entry.id, entry]),
);

/**
 * Melyik jelvényeket érdemli ki a felhasználó a mostani állapotában.
 *
 * TISZTA FÜGGVÉNY: csak az `ctx`-ből számol, Firestore-t nem lát. A hívó dolga
 * eldönteni, melyik közülük ÚJ (diffelve a már meglévő
 * `users/{uid}/badges/{id}` dokumentumokkal) — ez a függvény szándékosan nem
 * tud a korábbi állapotról, mert egy létra-küszöb elérése MINDIG ugyanazt az
 * eredményt kell adja, függetlenül attól, mikor futtatjuk. Ez teszi
 * biztonságossá az újrafuttatást (aktivitás után ÉS a napi fordulóban is),
 * és ez teszi lehetővé egy jövőbeli visszamenőleges kiosztást is —
 * ugyanezzel a függvénnyel.
 */
export function earnedBadgeIds(ctx: BadgeContext): string[] {
  const ids: string[] = [];

  if (ctx.activitiesCount >= 1) ids.push('first_activity');
  // A cellabirtoklás CSAK bezárt körből származhat (03-jatekszabalyok.md →
  // „A bezárás = önmetszés"), tehát megbízható helyettesítő a „volt-e már
  // bezárt köröd" kérdésre — nem kell külön eseménynaplózás hozzá.
  if (ctx.territoryM2Total > 0) ids.push('first_loop');
  if (ctx.stealCount >= 1) ids.push('first_steal');

  const foot = ctx.distanceKm.run + ctx.distanceKm.walk;
  for (const km of GAMEPLAY.DISTANCE_BADGE_LADDER_KM) {
    if (foot >= km) ids.push(`distance_foot_${km}`);
  }
  for (const km of GAMEPLAY.DISTANCE_BADGE_LADDER_KM) {
    if (ctx.distanceKm.ride >= km) ids.push(`distance_bike_${km}`);
  }

  for (const m2 of TERRITORY_LADDER_M2) {
    if (ctx.territoryM2Total >= m2) ids.push(`territory_${m2}`);
  }

  for (const count of CONQUEROR_LADDER) {
    if (ctx.stealCount >= count) ids.push(`conqueror_${count}`);
  }

  for (const days of STREAK_LADDER_DAYS) {
    if (ctx.streakLongestDays >= days) ids.push(`streak_${days}`);
  }

  for (const weeks of WEEK_STREAK_LADDER) {
    if (ctx.weekMilestonesAwarded.includes(weeks)) ids.push(`week_streak_${weeks}`);
  }

  for (const days of LOYALTY_LADDER_DAYS) {
    if (ctx.accountAgeDays >= days) ids.push(`loyalty_${days}`);
  }

  return ids;
}
