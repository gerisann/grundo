/**
 * Az A→B→A kétoldali kör geometriája — TISZTA függvények, I/O nélkül.
 *
 * MI EZ? A felhasználó megad egy célt, és nem ugyanazon az úton akar
 * visszajönni: az odaút a közvetlen A–B vonal egyik, a visszaút a másik
 * oldalán megy, és a kettő együtt bezár egy területet. Ez a modul azokat a
 * mértani segédeket adja, amikből a tervező (`server/src/lib/directions.ts`)
 * összerakja a GraphHopper-kéréseket.
 *
 * ⚠️ KÉT DOLGOT MÉRTEM MEG ELŐRE (2026-09-12, helyi GraphHopper 11 — a számok
 * a `docs/routing/point-to-point.md`-ben vannak), és mindkettő közvetlenül
 * meghatározza, hogy ez a modul mit csinál:
 *
 *   1. **A kerülő méretét NEM lehet a jutalmazott sáv szélesítésével
 *      állítani.** A „közepes" és a „nagy" sáv bitre ugyanazt az útvonalat
 *      adta, mert a router a megengedett sávon belül is a legolcsóbbat
 *      választja. Ezért van `detourViaPoint`: a méretet KÖZTES PONT állítja,
 *      a sáv csak az oldalt választja meg.
 *   2. **A kerülendő poligonok száma mérhetően drágít** (4 poligon 229 ms,
 *      27 poligon 557 ms egy 6 km-es úton). Ezért a `routeAvoidRings`
 *      ritkít és PLAFONT tart, nem minden pontra tesz négyzetet.
 *
 * A poligonok itt ROUTING-SÚLYOZÁSHOZ készülnek, nem területszámításhoz — a
 * „poligon-algebra soha" szabály a megszerzett területre vonatkozik (H3
 * cellák), azt ez nem érinti.
 */

import { bearingDeg, distanceM, EARTH_RADIUS_M, type LatLng } from './geo';
import { destinationPoint } from './missions';

const RAD = Math.PI / 180;

/** Hány méter egy szélességi fok — a gömbi sugárból, ugyanaz a geodézia, mint a `distanceM`-é. */
const M_PER_DEG_LAT = EARTH_RADIUS_M * RAD;

/**
 * Melyik oldalán megy az út a közvetlen A–B vonalnak.
 *
 * A `left` a HALADÁSI IRÁNYHOZ képest bal — tehát az odaút `left` oldala és a
 * visszaút `left` oldala a térképen ugyanaz a fél, mert a visszaút iránya
 * fordított. A hívónak ezért az odaúthoz és a visszaúthoz UGYANAZT az A→B
 * tengelyt kell átadnia, és csak az oldalt váltania.
 */
export type RouteSide = 'left' | 'right';

function sideSign(side: RouteSide): 1 | -1 {
  return side === 'left' ? 1 : -1;
}

/** Hány méter egy hosszúsági fok az adott szélességen. */
function mPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos(lat * RAD);
}

/**
 * Helyi sík vetítés: a `point` az `origin`-hoz képest hány méterre van keletre
 * és északra. Városi léptéken (néhány tíz km) ez néhány méteren belül pontos,
 * és nem visz be gömbi trigonometriát minden poligonsarokba.
 */
function toLocalM(origin: LatLng, point: LatLng): { east: number; north: number } {
  return {
    east: (point.lng - origin.lng) * mPerDegLng(origin.lat),
    north: (point.lat - origin.lat) * M_PER_DEG_LAT,
  };
}

/** A `toLocalM` inverze, GeoJSON-sorrendben (`[lng, lat]`). */
function toLngLat(origin: LatLng, east: number, north: number): [number, number] {
  return [origin.lng + east / mPerDegLng(origin.lat), origin.lat + north / M_PER_DEG_LAT];
}

/**
 * A kerülő KÖZTES PONTJA: az A–B szakasz felezőpontjából merőlegesen kilépve.
 *
 * Ez adja a kerülő MÉRETÉT (`GAMEPLAY.ROUTE_DETOUR_OFFSET_M`) — a súlyozott
 * sáv erre képtelen, lásd a fájl tetején a mérést. A tervező A→köztes→B
 * útvonalat kér, tehát a köztes pont kötelező állomás: a GraphHopper a
 * legközelebbi útra kapcsolja, és onnan megy tovább a cél felé.
 */
export function detourViaPoint(
  from: LatLng,
  to: LatLng,
  side: RouteSide,
  offsetM: number,
  alongFraction = 0.5,
): LatLng {
  const axis = bearingDeg(from, to);
  const along = Math.min(1, Math.max(0, alongFraction));
  const anchor = destinationPoint(from, axis, distanceM(from, to) * along);
  // +90° a haladási irányhoz képest jobbra mutat, ezért a bal oldal −90°.
  return destinationPoint(anchor, axis - 90 * sideSign(side), Math.max(0, offsetM));
}

