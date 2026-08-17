/**
 * GRUNDO — játékkonstansok.
 *
 * FONTOS: soha ne írj számot közvetlenül a játéklogikába. Minden hangolható
 * érték ide kerül, és élesben az `appConfig/gameplay` Firestore-dokumentumból
 * felülírható — a launch után ezeket valós adaton hangolni kell.
 *
 * Forrás: docs/04-pontrendszer.md
 */

export const GAMEPLAY = {
  // ── Rács ────────────────────────────────────────────────────────────────
  /** H3 felbontás. ~18,8 m hosszú átló — a GPS-hiba nagyságrendje.
   *  FIGYELEM: ez visszafordíthatatlan döntés. Élő adaton váltani = migráció. */
  H3_RESOLUTION: 12,
  /** Egy cella NÉVLEGES értéke. Szándékosan fix, hogy egy budapesti és egy
   *  oslói cella ugyanannyit érjen (a valós H3-terület ±néhány %-ot ingadozik). */
  CELL_AREA_M2: 307.09,

  // ── Rögzítés ────────────────────────────────────────────────────────────
  /** Ez alatt az aktivitás nem is menthető. */
  MIN_DISTANCE_M: 100,
  /** Ennél pontatlanabb GPS-pontokat eldobjuk. */
  MAX_GPS_ACCURACY_M: 30,
  /** Két egymást követő pont között ennél több cellát kitölteni gyanús
   *  (~750 m hézag) — a Trust Score jelzi. */
  MAX_GRID_PATH_CELLS: 40,

  // ── Bezárás ─────────────────────────────────────────────────────────────
  /**
   * A közrezárt terület mérete NEM feltétel.
   *
   * Korábban négy cellát követeltünk meg, és emiatt a keskeny kör — kimész az
   * út egyik oldalán, visszajössz a másikon — semmit nem ért: a két szomszédos
   * sor közt nulla cella van, tehát az egész bezárást eldobtuk, a bejárt
   * falakkal együtt. Pedig az is kör: a felhasználó visszaért oda, ahonnan
   * indult, és a bejárt folyosó jár neki.
   *
   * A GPS-remegésből eredő ál-hurkokat nem ez szűri, hanem a `MIN_LOOP_STEPS`:
   * egy helyben állva nem lehet hat különböző cellát bejárni és visszatérni.
   */
  MIN_INTERIOR_CELLS: 0,
  /**
   * Ennyi cellát kell bejárni két látogatás között, hogy bezárásnak számítson.
   *
   * EZ az ál-hurkok elleni védelem: hat res 12 cella ~110 méternyi út. Álló
   * helyzetben a fix pár méteres körben vándorol, ami ennyi cellát nem érint.
   */
  MIN_LOOP_STEPS: 6,
  /** Védőkorlát: efölött a hurkot elutasítjuk (≈150 km²) — repülő, vonat. */
  MAX_LOOP_BBOX_CELLS: 500_000,

  // ── Védelem ─────────────────────────────────────────────────────────────
  MAX_DEFENSE: 5,
  /** Szorzó az ÚJ védelmi szint szerint: [1×, 2×, 3×, 4×, 5×] */
  DEFENSE_MULTIPLIER: [1.0, 1.5, 2.0, 3.0, 5.0],

  // ── Pontozás ────────────────────────────────────────────────────────────
  /** 1 GP minden 1 000 m² után. Egy cella így 0,307 GP. */
  CLAIM_GP_PER_KM2: 1000,
  /** Alappont — akkor is jár, ha nem zárul be a kör. Ez a rendszer
   *  legfontosabb ösztönző eleme. */
  BASE_GP_PER_KM: { run: 10, walk: 10, ride: 4 } as const,
  /** Idegentől elvett területre. */
  STEAL_BONUS: 0.5,
  /** Védett zóna áttörésekor, amikor a terület még nem cserél gazdát. */
  BREAKTHROUGH_BONUS: 0.25,

  // ── Sorozat ─────────────────────────────────────────────────────────────
  DAILY_STREAK_STEP: 0.05,
  DAILY_STREAK_MAX: 1.5,
  /** Egy kihagyott nap hetente nem töri meg a sorozatot. */
  STREAK_FREEZES_PER_WEEK: 1,
  WEEK_STREAK_MILESTONES: { 4: 500, 12: 2000, 26: 5000, 52: 12000 } as Record<number, number>,

  // ── Napi jóváírás ───────────────────────────────────────────────────────
  /** Tartás-bónusz: 100 GP / km² / nap = a foglalási érték 10 %-a. */
  HOLD_GP_PER_KM2: 100,
  HOLD_GP_DAILY_CAP: 1000,
  /** Az inaktív birodalom nem termel. */
  HOLD_REQUIRES_ACTIVE_DAYS: 7,
  /** Lágy plafon: efölött 50 %-os hozam. Nem kemény korlát. */
  SOFT_CAP_GP_PER_DAY: 5000,
  SOFT_CAP_RATE: 0.5,

  // ── Szintek (kumulált GP) ───────────────────────────────────────────────
  LEVELS: [0, 2500, 7500, 17500, 35000, 65000, 110000, 180000, 280000, 420000],
  LEVEL_NAMES: [
    'ÚJONC', 'FELDERÍTŐ', 'BIRTOKOS', 'ŐRSZEM', 'HÓDÍTÓ',
    'HADVEZÉR', 'URALKODÓ', 'LEGENDA', 'TITÁN', 'GRUNDMESTER',
  ],
  /** A távolság-létra a jelvények szintjén marad meg (rétegenként). */
  DISTANCE_BADGE_LADDER_KM: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000],

  // ── Trust Score ─────────────────────────────────────────────────────────
  TRUST_THRESHOLD_ACCEPT: 80,
  TRUST_THRESHOLD_REJECT: 50,
  TRUST_AUTO_APPROVE_MINUTES: 60,
  /** Sebességplafonok típusonként (km/h). */
  MAX_SPEED_KMH: { run: 25, walk: 12, ride: 80 } as const,

  // ── Adatvédelem ─────────────────────────────────────────────────────────
  PRIVACY_RADII_M: [50, 100, 200] as const,
  PRIVACY_DEFAULT_RADIUS_M: 200,
  PRIVACY_DEFAULT_ON: true,

  // ── Ingyenes korlátok (a Pro ezeket oldja fel — játékbeli előnyt SOHA) ──
  FREE_ROUTE_GENERATIONS_PER_WEEK: 5,
  FREE_ACTIVE_EQUIPMENT: 3,
  FREE_VISIBLE_HISTORY: 30,
  EMAIL_VERIFICATION_GRACE_DAYS: 7,
} as const;

export type ActivityType = keyof typeof GAMEPLAY.BASE_GP_PER_KM;
