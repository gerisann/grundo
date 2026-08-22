/**
 * GRUNDO — játékkonstansok.
 *
 * FONTOS: soha ne írj számot közvetlenül a játéklogikába. Minden hangolható
 * érték ide kerül, és élesben az `appConfig/gameplay` Firestore-dokumentumból
 * felülírható — a launch után ezeket valós adaton hangolni kell.
 *
 * Forrás: docs/04-pontrendszer.md
 */

/* ════════════════════════════════════════════════════════════════
   Szintek — 100 szint, 20 rang × 5 fokozat
   ════════════════════════════════════════════════════════════════ */

const LEVEL_RANKS = [
  'ROOKIE', 'BEGINNER', 'NOVICE', 'SKILLED', 'ADVANCED',
  'PRO', 'SPECIALIST', 'EXPERT', 'VETERAN', 'ACE',
  'ELITE', 'MASTER', 'GRANDMASTER', 'CHAMPION', 'BOSS',
  'APEX', 'TITAN', 'ICON', 'LEGEND', 'GRUNDO',
] as const;

const LEVEL_TIERS = ['I.', 'II.', 'III.', 'IV.', 'V.'] as const;

/**
 * A második szint küszöbe — innen skálázódik minden.
 *
 * MÉRT ÉRTÉK, nem érzés: egy valósághű városi kör 230–560 GP-t ad
 * (3,6 km → 231, 5,3 km → 297, 10 km → 558). Három vegyes aktivitás tehát
 * nagyjából ennyi — vagyis az első szintlépés három aktivitás után jön.
 */
const LEVEL_2_GP = 900;

/**
 * A SZÁZADIK szint küszöbe.
 *
 * A követelmény: aki MINDEN NAP aktív, annak is legalább egy év legyen.
 * A napi maximum a lágy plafon körül van (SOFT_CAP_GP_PER_DAY = 5000): efelé
 * a pont fele értéken számít, tehát a gyakorlati napi tető öt-hatezer GP.
 * 5000 × 365 = 1 825 000 — a küszöb ezért 2 000 000: még a legkitartóbb
 * játékosnak is 400 nap.
 *
 * Viszonyítási pontok egy év napi aktív játék után:
 *   ≈400 GP/nap  (napi egy közepes kör)      → 21. szint  (ADVANCED I.)
 *   ≈1500 GP/nap (napi nagy kör + tartás)    → 46. szint  (ACE I.)
 *   ≈5000 GP/nap (plafonon)                   → 94. szint
 */
const LEVEL_100_GP = 2_000_000;

/**
 * A lépcső alakja: L(n) = LEVEL_2_GP × (n−1)^p.
 *
 * MIÉRT NEM MÉRTANI SOROZAT? Mert az állandó százalékos növekedés a két
 * végpont közé szórva mikroszkopikus lépéseket adna elöl (900 → 959 →
 * 1 022…), amitől az első tíz szint egyetlen aktivitás alatt elrepülne. A
 * hatványfüggvény különbségei folyamatosan nőnek (900-tól ~35 000-ig), de az
 * első lépés mérete értelmes marad.
 */
const LEVEL_EXPONENT = Math.log(LEVEL_100_GP / LEVEL_2_GP) / Math.log(99);

/**
 * Kerekítés a LÉPCSŐ nagyságrendjéhez — nem a küszöbéhez.
 *
 * A felhasználó a lépcsőt látja („még 21 000 GP a következő szintig"), nem a
 * kumulált küszöböt. Ha a küszöböket kerekítenénk, a két szomszédos
 * kerekítési hiba összeadódna a különbségükben, és előfordulhatna, hogy a
 * 24. szint OLCSÓBB, mint a 23. — pontosan ezt mértük ki az első változatnál.
 */
function roundGap(gap: number): number {
  const step = Math.pow(10, Math.max(1, Math.floor(Math.log10(gap)) - 1));
  return Math.round(gap / step) * step;
}

/**
 * A száz küszöb.
 *
 * A lépcsőkből építkezünk, nem a küszöbökből, és két szabályt tartunk be:
 *
 *   1. a lépcső SOHA nem lehet kisebb az előzőnél — különben lenne egy szint,
 *      ami olcsóbb az alatta lévőnél, és ezt a játékos észreveszi;
 *   2. a szintértékek szigorúan nőnek — különben két szint egyszerre
 *      teljesülne, és a haladásjelző nullával osztana.
 *
 * Az UTOLSÓ lépcső nyeli el a kerekítések maradékát, hogy a csúcs pontosan a
 * tervezett kerek számon legyen. Ez a lépcső így is a legnagyobb marad.
 */
