/** GRUNDO — közös típusok. A `src/game/` modul csak ezekre támaszkodhat. */

export type Layer = 'foot' | 'bike';
export type ActivityType = 'run' | 'walk' | 'ride';
export type Visibility = 'everyone' | 'followers' | 'only_me';
export type TrustVerdict = 'trusted' | 'pending_review' | 'rejected';

/** Egy H3 cella azonosítója (res 12). */
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

/** Egy detektált bezárás. */
export interface DetectedLoop {
  /** a nyom hurkot alkotó szakasza — ezek a "falak" */
  wall: Set<CellId>;
  /** a közrezárt cellák */
  interior: Set<CellId>;
  /** a nyom indexei, ahol a hurok kezdődik és záródik */
  fromIndex: number;
  toIndex: number;
}

export type LoopRejectionReason = 'interior_too_small' | 'too_large';

export interface SuccessfulLoopDiagnostic {
  fromIndex: number;
  toIndex: number;
  wallCells: number;
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
  /** cellánkénti új állapot — csak a ténylegesen változott cellák */
  updates: Map<CellId, CellOwnership>;
  /** cellánkénti kimenetel, a pontszámításhoz */
  fates: Map<CellId, CellFate>;
  counts: Record<CellFate, number>;
  /** kitől mennyi cellát vettél el (uid → cellaszám) */
  stolenFrom: Record<string, number>;
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
  /** a lágy plafon miatt levont mennyiség */
  softCapReduction: number;
  total: number;
}
