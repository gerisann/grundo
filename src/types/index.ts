/** GRUNDO — közös típusok. A `src/game/` modul csak ezekre támaszkodhat. */

export type Layer = 'foot' | 'bike';
export type ActivityType = 'run' | 'walk' | 'ride';
export type Visibility = 'everyone' | 'followers' | 'only_me';
export type TrustVerdict = 'trusted' | 'pending_review' | 'rejected';

/** Egy H3 cella azonosítója. A normál játékrács res 12; compact geometriában parent is lehet. */
export type CellId = string;

/** Egy nyers GPS-minta. */
export interface TracePoint {
  lat: number;
  lng: number;
  /** epoch ms */
  t: number;
  /** vízszintes pontosság méterben, ha az eszköz jelenti */
  accuracy?: number;
  /** méter a tengerszint felett */
  elevation?: number;
}

/** Egy cella tulajdonviszonya. */
export interface CellOwnership {
  /** tulajdonos uid */
  owner: string;
  /** védelmi szint, 1–5 */
  defense: number;
}

/** Cella → tulajdonos. A hívó tölti fel a claim által érintett cellákkal. */
export type OwnershipMap = Map<CellId, CellOwnership>;

/**
 * Nagy hurok tömör belseje.
 *
 * A `DetectedLoop.interior` ilyenkor csak a FALAT TARTALMAZÓ parentekben lévő,
 * pontos res12 belső cellákat tartja. A teljesen belső parenteket nem bontjuk
 * ki több millió res12 stringgé: azok itt, egyetlen H3 azonosítóként élnek.
 *
 * Ez NEM felbontáscsökkentés. Egy parent minden res12 gyereke belső, tehát a
 * játéktér továbbra is res12; ez kizárólag memóriabeli tömör reprezentáció.
 */
export interface CompactLoopInterior {
  /** A `fullParents` H3 felbontása (jelenleg res 10). */
  parentResolution: number;
  /** Teljesen belső parent cellák; minden res12 gyerekük a hurok belseje. */
  fullParents: Set<CellId>;
  /** A TELJES belső pontos res12 cellaszáma: fullParents gyerekei + `interior`. */
  cellCount: number;
}

/** Egy detektált bezárás. */
export interface DetectedLoop {
  /** a nyom hurkot alkotó szakasza — ezek a "falak" (res 12) */
  wall: Set<CellId>;
  /**
   * A közrezárt res12 cellák.
   *
   * Kis/közepes huroknál ez a teljes belső. Nagy huroknál csak a pontos
   * határsáv; a homogén belső részt a `compactInterior` képviseli.
   */
  interior: Set<CellId>;
  /** Opcionális tömör belső nagy hurkokhoz. */
  compactInterior?: CompactLoopInterior;
  /** a nyom indexei, ahol a hurok kezdődik és záródik */
  fromIndex: number;
  toIndex: number;
}

export type LoopRejectionReason = 'interior_too_small' | 'too_large';

export interface SuccessfulLoopDiagnostic {
  fromIndex: number;
  toIndex: number;
  wallCells: number;
  /** Mindig a teljes, res12-egyenértékű belső cellaszám. */
  interiorCells: number;
  prunedCells: number;
}

export interface RejectedLoopDiagnostic extends SuccessfulLoopDiagnostic {
  reason: LoopRejectionReason;
  candidateCells?: number;
}

export interface LoopDiagnostics {
  successful: SuccessfulLoopDiagnostic[];
  rejected: RejectedLoopDiagnostic[];
  /** Ismételt cellák, amelyek túl rövid szakaszt zártak a hurokpróbához. */
  shortRevisits: number;
}

/** Egy cella sorsa a foglalás során. */
export type CellFate =
  | 'free'          // szabad volt, most a tiéd
  | 'reclaimed'     // már a tiéd volt, a védelem nőtt
  | 'stolen'        // idegené volt védelem nélkül, elvetted
  | 'breakthrough'; // idegené volt védve — nem cserélt gazdát, a védelem csökkent

export interface ClaimResult {
  /** cellánkénti új állapot — csak a ténylegesen változott, explicit cellák */
  updates: Map<CellId, CellOwnership>;
  /** cellánkénti kimenetel, a pontszámításhoz */
  fates: Map<CellId, CellFate>;
  counts: Record<CellFate, number>;
  /** kitől mennyi cellát vettél el (uid → cellaszám) */
  stolenFrom: Record<string, number>;
  /**
   * Kinek hány cellája állt ellen (uid → cellaszám) — védett cella, ami NEM
   * cserélt gazdát, csak a védelme csökkent. Az „X cella védelme csökkent"
   * értesítés adatforrása; nem ugyanaz, mint a `stolenFrom` — egy támadás
   * adhat mindkettőből egyszerre, más-más cellákra.
   */
  breakthroughFrom: Record<string, number>;
  /** a megszerzett cellák súlyozott értéke a védelmi szorzóval, m²-ben */
  weightedClaimM2: number;
  /** a ténylegesen megszerzett terület m²-ben (szorzó nélkül) */
  gainedM2: number;
}

export interface GpBreakdown {
  base: number;
  claim: number;
  steal: number;
  breakthrough: number;
  streakMult: number;
  /**
   * Az időszakos szorzók eredője az EGÉSZ aktivitásra (1 = nem volt akció).
   *
   * Az igénypontra ható `claim_multiplier` nem itt jelenik meg, hanem már a
   * `claim` mezőben — az igénypont a lopás- és áttörésbónusz alapja is, tehát
   * ott kell hatnia, hogy a részek összege kijöjjön.
   */
  modifierMult: number;
  /** a lágy plafon miatt levont mennyiség */
  softCapReduction: number;
  total: number;
}