export function buildLevelThresholds(): number[] {
  const thresholds = [0];
  let previousGap = 0;

  for (let level = 2; level <= 100; level += 1) {
    const exact =
      LEVEL_2_GP * ((level - 1) ** LEVEL_EXPONENT - (level - 2) ** LEVEL_EXPONENT);
    const gap = Math.max(previousGap, roundGap(exact));
    thresholds.push(thresholds[thresholds.length - 1]! + gap);
    previousGap = gap;
  }

  thresholds[99] = LEVEL_100_GP;
  return thresholds;
}

export function buildLevelNames(): string[] {
  return LEVEL_RANKS.flatMap((rank) => LEVEL_TIERS.map((tier) => `${rank} ${tier}`));
}

export const GAMEPLAY = {
  // ── Rács ────────────────────────────────────────────────────────────────
  /** H3 felbontás. ~18,8 m hosszú átló — a GPS-hiba nagyságrendje.
   *  FIGYELEM: ez visszafordíthatatlan döntés. Élő adaton váltani = migráció. */
  H3_RESOLUTION: 12,
  /** Egy cella NÉVLEGES értéke. Szándékosan fix, hogy egy budapesti és egy
   *  oslói cella ugyanannyit érjen (a valós H3-terület ±néhány %-ot ingadozik). */
  CELL_AREA_M2: 307.09,

  // ── Modifierek (időszakos szorzók) ──────────────────────────────────────
  /**
   * A területi modifierek felbontása. ~5,16 km²/cella — nagyjából egy
   * városrész, ami az „ezen a héten a XI. kerületben 2× GP" akcióhoz a
   * megfelelő szemcsézettség.
   *
   * SZÁNDÉKOSAN DURVÁBB A BLOKKOKNÁL (res 9). Így egy blokk pontosan egy
   * modifier-cellába esik, és a birtokolt terület aránya blokkszinten
   * kiszámolható — cellánként végigmenni egy kétmillió cellás birodalmon
   * naponta nem lenne járható.
   */
  MODIFIER_AREA_RES: 7,
  /**
   * Az egyszerre ható modifierek eredőjének plafonja.
   *
   * Több akció szorzói összeszorzódnak. Ez önmagában rendben van, de amikor a
   * modifiereket később automatika is generálja, egy hibás sorozat
   * korlátlanul felszorozhatná a pontokat — és a GP nem évül, tehát az
   * eredmény maradandó. A plafon ezt tövében vágja el.
   */
  MODIFIER_MAX_FACTOR: 5,
  /**
   * Egy modifier leghosszabb élettartama napokban.
   *
   * A véges élettartam a modifier egész biztonsági alapja. Egy százéves
   * lejárat formailag véges, gyakorlatilag viszont örök — ezért a felső
   * korlát. Hosszabb akciót meg lehet hosszabbítani, de nem lehet elfelejteni.
   */
  MODIFIER_MAX_DAYS: 90,
  /**
   * Egy területi modifier legfeljebb ennyi cellát fedhet le
   * (`MODIFIER_AREA_RES` felbontáson, cellánként ~5,1 km²).
   *
   * 500 cella ~2 570 km²: egy nagyváros és a környéke bőven belefér, egy fél
   * ország nem. Ez nem játékszabály, hanem védelem az elgépelt sugár ellen —
   * a „2 km" helyett beírt „200 km" különben csendben országos akciót csinálna.
   */
  MODIFIER_MAX_AREA_CELLS: 500,

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
   * ⚠️ VOLT EGY KITÉRŐ 4-RE (2026-08-18), azzal az indoklással, hogy az 1–3
   * mezős önmetszések GPS-remegésből születnek. MEGMÉRTÜK, és nem így van:
   *
   *   - egyenes és oda-vissza séta ±3…±12 m zajjal, 320 futásban: a legnagyobb
   *     belső mezőszám MINDIG 0 — az 1-es küszöb tehát már teljesen kiszűri;
   *   - oda-vissza „folyosó" 10–60 m szélességgel: hurok nem is keletkezik,
   *     mert nincs újralátogatott cella;
   *   - amit a 4 ténylegesen levágott, az VALÓDI kis kör volt: 40 m oldal
   *     (2 belső mező) és 50 m oldal (3 belső mező) — egy belső udvar vagy egy
   *     kisebb háztömb.
   *
   * Ezért állítottuk vissza 1-re. Ha valaki megint emelni akarja, előbb a
   * /admin/aktivitasok auditban nézze meg VALÓDI aktivitásokon, hány hurok esik
   * ki `interior_too_small` okkal — a szintetikus zajmodell nem mutatja a
   * városi kanyonban sodródó GPS-hibát.
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
  /** A heti sorozat feltétele: ennyi aktív nap kell egy héten, hogy a hét számítson. */
  WEEK_STREAK_MIN_ACTIVE_DAYS: 3,
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

  // ── Szintek (kumulált GP) ──────────────────────────────────────
  /**
   * SZÁZ szint: 20 rangnév, mindegyik öt fokozattal (ROOKIE I. … GRUNDO V.).
   *
   * A lépcsőket NEM kézzel írjuk le. Száz szám kézi karbantartása garantáltan
   * eltör: egyetlen elgépelés nem monoton lépcsőt ad, amitől a szint
   * csökkenhetne — és ezt a szemnek kéne észrevennie. A képlet ehelyett
   * ellenőrizhető, hangolható, és a teszt állítást tud tenni a TULAJDONSÁGAIRA
   * (monotonitás, növekvő különbségek, a két végpont).
   */
  LEVELS: buildLevelThresholds(),
  LEVEL_NAMES: buildLevelNames(),
  /** A távolság-létra a jelvények szintjén marad meg (rétegenként). */
  DISTANCE_BADGE_LADDER_KM: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000],

  // ── Trust Score ─────────────────────────────────────────────────────────
  /**
   * MEGFIGYELŐ MÓD: a pontszám kiszámolódik és elmentődik, de nem blokkol.
   *
   * A heurisztika egyetlen valódi nyomvonalon sem futott még le. Ha élesben
   * döntene, egy félreítélés úgy jelentkezne, hogy „nem kaptam meg a
   * területet" — és semmi nem árulná el, hogy a Trust Score vette el.
   *
   * Ezért előbb mérünk: néhány valódi aktivitás pontszáma megmondja, hol
   * húzódnak a valós határok. Élesítés: ez a kapcsoló `false`-ra.
   *
   * ⚠️ Idegeneket beengedni CSAK élesített módban szabad.
   */
  TRUST_OBSERVE_ONLY: true,
  TRUST_THRESHOLD_ACCEPT: 80,
  TRUST_THRESHOLD_REJECT: 50,
  TRUST_AUTO_APPROVE_MINUTES: 60,
  /** Sebességplafonok típusonként (km/h). */
  MAX_SPEED_KMH: { run: 25, walk: 12, ride: 80 } as const,

  // ── Adatvédelem ─────────────────────────────────────────────────────────
  PRIVACY_RADII_M: [50, 100, 200] as const,
  PRIVACY_DEFAULT_RADIUS_M: 200,
  PRIVACY_DEFAULT_ON: true,

  // ── Küldetés-ajánló ─────────────────────────────────────────────────────
  /**
   * A felajánlható időkeretek percben. A bemenet IDŐ, nem távolság — a
   * felhasználónak nem kell fejben átváltania, hogy nála 45 perc hány km.
   */
  MISSION_MINUTE_OPTIONS: [15, 30, 45, 60] as const,
  /** Az egyedi időmegadás határai percben — a szerver ugyanezt ellenőrzi. */
  MISSION_MIN_MINUTES: 5,
  MISSION_MAX_MINUTES: 480,
  /**
   * Ennyi irányban keresünk kört a jelenlegi pozíció körül (docs/02: „8
   * irányban"). Minden irány EGY Directions-hívás, tehát ez egyben a
   * generálás API-költsége is.
   */
  MISSION_BEARINGS: 8,
  /**
   * Az ideális kör kerülete és a VALÓDI úthálózaton megtett táv aránya.
   *
   * Egy tökéletes kört nem lehet végigfutni: az utcák derékszögben állnak, a
   * folyók és a vasút kerülőt kényszerítenek. A sugarat ezért ennyivel
   * KISEBBRE vesszük — különben minden ajánlat túllőné a kért időt.
   *
   * ⚠️ MÉRT ÉRTÉK, nem becslés (2026-08-22, 3 budapesti kiindulás × 8 irány,
   * éles Directions-válaszokkal, `walking` profil, 7,50 km-es célhossz):
   *
   *   tényező | tényleges átlaghossz | tűrésen belül
   *   --------|----------------------|---------------
   *     1,25  |      8,55 km         |    15/24
   *     1,35  |      7,97 km         |    19/24
   *     1,40  |      7,50 km         |    22/24
   *     1,45  |      7,16 km         |    22/24
   *
   * A korábbi 1,25 tizennégy százalékkal HOSSZABB kört adott a kértnél: aki 45
   * percre kért ajánlatot, 51 percnyit kapott — és a jelöltek több mint
   * harmada emiatt esett ki a tűréshatáron.
   *
   * A tényleges hosszt továbbra is a Directions válasza adja meg, és a
   * `MISSION_DISTANCE_TOLERANCE` szűri ki, ami így is mellément.
   */
  MISSION_DETOUR_FACTOR: 1.4,
  /** A célhossztól ennyivel térhet el egy ajánlat (docs/02: „±15 %"). */
  MISSION_DISTANCE_TOLERANCE: 0.15,
  /**
   * Hány pontot adunk át a útvonaltervezőnek egy körhöz.
   *
   * Kevesebb pont: a tervező „lerövidíti" a kört, és inkább oda-vissza megy
   * ugyanazon az úton — abból nincs bezárás. Több pont: minden kanyar
   * kötöttebb, és a tervező nem tud valódi úthoz igazodni. Öt köztes pont
   * elég ahhoz, hogy a kör körbeérjen, és elég laza, hogy utcákat kövessen.
   *
   * ⚠️ AZ ÖTÖT MEGMÉRTEM, NE VIDD LEJJEBB (2026-08-22, 24 jelölt/változat).
   * Három ponttal az útvonalon tényleg kevesebb a fölösleges kitérő — de a
   * bezárt terület 2,015 km²-ről 1,147-re esik, mert egy háromszög-alakú kör
   * egyszerűen kevesebbet fog közre. A hatos és a nyolcas se hozott többet.
   */
  MISSION_WAYPOINTS: 5,
  /**
   * Alapértelmezett tempó (másodperc/km) típusonként, ha a felhasználónak
   * még nincs elég mért aktivitása.
   *
   * Szándékosan óvatos (lassabb) értékek: aki az elsőt kapja, inkább érezze
   * könnyűnek a küldetést, mint hogy ne érjen vissza a vállalt időben.
   */
  MISSION_DEFAULT_PACE_S_PER_KM: { run: 360, walk: 780, ride: 165 } as const,
  /** Ennyi korábbi aktivitásból számolunk átlagtempót. */
  MISSION_PACE_SAMPLE_ACTIVITIES: 10,

  // ── Ingyenes korlátok (a Pro ezeket oldja fel — játékbeli előnyt SOHA) ──
  FREE_ROUTE_GENERATIONS_PER_WEEK: 5,
  FREE_ACTIVE_EQUIPMENT: 3,
  FREE_VISIBLE_HISTORY: 30,
  EMAIL_VERIFICATION_GRACE_DAYS: 7,
} as const;

