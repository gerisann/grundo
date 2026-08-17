/**
 * Trust Score — aktivitás-hitelesség.
 *
 * 0–100 közötti súlyozott pontszám hét jelforrásból. NEM bináris döntés,
 * mert a valóság sem bináris: egy alagútban kihagyó GPS gyanúsnak tűnik,
 * de ártatlan.
 *
 * ⚠️ A PONTSZÁM SOHA NEM KERÜLHET KLIENSRE — sem a szám, sem a részjelek.
 * A felhasználó csak a verdiktet látja. Ha a szám látszana, visszafejthető
 * és kijátszható lenne.
 *
 * VEZÉRELV: a hiányzó adat NEM bizonyíték. Aki nem hord pulzusmérőt, az nem
 * csaló — csak nincs róla adatunk. Az ilyen jel semlegesen számít, és kizárólag
 * az ELLENTMONDÁS húz le. Fordítva építve a rendszer a felhasználók többségét
 * büntetné azért, amijük nincs.
 *
 * docs/03-jatekszabalyok.md → Trust Score
 */

import { GAMEPLAY } from '@/config/gameplay';
import { distanceM } from '@/game/geo';
import type { TracePoint } from '@/types';

export type TrustVerdict = 'trusted' | 'pending_review' | 'rejected';

/** A hét jelforrás és a súlyuk. Élesben az appConfig-ból felülírható. */
export const TRUST_WEIGHTS = {
  speed: 20,
  acceleration: 15,
  gpsPrecision: 15,
  teleport: 20,
  sensorConsistency: 15,
  history: 10,
  reports: 5,
} as const;

export type TrustSignal = keyof typeof TRUST_WEIGHTS;

export interface TrustInput {
  points: readonly TracePoint[];
  type: 'run' | 'walk' | 'ride';
  distanceKm: number;
  durationS: number;
  /** eszközből érkező adatok — ha vannak, erős bizonyíték a valódiságra */
  sensors?: { avgHr?: number; avgCadence?: number; avgPowerW?: number };
  /** a felhasználó előzménye */
  history: { cleanActivities: number; avgPaceSPerKm?: number; upheldReports: number };
  /** független, hiteles bejelentők száma erre az aktivitásra */
  credibleReports: number;
  /** hézagkitöltési figyelmeztetések a cellaláncból (src/game/cells.ts) */
  largeGaps: number;
}

