import type { ActivityType } from '@/types';
import type {
  PositionActivityState,
  PositionHandlers,
  PositionSample,
  PositionSource,
} from './types';

export interface SimulationWaypoint {
  lat: number;
  lng: number;
  elevation?: number;
}

export interface GpsSimulationConfig {
  activityType: ActivityType;
  /** Átlagsebesség km/h. */
  speedKmh: number;
  /** Névleges mintavételi idő másodpercben. */
  sampleIntervalS: number;
  /** A mintavételi idő relatív jittere. 0.15 = ±15%. */
  intervalJitter: number;
  /** A sebesség természetes relatív változása. 0.12 = kb. ±12%. */
  speedVariation: number;
  /** Jelentett vízszintes GPS pontosság átlagosan, méterben. */
  accuracyM: number;
  /** Pillanatnyi, véletlen GPS-zaj szórása méterben. */
  noiseM: number;
  /** Lassú GPS-drift erőssége méter/minta. */
  driftM: number;
  /** 0..1 valószínűség: az adott location callback kimarad. */
  dropoutProbability: number;
  /** 0..1 valószínűség: az adott fix látványosan félremegy. */
  spikeProbability: number;
  /** Spike minimális és maximális távolsága méterben. */
  spikeMinM: number;
  spikeMaxM: number;
  /** Epoch ms. */
  startAt: number;
  /** Reprodukálható véletlenhez. */
  seed: number;
}

export interface GeneratedGpsActivity {
  route: SimulationWaypoint[];
  samples: PositionSample[];
  routeDistanceM: number;
  durationMs: number;
  droppedSamples: number;
  spikeSamples: number;
  seed: number;
}

export const DEFAULT_GPS_SIMULATION_CONFIG: GpsSimulationConfig = {
  activityType: 'ride',
  speedKmh: 22,
  sampleIntervalS: 1,
  intervalJitter: 0.12,
  speedVariation: 0.1,
  accuracyM: 6,
  noiseM: 2.5,
  driftM: 0.2,
  dropoutProbability: 0.005,
  spikeProbability: 0,
  spikeMinM: 45,
  spikeMaxM: 140,
  startAt: Date.UTC(2026, 7, 24, 18, 0, 0),
  seed: 738291,
};

const EARTH_M_PER_DEG_LAT = 111_320;
const MAX_PLAYBACK_CHUNK = 128;

