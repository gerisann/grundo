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
   * A bezáráshoz LEGALÁBB EGY kihagyott mező kell a két nyomvonal között.
   *
   * Egy ideig nulla volt, hogy a keskeny kör is számítson — de kiderült, hogy
   * ez kaput nyit: ha ugyanazokon a cellákon jössz vissza, MINDEN cella
   * újralátogatás, és mindegyik saját beágyazott hurkot szül. Egyetlen
   * oda-vissza séta egy 250 méteres utcán így TIZENHÁROM hurkot generált, és
   * a folyosót azonnal 5-ös védelemre vitte. Az egy kihagyott mező
   * megkövetelése ezt a kaszkádot tövében vágja el.
   *
   * A gyakorlatban ez ~30 méteres hézagot jelent a két nyomvonal között: egy
   * átlagos utca két járdája NEM elég, egy háztömb megkerülése igen.
   *
   * A GPS-remegésből eredő ál-hurkokat emellett a `MIN_LOOP_STEPS` szűri.
   */
  MIN_INTERIOR_CELLS: 1,
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
  /**
   * A terület GYÖKÉVEL arányos pont — nem magával a területtel.
   *
   * MIÉRT? Mert a bezárt terület a hurok méretének NÉGYZETÉVEL nő, a megtett
   * út viszont csak lineárisan. A korábbi „1 GP / 1000 m²" szabálynál ezért a
   * geometria uralta a játékot: egy 0,8 km-es sétánál az igénypont az alap
   * hatszorosa volt, egy 11 km-es körnél a százhetvenkétszerese. Aki egyetlen
   * nagy kört írt le, nagyságrendekkel többet kapott, mint aki ugyanannyit
   * mozgott kisebb körökben.
   *
   * A gyök a hurok LINEÁRIS méretével arányos, tehát a pont a megtett úttal
   * nő, nem a négyzetével. A nagyobb kör továbbra is többet ér — csak nem
   * aránytalanul.
   *
   * Az érték kalibrálva: egy háztömb körüli séta ~26, egy 5 km-es kör ~150,
   * egy 11 km-es bringakör ~340 igénypont.
   */
  CLAIM_GP_PER_SQRT_KM2: 120,
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
  /**
   * Szintlépcsők — elöl sűrűn, hátul ritkán.
   *
   * Egy átlagos aktivitás a gyök-alapú szabállyal ~150-350 GP. Ebből:
   * a 2. szint egy-két aktivitás, a 3. további három, a 4. további öt-hat —
   * onnantól minden szint nagyjából kétszer annyi, mint az előző.
   *
   * A cél, hogy a kezdés azonnal visszajelezzen, a felső szintek viszont
   * valóban jelentsenek valamit: a 10. szint heti négy aktivitással is évek
   * munkája.
   */
  LEVELS: [0, 300, 900, 2000, 4200, 8500, 16000, 30000, 55000, 100000],
  LEVEL_NAMES: [
    'JÖVEVÉNY', 'KÓBORLÓ', 'NYOMKERESŐ', 'HATÁRJÁRÓ', 'TERÜLETŐR',
    'GRUNDŐR', 'VÁROSJÁRÓ', 'NAGYGAZDA', 'GRUNDBÍRÓ', 'GRUNDMESTER',
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