export interface TrustResult {
  score: number;
  /** részjelenként 0–1 közötti érték (1 = teljesen rendben) */
  signals: Record<TrustSignal, number>;
  verdict: TrustVerdict;
  /** a felhasználónak MUTATHATÓ indoklás — a pontszám nélkül */
  reasons: string[];
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Ekkora időablakon mérjük a sebességet.
 *
 * NEM szakaszonként — és ez nem finomhangolás, hanem a mérés helyessége.
 * Egy jó GPS-fix is ±2-3 métert téved, és a hiba pontonként független. Egy
 * 12 km/h-val futó ember másodpercenként 3,3 métert tesz meg; ha ehhez ±3
 * méter zaj adódik, a szakaszsebesség 0 és 24 km/h között ugrál. A nyers
 * szakaszsebességre épített ellenőrzés ezért MINDEN valódi futást gyanúsnak
 * látna — pontosan ezt mértük ki az első változatnál.
 *
 * Tíz másodperc alatt a futó ~33 métert tesz meg, amihez képest a ±3 méter
 * már elhanyagolható. Az ablak elég rövid ahhoz, hogy egy valódi gyorsulás
 * vagy egy autós szakasz látszódjon.
 */
const SPEED_WINDOW_MS = 10_000;

/**
 * Ablakolt sebességek m/s-ban.
 *
 * Csúszó ablak: minden pontnál megnézzük, mennyit haladtunk az elmúlt tíz
 * másodpercben. Így a zaj kiátlagolódik, a valós tempóváltás viszont megmarad.
 */
function windowedSpeeds(points: readonly TracePoint[]): number[] {
  const speeds: number[] = [];
  let start = 0;

  for (let i = 1; i < points.length; i += 1) {
    while (start < i - 1 && points[i]!.t - points[start]!.t > SPEED_WINDOW_MS) start += 1;

    const seconds = (points[i]!.t - points[start]!.t) / 1000;
    if (seconds <= 0) continue;

    // A megtett út az ablakon belül, szakaszonként összegezve — nem a két
    // végpont távolsága, mert egy kanyar így rövidebbnek látszana.
    let meters = 0;
    for (let k = start + 1; k <= i; k += 1) meters += distanceM(points[k - 1]!, points[k]!);
    speeds.push(meters / seconds);
  }

  return speeds;
}

export function computeTrustScore(input: TrustInput): TrustResult {
  const speeds = windowedSpeeds(input.points);
  const capKmh = GAMEPLAY.MAX_SPEED_KMH[input.type];
  const capMps = capKmh / 3.6;
  const reasons: string[] = [];

  const signals: Record<TrustSignal, number> = {
    speed: speedSignal(speeds, capMps, capKmh, reasons),
    acceleration: accelerationSignal(speeds, reasons),
    gpsPrecision: precisionSignal(input.points, input.durationS, reasons),
    teleport: teleportSignal(speeds, capMps, input.largeGaps, reasons),
    sensorConsistency: sensorSignal(input, reasons),
    history: historySignal(input, reasons),
    reports: reportsSignal(input.credibleReports, reasons),
  };

  let score = 0;
  for (const name of Object.keys(TRUST_WEIGHTS) as TrustSignal[]) {
    score += signals[name] * TRUST_WEIGHTS[name];
  }
  const rounded = Math.round(score);

  return { score: rounded, signals, verdict: verdictFor(rounded), reasons };
}

/* ═══════════════════════════════════════════════════════════════════
   1. Sebesség (20)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * A plafon átlépése bünteti, de a TARTÓSAN plafonközeli sebesség is gyanús:
 * egy ember nem fut 24 km/h-val egy órán át, egy autó viszont könnyedén
 * tartja a nyolcvanat.
 */
function speedSignal(speeds: number[], capMps: number, capKmh: number, reasons: string[]): number {
  if (speeds.length === 0) return 1;

  const over = speeds.filter((s) => s > capMps).length / speeds.length;
  const nearCap = speeds.filter((s) => s > capMps * 0.85).length / speeds.length;

  // Egyetlen kiugrás lehet GPS-hiba; a szakaszok tizede már mintázat.
  const value = clamp01(1 - over * 3 - Math.max(0, nearCap - 0.2) * 1.5);

  if (over > 0.05) {
    reasons.push(
      `A nyomvonal egy része gyorsabb, mint ami ehhez a mozgásformához reális (${capKmh} km/h fölött).`,
    );
  } else if (nearCap > 0.5) {
    reasons.push('A sebesség tartósan a mozgásforma felső határán mozog.');
  }

  return value;
}

/* ═══════════════════════════════════════════════════════════════════
   2. Gyorsulás (15)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Két irányból is gyanús lehet.
 *
 * TÚL UGRÁLÓS: ember nem gyorsul nulláról húsz km/h-ra egy másodperc alatt.
 * TÚL SIMA: és nem is tart tökéletesen állandó sebességet tíz percig. Egy
 * valódi GPS-nyomon a szakaszsebességek ingadozása a mozgás velejárója; egy
 * rajzolt vagy generált nyomon ez hiányzik.
 *
 * A második a fontosabb: a hamisítás jellemzően túl szép, nem túl csúnya.
 */
function accelerationSignal(speeds: number[], reasons: string[]): number {
  if (speeds.length < 10) return 1;

  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  if (mean <= 0.1) return 1;

  // Emberi gyorsulás felső határa ~3 m/s².
  let impossible = 0;
  for (let i = 1; i < speeds.length; i += 1) {
    if (Math.abs(speeds[i]! - speeds[i - 1]!) > 3) impossible += 1;
  }
  const jerkShare = impossible / speeds.length;

  const variance = speeds.reduce((sum, s) => sum + (s - mean) ** 2, 0) / speeds.length;
  const spread = Math.sqrt(variance) / mean;
  const tooSmooth = spread < 0.05 ? (0.05 - spread) / 0.05 : 0;

  const value = clamp01(1 - jerkShare * 4 - tooSmooth * 0.6);

  if (jerkShare > 0.05) reasons.push('A sebesség irreálisan ugrál a nyomvonalon.');
  else if (tooSmooth > 0.5) {
    reasons.push('A nyomvonal szokatlanul egyenletes — valódi mozgásnál a tempó ingadozik.');
  }

  return value;
}

/* ═══════════════════════════════════════════════════════════════════
   3. GPS-pontosság (15)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * A hamisított jel tipikusan IRREÁLISAN JÓ és ÁLLANDÓ pontosságot jelent —
 * mert a hamisító beír egy szép számot. A valódi vevő pontossága folyamatosan
 * ingadozik a műholdak láthatóságával.
 *
 * A hiányzó pontosság-adat NEM büntetés: van eszköz, ami nem jelenti.
 */
function precisionSignal(
  points: readonly TracePoint[],
  durationS: number,
  reasons: string[],
): number {
  const reported = points.map((p) => p.accuracy).filter((a): a is number => a !== undefined);

  // Pontsűrűség: tartósan 0,2 pont/s alatt ritkított vagy rajzolt nyomra utal.
  const density = durationS > 0 ? points.length / durationS : 1;
  const sparse = density < 0.2 ? clamp01((0.2 - density) / 0.2) : 0;
  if (sparse > 0.5) reasons.push('A nyomvonal túl kevés pontból áll a hosszához képest.');

  // Nincs elég adat az ítélethez — csak a sűrűség számít.
  if (reported.length < points.length * 0.5) return clamp01(1 - sparse * 0.5);

  const mean = reported.reduce((a, b) => a + b, 0) / reported.length;
  const distinct = new Set(reported.map((a) => Math.round(a * 10))).size;

  // Változatlan pontosságérték végig: nem így viselkedik egy vevő.
  const constant = distinct <= 2 && reported.length > 20 ? 1 : 0;
  // Három méter alatti ÁTLAG szabad ég alatt is ritka, végig tartani gyanús.
  const tooGood = mean < 3 ? clamp01((3 - mean) / 3) : 0;

  if (constant > 0) {
    reasons.push('A jelentett GPS-pontosság végig ugyanaz, ami valódi vevőnél nem fordul elő.');
  }

  return clamp01(1 - constant * 0.6 - tooGood * 0.4 - sparse * 0.5);
}

/* ═══════════════════════════════════════════════════════════════════
   4. Teleport és folytonosság (20)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * A hexrács saját fegyvere: ha a cellalánc egy lépésben negyvennél több cellát
 * kell kitöltsön (>750 m hézag), az fizikailag lehetetlen ugrás. A hamis GPS
 * túl egyenletesen, túl nagy lépésekkel halad — a cellaláncon ez akkor is
 * látszik, ha a sebesség önmagában hihető lenne.
 */
function teleportSignal(
  speeds: number[],
  capMps: number,
  largeGaps: number,
  reasons: string[],
): number {
  const impossible = speeds.filter((s) => s > capMps * 2).length;

  if (impossible > 0) reasons.push('A nyomvonalon fizikailag lehetetlen ugrás található.');
  else if (largeGaps > 2) reasons.push('A nyomvonalon több nagy hézag van.');

  return clamp01(1 - impossible * 0.25 - largeGaps * 0.15);
}

/* ═══════════════════════════════════════════════════════════════════
   5. Szenzor-konzisztencia (15)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Itt bukik le, aki autóval „fut": harminc km/h sebesség lépésfrekvencia és
 * pulzusemelkedés nélkül.
 *
 * Szenzor híján SEMLEGES — nem bizonyíték egyik irányba sem. A jel csak akkor
 * húz le, ha az adatok EGYMÁSNAK mondanak ellent.
 */
function sensorSignal(input: TrustInput, reasons: string[]): number {
  const { sensors, type, distanceKm, durationS } = input;
  if (!sensors || (sensors.avgHr === undefined && sensors.avgCadence === undefined)) return 1;

  const speedKmh = durationS > 0 ? (distanceKm / durationS) * 3600 : 0;
  let value = 1;

  // Gyalogos mozgásnál a lépésfrekvencia és a sebesség együtt mozog.
  if (type !== 'ride' && sensors.avgCadence !== undefined && speedKmh > 8 && sensors.avgCadence < 120) {
    value -= 0.6;
    reasons.push('A lépésfrekvencia nem illik a rögzített sebességhez.');
  }

  // Nyugalmi pulzus komoly tempó mellett.
  if (sensors.avgHr !== undefined && speedKmh > 10 && sensors.avgHr < 90) {
    value -= 0.5;
    reasons.push('A pulzus nem emelkedett a terheléshez képest.');
  }

  return clamp01(value);
}

/* ═══════════════════════════════════════════════════════════════════
   6. Történeti viselkedés (10)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Az ÚJ felhasználó nem gyanús — csak ismeretlen.
 *
 * Ezért a kezdő fiók nem kap büntetést, de előleget sem: a jel a felső
 * tartomány aljáról indul, és az első tiszta aktivitásokkal éri el a teljes
 * értéket. Aki viszont a saját átlagánál hirtelen kétszer jobb tempót fut,
 * arra érdemes ránézni.
 */
function historySignal(input: TrustInput, reasons: string[]): number {
  const { history, distanceKm, durationS } = input;

  // Kezdő fiók 0,8-ról indul, tíz tiszta aktivitás után éri el az 1,0-t.
  let value = Math.min(1, 0.8 + history.cleanActivities * 0.02);

  if (history.avgPaceSPerKm !== undefined && distanceKm > 0.5 && durationS > 0) {
    const paceNow = durationS / distanceKm;
    if (paceNow < history.avgPaceSPerKm / 2) {
      value -= 0.5;
      reasons.push('A tempó jóval jobb a korábbi aktivitásaidnál — ránézünk.');
    }
  }

  value -= Math.min(0.5, history.upheldReports * 0.15);
  return clamp01(value);
}

/* ═══════════════════════════════════════════════════════════════════
   7. Jelentések (5)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * EGYETLEN bejelentés nem húz le érdemben.
 *
 * A bosszúból tett jelentés valós jelenség, és ha egy ember le tudná húzni más
 * aktivitását, a funkció fegyverré válna. Csak több, egymástól független és
 * maga is jó hírű bejelentő számít.
 */
function reportsSignal(credibleReports: number, reasons: string[]): number {
  if (credibleReports <= 0) return 1;
  if (credibleReports === 1) return 0.8;
  reasons.push('Több felhasználó is jelezte, hogy ezzel az aktivitással baj lehet.');
  return credibleReports >= 3 ? 0 : 0.4;
}

/** Küszöbök: ≥80 érvényes · 50–79 ellenőrzés alatt · <50 elutasítva. */
export function verdictFor(
  score: number,
  accept = GAMEPLAY.TRUST_THRESHOLD_ACCEPT,
  reject = GAMEPLAY.TRUST_THRESHOLD_REJECT,
): TrustVerdict {
  if (score >= accept) return 'trusted';
  if (score >= reject) return 'pending_review';
  return 'rejected';
}