function metersPerDegreeLng(lat: number): number {
  return EARTH_M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

export function routeDistanceM(route: readonly Pick<SimulationWaypoint, 'lat' | 'lng'>[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i += 1) {
    total += distanceM(route[i - 1]!, route[i]!);
  }
  return total;
}

export function distanceM(
  a: Pick<SimulationWaypoint, 'lat' | 'lng'>,
  b: Pick<SimulationWaypoint, 'lat' | 'lng'>,
): number {
  const lat = (a.lat + b.lat) / 2;
  const north = (b.lat - a.lat) * EARTH_M_PER_DEG_LAT;
  const east = (b.lng - a.lng) * metersPerDegreeLng(lat);
  return Math.hypot(east, north);
}

/**
 * A megadott útvonalból valós location telemetryt állít elő.
 *
 * Az IDEÁLIS útvonal és a MÉRT GPS két külön dolog: előbb fizikailag végigmegyünk
 * a polyline-on, majd erre kerül rá az accuracy/noise/drift/dropout/spike mérési
 * modell. A végeredmény közvetlenül `PositionSample[]`, ugyanaz, amit a normál
 * browser/native PositionSource ad a recordernek.
 */
export function generateGpsActivity(
  routeInput: readonly SimulationWaypoint[],
  partial: Partial<GpsSimulationConfig> = {},
): GeneratedGpsActivity {
  const route = sanitizeRoute(routeInput);
  const cfg = normalizeConfig({ ...DEFAULT_GPS_SIMULATION_CONFIG, ...partial });
  const totalDistance = routeDistanceM(route);

  if (route.length < 2 || totalDistance <= 0) {
    return {
      route,
      samples: [],
      routeDistanceM: totalDistance,
      durationMs: 0,
      droppedSamples: 0,
      spikeSamples: 0,
      seed: cfg.seed,
    };
  }

  const rng = mulberry32(cfg.seed >>> 0);
  const cumulative = cumulativeDistances(route);
  const avgSpeedMps = cfg.speedKmh / 3.6;

  let traveledM = 0;
  let t = cfg.startAt;
  let driftEastM = 0;
  let driftNorthM = 0;
  let droppedSamples = 0;
  let spikeSamples = 0;
  const samples: PositionSample[] = [];

  // Az első fixet is mérési zajjal adjuk át — terepen sincs steril kezdőpont.
  pushMeasuredSample(0, 0);

  let guard = 0;
  while (traveledM < totalDistance && guard < 2_000_000) {
    guard += 1;

    const intervalScale = 1 + symmetric(rng) * cfg.intervalJitter;
    const dtS = Math.max(0.1, cfg.sampleIntervalS * intervalScale);
    const speedScale = Math.max(0.15, 1 + smoothRandom(rng) * cfg.speedVariation);
    const speedMps = Math.max(0.1, avgSpeedMps * speedScale);

    traveledM = Math.min(totalDistance, traveledM + speedMps * dtS);
    t += Math.max(1, Math.round(dtS * 1000));
    pushMeasuredSample(traveledM, speedMps);
  }

  const durationMs = Math.max(0, t - cfg.startAt);
  return {
    route,
    samples,
    routeDistanceM: totalDistance,
    durationMs,
    droppedSamples,
    spikeSamples,
    seed: cfg.seed,
  };

  function pushMeasuredSample(distanceAlongRouteM: number, speedMps: number) {
    // A callback időben létezik akkor is, ha a GPS/location szolgáltatás nem
    // szállít mintát. Így a következő valódi sample timestampje természetesen
    // nagyobb lesz, és a recorder valódi jelkimaradásként látja a rést.
    if (distanceAlongRouteM > 0 && rng() < cfg.dropoutProbability) {
      droppedSamples += 1;
      return;
    }

    const ideal = positionAtDistance(route, cumulative, distanceAlongRouteM);

    driftEastM += smoothRandom(rng) * cfg.driftM;
    driftNorthM += smoothRandom(rng) * cfg.driftM;
    // A drift ne sétálhasson korlátlanul el a route-tól.
    const driftLimit = Math.max(cfg.accuracyM * 1.5, cfg.noiseM * 3, 2);
    driftEastM = clamp(driftEastM, -driftLimit, driftLimit);
    driftNorthM = clamp(driftNorthM, -driftLimit, driftLimit);

    let eastM = gaussianish(rng) * cfg.noiseM + driftEastM;
    let northM = gaussianish(rng) * cfg.noiseM + driftNorthM;

    if (cfg.spikeProbability > 0 && rng() < cfg.spikeProbability) {
      const distance = lerp(cfg.spikeMinM, cfg.spikeMaxM, rng());
      const angle = rng() * Math.PI * 2;
      eastM += Math.cos(angle) * distance;
      northM += Math.sin(angle) * distance;
      spikeSamples += 1;
    }

    const measured = offsetMeters(ideal, eastM, northM);
    // A jelentett accuracy önmagában is mozog. Nem azonos a konkrét zaj
    // nagyságával: a telefon egy bizonytalansági becslést közöl.
    const accuracy = clamp(cfg.accuracyM * (0.72 + rng() * 0.62), 1, 250);

    samples.push({
      lat: measured.lat,
      lng: measured.lng,
      t,
      accuracy,
      speed: speedMps,
      ...(ideal.elevation !== undefined ? { elevation: ideal.elevation } : {}),
    });
  }
}

/**
 * `PositionSource` implementáció a generált telemetryhez.
 *
 * A recorder szempontjából ez ugyanolyan forrás, mint a böngésző vagy a natív
 * Core Location adapter. A `playbackRate` kizárólag a faliórát gyorsítja; a
 * minták SAJÁT timestampje változatlan marad, ezért a sebesség- és gap-szűrés
 * ugyanazt látja 1× és 100× lejátszásnál is.
 *
 * Hosszú aktivitásnál egyszerre mindig csak EGY timer él. Egy Balaton-kör
 * 1 Hz-en több tízezer mintát jelent; mindegyikhez előre `setTimeout`-ot
 * létrehozni önmagában stresszelné a böngészőt és meghamisítaná a tesztet.
 */
export class SimulationPositionSource implements PositionSource {
  readonly name = 'simulation';
  readonly supportsBackground = false;
  readonly ordered = true;

  private stopped = true;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly samples: readonly PositionSample[],
    private readonly playbackRate = 1,
    private readonly onComplete?: () => void,
  ) {}

  async start(
    handlers: PositionHandlers,
    _activityType?: ActivityType,
    _activityState?: PositionActivityState,
  ): Promise<void> {
    await this.stop();
    this.stopped = false;

    if (this.samples.length === 0) {
      queueMicrotask(() => {
        if (!this.stopped) this.onComplete?.();
      });
      return;
    }

    // MAX: a telemetry timestampjeit változatlanul hagyjuk, de nem egyetlen
    // microtaskban toljuk át az egész aktivitást. React a microtaskon belüli
    // állapotfrissítéseket összecsomagolja; több száz/ezer sample esetén ettől
    // a LAB úgy nézett ki, mintha semmi sem történt volna. Kis csomagok között
    // visszaadjuk a vezérlést az event loopnak, így a recorder és a UI is
    // stabilan előrehalad, miközben a MAX továbbra is közel azonnali marad.
    if (!Number.isFinite(this.playbackRate) || this.playbackRate <= 0) {
      let index = 0;
      const emitChunk = () => {
        if (this.stopped) return;

        const end = Math.min(this.samples.length, index + MAX_PLAYBACK_CHUNK);
        while (index < end) {
          const sample = this.samples[index];
          if (!sample) break;
          handlers.onSample(sample);
          index += 1;
        }

        if (index >= this.samples.length) {
          this.timer = null;
          this.onComplete?.();
          return;
        }

        this.timer = globalThis.setTimeout(() => {
          this.timer = null;
          emitChunk();
        }, 0);
      };

      queueMicrotask(emitChunk);
      return;
    }

    const emit = (index: number) => {
      if (this.stopped) return;
      const sample = this.samples[index];
      if (!sample) {
        this.onComplete?.();
        return;
      }

      handlers.onSample(sample);
      const next = this.samples[index + 1];
      if (!next) {
        this.onComplete?.();
        return;
      }

      const delay = Math.max(0, (next.t - sample.t) / this.playbackRate);
      this.timer = globalThis.setTimeout(() => {
        this.timer = null;
        emit(index + 1);
      }, delay);
    };

    queueMicrotask(() => emit(0));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) {
      globalThis.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

function sanitizeRoute(route: readonly SimulationWaypoint[]): SimulationWaypoint[] {
  return route
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => ({
      lat: clamp(p.lat, -90, 90),
      lng: wrapLng(p.lng),
      ...(p.elevation !== undefined && Number.isFinite(p.elevation)
        ? { elevation: p.elevation }
        : {}),
    }));
}

function normalizeConfig(cfg: GpsSimulationConfig): GpsSimulationConfig {
  return {
    ...cfg,
    speedKmh: clamp(cfg.speedKmh, 0.5, 200),
    sampleIntervalS: clamp(cfg.sampleIntervalS, 0.1, 60),
    intervalJitter: clamp(cfg.intervalJitter, 0, 0.95),
    speedVariation: clamp(cfg.speedVariation, 0, 0.85),
    accuracyM: clamp(cfg.accuracyM, 1, 250),
    noiseM: clamp(cfg.noiseM, 0, 250),
    driftM: clamp(cfg.driftM, 0, 50),
    dropoutProbability: clamp(cfg.dropoutProbability, 0, 0.95),
    spikeProbability: clamp(cfg.spikeProbability, 0, 0.5),
    spikeMinM: Math.max(0, cfg.spikeMinM),
    spikeMaxM: Math.max(cfg.spikeMinM, cfg.spikeMaxM),
    startAt: Number.isFinite(cfg.startAt) ? cfg.startAt : Date.now(),
    seed: Number.isFinite(cfg.seed) ? Math.trunc(cfg.seed) : 1,
  };
}

function cumulativeDistances(route: readonly SimulationWaypoint[]): number[] {
  const out = [0];
  for (let i = 1; i < route.length; i += 1) {
    out.push(out[i - 1]! + distanceM(route[i - 1]!, route[i]!));
  }
  return out;
}

function positionAtDistance(
  route: readonly SimulationWaypoint[],
  cumulative: readonly number[],
  distanceAlongRouteM: number,
): SimulationWaypoint {
  const total = cumulative[cumulative.length - 1] ?? 0;
  const target = clamp(distanceAlongRouteM, 0, total);

  let low = 1;
  let high = cumulative.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((cumulative[mid] ?? total) < target) low = mid + 1;
    else high = mid;
  }

  const index = Math.max(1, low);
  const from = route[index - 1] ?? route[0]!;
  const to = route[index] ?? route[route.length - 1]!;
  const segmentStart = cumulative[index - 1] ?? 0;
  const segmentEnd = cumulative[index] ?? segmentStart;
  const span = segmentEnd - segmentStart;
  const f = span <= 0 ? 0 : clamp((target - segmentStart) / span, 0, 1);

  const elevation =
    from.elevation !== undefined && to.elevation !== undefined
      ? lerp(from.elevation, to.elevation, f)
      : from.elevation ?? to.elevation;

  return {
    lat: lerp(from.lat, to.lat, f),
    lng: lerp(from.lng, to.lng, f),
    ...(elevation !== undefined ? { elevation } : {}),
  };
}

function offsetMeters<T extends Pick<SimulationWaypoint, 'lat' | 'lng'>>(
  point: T,
  eastM: number,
  northM: number,
): T {
  return {
    ...point,
    lat: point.lat + northM / EARTH_M_PER_DEG_LAT,
    lng: point.lng + eastM / metersPerDegreeLng(point.lat),
  };
}

function wrapLng(value: number): number {
  // Normál, már érvényes longitude-ot ne vigyünk át felesleges modulo-körön:
  // a round-trip lebegőpontos eltérést okozott az ideális route-ban.
  if (value >= -180 && value < 180) return value;
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

function symmetric(rng: () => number): number {
  return rng() * 2 - 1;
}

/** Több uniform minta összege: olcsó, középre húzó, GPS-zajhoz elég jó. */
function gaussianish(rng: () => number): number {
  return ((rng() + rng() + rng() + rng()) - 2) / 0.816496580927726;
}

/** Simább sebességváltozás, mint egyetlen uniform véletlen. */
function smoothRandom(rng: () => number): number {
  return (symmetric(rng) + symmetric(rng) + symmetric(rng)) / 3;
}

/** Determinisztikus, gyors PRNG — teszt-reprodukcióhoz. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