export type ActivityType = keyof typeof GAMEPLAY.BASE_GP_PER_KM;

/**
 * A `GAMEPLAY` típusa KITÁGÍTVA — ez a futásidejű konfiguráció típusa.
 *
 * A `GAMEPLAY` `as const`, tehát minden mezője literál típus: a
 * `CLAIM_GP_PER_SQRT_KM2` típusa nem `number`, hanem `120`. Ez az
 * alapértékekhez helyes, a felülírt konfigurációhoz viszont hazugság lenne — és
 * nem is ártalmatlan: a `TRUST_OBSERVE_ONLY` típusa `true` volna, amitől a
 * TypeScript a kikapcsolt ághoz tartozó kódot elérhetetlennek hinné.
 *
 * A `Widen` ezért literálból alaptípust csinál és leveszi a `readonly`-t. Így a
 * típus továbbra is a `GAMEPLAY`-ből származik — egy új konstans automatikusan
 * megjelenik benne, nincs kézzel karbantartott párhuzamos interfész.
 */
type Widen<T> = T extends readonly (infer U)[]
  ? Widen<U>[]
  : T extends number
    ? number
    : T extends string
      ? string
      : T extends boolean
        ? boolean
        : { -readonly [K in keyof T]: Widen<T[K]> };

export type GameplayConfig = Widen<typeof GAMEPLAY>;

/**
 * Az alapértékek, a futásidejű konfiguráció alakjában.
 *
 * Ezt használják a `src/game/` tiszta függvényei alapértelmezett paraméterként,
 * hogy a meglévő hívási helyek változatlanul működjenek. A szerver ehelyett az
 * `appConfig/gameplay`-ből feloldott pillanatképet adja át.
 */
export const DEFAULT_GAMEPLAY: GameplayConfig = GAMEPLAY as unknown as GameplayConfig;