/**
 * Előjeles oldaltávolság az A→B egyenestől, méterben: pozitív a BAL oldalon.
 *
 * Ebből derül ki, hogy a két leg tényleg szétvált-e — és az önellenőrzésben ez
 * a mérték mondja meg, hogy az odaút nem csúszott-e át a visszaút oldalára.
 */
export function signedSideOffsetM(from: LatLng, to: LatLng, point: LatLng): number {
  const axis = toLocalM(from, to);
  const target = toLocalM(from, point);
  const length = Math.hypot(axis.east, axis.north);
  if (length === 0) return 0;
  // Kétdimenziós keresztszorzat: előjele az oldalt, nagysága a távolságot adja.
  return (axis.east * target.north - axis.north * target.east) / length;
}

/**
 * Az A–B vonal egyik oldalát lefedő téglalap, GeoJSON gyűrűként.
 *
 * Ezt a tervező JUTALMAZÓ területként adja a kérésbe: ami ezen kívül esik,
 * annak csökken a prioritása, tehát az útvonal a kívánt oldalra húz. A méretet
 * nem ez adja (lásd `detourViaPoint`), csak az oldalválasztást.
 *
 * A `overshootM` a szakasz két végén túlnyúlik, különben az A és B körüli
 * utcák félig kilógnának a területből, és a rajt környékén értelmetlen
 * kanyargás keletkezne.
 */
export function sideCorridorRing(
  from: LatLng,
  to: LatLng,
  side: RouteSide,
  innerM: number,
  outerM: number,
  overshootM = 800,
): [number, number][] {
  return axisBandRing(from, to, side, { innerM, outerM, overshootM });
}

/**
 * Több köztes pont a tengely mentén, a leg haladási sorrendjében.
 *
 * ⚠️ MIÉRT TÖBB? Egyetlen, a felezőponttól merőlegesen kitett pont HÁROMSZÖGET
 * ad: az útvonal kimegy oldalra, majd visszajön — közben egy szakaszon a
 * céltól TÁVOLODIK. A felhasználói szabály viszont az, hogy „az útvonal végig
 * nagyjából a cél felé halad, csak tesz egy kitérőt". Két pont ezt lapos
 * kidudorodássá teszi: kimegy, végigmegy oldalt, visszajön.
 *
 * A sorrend a `start`-tól mért távolság szerint áll be, ezért a visszaútnál —
 * ami `B`-ből indul — ugyanaz a hányadoslista fordítva adja a pontokat.
 */
export function detourViaPoints(
  from: LatLng,
  to: LatLng,
  side: RouteSide,
  offsetM: number,
  fractions: readonly number[],
  start: LatLng = from,
): LatLng[] {
  return fractions
    .map((fraction) => detourViaPoint(from, to, side, offsetM, fraction))
    .sort((a, b) => distanceM(start, a) - distanceM(start, b));
}

export interface AxisBandOptions {
  /** A tengelytől mért belső határ, méterben. */
  innerM: number;
  /** A tengelytől mért külső határ, méterben. */
  outerM: number;
  /**
   * A tengely mentén hol kezdődik és hol ér véget a sáv (0 = `from`, 1 = `to`).
   *
   * ⚠️ MIÉRT KELL EZ? Az `A` és a `B` PONT A TENGELYEN VAN. Ha a sáv a
   * végpontokig ér, akkor az indulás és az érkezés maga esik büntetett zónába,
   * és a tervező a rajt körül kezd értelmetlenül kanyarogni, hogy minél előbb
   * kijusson. A végpontok környékét ezért szabadon kell hagyni.
   */
  fromFraction?: number;
  toFraction?: number;
  /** Mennyit nyúljon túl a sáv a szakaszon — csak a 0/1 hányadnál értelmes. */
  overshootM?: number;
}

/**
 * Téglalap az A–B tengely egyik oldalán, a tengely mentén és attól mért
 * távolságban is határolva.
 *
 * Ebből épül a „még nem vagyok elég messze" és a „már elég messze vagyok"
 * zóna: a kettő ugyanazon az oldalon, egymás mellett, más-más súllyal.
 */
export function axisBandRing(
  from: LatLng,
  to: LatLng,
  side: RouteSide,
  options: AxisBandOptions,
): [number, number][] {
  const axis = toLocalM(from, to);
  const length = Math.hypot(axis.east, axis.north);
  if (length === 0) return [];

  const alongEast = axis.east / length;
  const alongNorth = axis.north / length;
  // Merőleges egységvektor a kívánt oldal felé.
  const sign = sideSign(side);
  const sideEast = -alongNorth * sign;
  const sideNorth = alongEast * sign;

  const overshootM = options.overshootM ?? 800;
  const startAlong =
    options.fromFraction === undefined ? -overshootM : length * options.fromFraction;
  const endAlong =
    options.toFraction === undefined ? length + overshootM : length * options.toFraction;
  if (endAlong <= startAlong) return [];

  const corner = (along: number, offset: number): [number, number] =>
    toLngLat(
      from,
      alongEast * along + sideEast * offset,
      alongNorth * along + sideNorth * offset,
    );

  return [
    corner(startAlong, options.innerM),
    corner(endAlong, options.innerM),
    corner(endAlong, options.outerM),
    corner(startAlong, options.outerM),
    corner(startAlong, options.innerM),
  ];
}

export interface AvoidRingOptions {
  /** Mekkora sugarú folt kerüljön egy-egy mintavett pont köré. */
  bufferM?: number;
  /**
   * Legfeljebb ennyi poligon készülhet.
   *
   * ⚠️ MÉRÉSBŐL (2026-09-12): 4 poligon 229 ms, 27 poligon 557 ms. A plafon
   * nélkül egy hosszú odaút több száz poligont adna, és a visszaút
   * megtervezése önmagában másodpercekbe kerülne.
   */
  maxRings?: number;
  /**
   * A nyomvonal két végéből ekkora hányad marad ki, hossz szerint.
   *
   * ⚠️ A RAJT ÉS A CÉL KÖRNYÉKÉT NEM SZABAD KERÜLENDŐVÉ TENNI. Mindkét leg
   * ugyanabból a pontból indul és ugyanoda érkezik; ha a foltok a végpontokig
   * érnek, a tervező a saját indulását bünteti, és a rajt körül kezd
   * kanyarogni. A felhasználói szabály is ezt mondja: a kezdőpontnál és a cél
   * közelében kisebb közös szakasz elfogadható.
   */
  trimFraction?: number;
  /**
   * A foltok érjenek össze folytonos korridorrá.
   *
   * ⚠️ MIÉRT KELL? Mérve (2026-09-12): 12 folt egy 6 km-es útvonalon ~500
   * méterenként áll, 40 méteres sugárral — vagyis SZAGGATOTT. A tervező
   * minden foltnál kitér és visszatér, és pont ez adja a Geri képein látható
   * „ficakokat". Folytonos korridornál nincs mibe visszatérni.
   *
   * A sugár ilyenkor a mintavételi lépés fele, hogy a szomszédos foltok
   * érintkezzenek — de a `maxBufferM` korlátozza, nehogy egy hosszú útvonalon
   * fél várost lefedjen.
   */
  continuous?: boolean;
  /** A folytonos korridor legnagyobb megengedett sugara. */
  maxBufferM?: number;
}

/**
 * A már megtervezett odaút köré épített KERÜLENDŐ foltok.
 *
 * A visszaút kérésében ezek prioritása esik le, tehát a router csak akkor megy
 * rá ugyanarra az utcára, ha nincs más — ez pontosan a kívánt viselkedés: a
 * rajtnál és a cél közelében egy kis közös szakasz elfogadható, hosszan
 * együtt futni nem.
 *
 * A mintavétel TÁVOLSÁG szerint ritkít, nem pontindex szerint: egy sűrűn
 * mintavett kanyar és egy hosszú egyenes így ugyanannyi foltot kap.
 */
export function routeAvoidRings(
  points: readonly LatLng[],
  options: AvoidRingOptions = {},
): [number, number][][] {
  const bufferM = Math.max(10, options.bufferM ?? 40);
  const maxRings = Math.max(1, Math.trunc(options.maxRings ?? 24));
  if (points.length === 0) return [];

  let totalM = 0;
  for (let index = 1; index < points.length; index += 1) {
    totalM += distanceM(points[index - 1]!, points[index]!);
  }

  const trim = Math.min(0.45, Math.max(0, options.trimFraction ?? 0));
  const skipStartM = totalM * trim;
  const skipEndM = totalM * (1 - trim);

  // A lépésköz a plafonból jön vissza: hosszabb út ritkább mintavételt kap.
  const usableM = Math.max(0, skipEndM - skipStartM);
  const stepM = Math.max(2 * bufferM, usableM / maxRings);
  const effectiveBufferM = options.continuous
    ? Math.min(options.maxBufferM ?? 150, Math.max(bufferM, stepM / 2))
    : bufferM;
  // Trimmelés nélkül a nyomvonal eleje is folt — ez a régi viselkedés. A
  // kezdőpont a plafonba BELESZÁMÍT, különben eggyel túlcsúszna.
  const sampled: LatLng[] = trim === 0 ? [points[0]!] : [];
  let travelledM = 0;
  let carry = trim === 0 ? 0 : stepM;
  for (let index = 1; index < points.length; index += 1) {
    travelledM += distanceM(points[index - 1]!, points[index]!);
    carry += distanceM(points[index - 1]!, points[index]!);
    if (travelledM < skipStartM || travelledM > skipEndM) continue;
    if (carry < stepM) continue;
    carry = 0;
    sampled.push(points[index]!);
    if (sampled.length >= maxRings) break;
  }

  return sampled.map((point) => {
    const lat = effectiveBufferM / M_PER_DEG_LAT;
    const lng = effectiveBufferM / mPerDegLng(point.lat);
    return [
      [point.lng - lng, point.lat - lat],
      [point.lng + lng, point.lat - lat],
      [point.lng + lng, point.lat + lat],
      [point.lng - lng, point.lat + lat],
      [point.lng - lng, point.lat - lat],
    ] as [number, number][];
  });
}
