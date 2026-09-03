import { auth } from './firebase';
import { appCheckHeader } from './appCheck';
import type { ActivityType } from '@/types';

/**
 * A GRUNDO backend kliense.
 *
 * MINDEN játékadat-írás ezen megy keresztül — a kliens Firestore-ba
 * közvetlenül csak a saját, engedélyezett mezőit írhatja (firestore.rules).
 */

/**
 * Emulátoros módban a backend MINDIG a helyi szerver.
 *
 * ⚠️ Ez nem kényelmi döntés, hanem védőháló. A Vite sorrendjében a `.env.local`
 * előbbre van, mint a `.env.emulator`, és a `.env.local`-ban az ÉLES Cloud Run
 * cím áll — vagyis emulátoros felületről az éles backendre mennének az írások,
 * miközben a fejlesztő azt hiszi, hogy homokozóban játszik. A mód és a
 * backend együtt jár: ha emulátor, akkor helyi szerver.
 */
/**
 * A helyi backend AZON A GÉPEN fut, ahonnan az oldal jött — nem „localhost"-on.
 *
 * Beégetett `localhost` mellett a fejlesztői felület csak a futtató gépen
 * működött. Telefonról megnyitva (`http://192.168.x.y:5173`) a `localhost`
 * magát a telefont jelentette volna, és minden API-hívás elhalt. A
 * `location.hostname` asztali gépen ugyanúgy `localhost`, tehát a korábbi
 * viselkedés nem változik.
 */
const EMULATOR_API_BASE = `http://${typeof location === 'undefined' ? 'localhost' : location.hostname}:8080`;

export const API_BASE = (
  import.meta.env.VITE_USE_EMULATORS === '1'
    ? EMULATOR_API_BASE
    : (import.meta.env.VITE_API_BASE_URL ?? '')
).replace(/\/+$/, '');

/**
 * A saját eredetére mutató API-cím NEM backend.
 *
 * Két okból kell ezt külön kezelni. Egyrészt könnyű elrontani: a Cloud Run
 * konzolban a frontend URL-je hasonlóan néz ki, mint a backendé. Másrészt az
 * AI Studio értéket vár minden felismert környezeti változóhoz — üresen nem
 * indul el az app —, tehát a „még nincs backend" állapotot nem lehet üres
 * stringgel kifejezni.
 *
 * Ha az API-cím a saját eredetünkre mutat, úgy tekintjük, hogy nincs backend:
 * az app működik tovább, profil nélkül, hibaüzenetek nélkül.
 */
function pointsAtSelf(base: string): boolean {
  if (typeof location === 'undefined') return false;
  try {
    return new URL(base, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

const selfReferencing = API_BASE.length > 0 && pointsAtSelf(API_BASE);

if (selfReferencing) {
  // eslint-disable-next-line no-console
  console.warn(
    `[GRUNDO] A VITE_API_BASE_URL (${API_BASE}) a frontend saját címére mutat, ` +
      'nem a Cloud Run backendre. Az app backend nélküli módban fut.',
  );
}

export const apiConfigured = API_BASE.length > 0 && !selfReferencing;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiConfigured) {
    throw new ApiError(0, 'api_unconfigured', 'A háttérszolgáltatás még nincs beállítva.');
  }

  const user = auth?.currentUser ?? null;
  const token = user ? await user.getIdToken() : null;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(await appCheckHeader()),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'network', 'Nincs kapcsolat a szerverrel. Ellenőrizd az internetet.');
  }

  /**
   * A válasznak JSON-nak KELL lennie.
   *
   * Ha a VITE_API_BASE_URL véletlenül a frontendre mutat, a statikus tárhely
   * minden ismeretlen útvonalra az index.html-t adja vissza — 200-as
   * státusszal, HTML tartalommal. Enélkül az ellenőrzés nélkül ebből egy
   * érthetetlen TypeError lenne a profil betöltésénél; így viszont megmondjuk,
   * mi a baj.
   */
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new ApiError(
      response.status,
      'not_json',
      'A háttérszolgáltatás nem JSON-t adott vissza. Valószínűleg a ' +
        'VITE_API_BASE_URL a frontend címére mutat a Cloud Run URL helyett.',
    );
  }

  const body = (await response.json().catch(() => null)) as
    | { code?: string; message?: string }
    | null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.code ?? 'unknown',
      body?.message ?? 'A művelet nem sikerült. Próbáld újra.',
    );
  }

  if (body === null) {
    throw new ApiError(response.status, 'empty_response', 'A szerver üres választ adott.');
  }
  return body as T;
}

/** Hitelesített bináris válasz — az aktivitásfotók nem publikus URL-ek. */
async function requestBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  if (!apiConfigured) {
    throw new ApiError(0, 'api_unconfigured', 'A háttérszolgáltatás még nincs beállítva.');
  }

  const user = auth?.currentUser ?? null;
  const token = user ? await user.getIdToken() : null;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      signal,
      headers: {
        Accept: 'image/*',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(await appCheckHeader()),
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'network', 'Nincs kapcsolat a szerverrel. Ellenőrizd az internetet.');
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { code?: string; message?: string }
      | null;
    throw new ApiError(
      response.status,
      body?.code ?? 'unknown',
      body?.message ?? 'A képet nem sikerült betölteni.',
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    throw new ApiError(response.status, 'not_image', 'A szerver nem képet adott vissza.');
  }
  return response.blob();
}

/**
 * A KÉRÉS TÖRZSÉNEK GZIP-TÖMÖRÍTÉSE — nagy nyomvonalaknál.
 *
 * ⚠️ Miért itt, és nem mindenütt? A `fetch` a KÉRÉS törzsét sosem tömöríti
 * magától (a VÁLASZ igen — azt a szerver és a böngésző intézi egymás közt).
 * A legtöbb GRUNDO-kérés pár száz bájt, ott a tömörítés rezsije több kárt
 * okozna, mint hasznot. Egy hosszú aktivitás nyomvonala viszont ismétlődő
 * lat/lng/t hármasokból áll — Jamal 12 órás menete (2026-09-01) 1,1 MB nyers
 * JSON volt, ami mobilneten önmagában 10-30 másodperc feltöltés, MÉG a
 * szerveroldali feldolgozás előtt.
 *
 * A szerver oldalon NEM KELL semmit tenni: az `express.json()` a
 * body-parseren keresztül alapból dekódolja a `Content-Encoding: gzip`
 * fejlécű kéréseket (`inflate` alapból bekapcsolt).
 *
 * ⚠️ A `CompressionStream` iOS Safari/WKWebView-n csak 16.4-től létezik.
 * Ahol nincs (vagy bármi közben elhasal), a sima JSON megy tömörítés
 * nélkül — ez a régi, működő viselkedés, nem hibaágazat. A tömörítés soha
 * nem állíthatja meg a mentést.
 */
async function compressedJsonBody(
  payload: unknown,
): Promise<{ body: BodyInit; headers: Record<string, string> }> {
  const json = JSON.stringify(payload);
  if (typeof CompressionStream === 'undefined') {
    return { body: json, headers: {} };
  }
  try {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
    const body = await new Response(stream).blob();
    return { body, headers: { 'Content-Encoding': 'gzip' } };
  } catch {
    return { body: json, headers: {} };
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Típusok — a szerver által visszaadott profil (docs/05)
   ═══════════════════════════════════════════════════════════════════ */

export interface Profile {
  uid: string;
  /** A megjelenítési alak, ahogy a felhasználó beírta — „Geri". */
  username: string;
  /** Az egyediségi kulcs — „geri". Kereséshez, névfeloldáshoz, hivatkozáshoz. */
  usernameLower: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  photoURL: string | null;
  level: number;
  gpTotal: number;
  gpWeek: number;
  territoryM2: { foot: number; bike: number };
  /** Hány meződ van rétegenként — a profil összesítése, nem a látott szakaszé. */
  cellCount: { foot: number; bike: number };
  zoneCount: { foot: number; bike: number };
  streak: { current: number; longest: number; weeks: number };
  counters: {
    activities: number;
    followers: number;
    following: number;
    distanceKm: { run: number; walk: number; ride: number };
  };
  pro: { active: boolean };
  /**
   * A választott cellaszín KULCSA — lásd `src/lib/cellColors.ts`.
   *
   * Hiányozhat: aki még nem választott, az alapértelmezett színt kapja. A
   * hexkód szándékosan NEM tárolódik, hogy a paletta finomhangolása ne
   * igényeljen adatmigrációt.
   */
  cellColor?: string;
  privacy: {
    hideStart: boolean;
    startRadiusM: 50 | 100 | 200;
    hideEnd: boolean;
    endRadiusM: 50 | 100 | 200;
    routeRevision: number;
  };
  /**
   * Név nélkül jön — csak `{id, earnedAt}`. A nevet, leírást és ritkasági
   * színt a `src/game/badges.ts` katalógusból oldjuk fel, ami a szerverrel
   * közös kódban él.
   */
  badges: EarnedBadge[];
}

export interface EarnedBadge {
  id: string;
  /** Unix ms. */
  earnedAt: number;
}

/** Amit a szerver visszaad egy feldolgozott aktivitásról. */
export interface ActivitySummary {
  distanceM: number;
  durationS: number;
  movingS: number;
  cellCount: number;
  loops: number;
  claimedCells: number;
  areaGainedM2: number;
  gp: number;
}

export interface UploadActivityInput {
  activityId: string;
  type: 'run' | 'walk' | 'ride';
  points: readonly { lat: number; lng: number; t: number; accuracy?: number }[];
  startedAt: number;
  endedAt: number;
  movingMs: number;
}

export type ActivityUploadStatusResult =
  | { status: 'missing' }
  | { status: 'processing' }
  | { status: 'failed'; message: string; retryable: boolean }
  | { status: 'done'; summary: ActivitySummary };

/**
 * Egy szerző neve és képe — a feedben, a részleteknél, a hozzászólásoknál.
 *
 * ⚠️ AZ `uid` KELL A „RIVÁLIS" CÍMKÉHEZ. A felület a rivális-halmazt
 * azonosító szerint tartja (`RivalProvider`); névre illeszteni törékenyebb
 * lenne, mert az átnevezés után némán rossz eredményt adna.
 */
export interface ActivityAuthor {
  uid: string;
  username: string;
  photoURL: string | null;
  /**
   * A választott cellaszín KULCSA, vagy `null`, ha nem állított magának.
   *
   * ⚠️ A `null` NEM ugyanaz, mint az alapértelmezett szín: a rivális-sáv
   * ilyenkor a régi lila-magenta párost tartja meg (lásd `rivalBarColors`).
   */
  cellColor?: string | null;
}

export type FeedScope = 'mine' | 'world' | 'local' | 'following' | 'user';

export interface FeedActivity {
  id: string;
  type: 'run' | 'walk' | 'ride';
  layer: 'foot' | 'bike';
  startedAt: number;
  distanceM: number;
  movingS: number;
  areaGainedM2: number;
  gp: number;
  /** A nyomvonal közepe — a helyi szűréshez és a térképhez. */
  center: { lat: number; lng: number } | null;
  /**
   * A kódolt nyomvonal a kártya térképéhez — MÁR LEVÁGVA a privát zónával.
   * Üres sztring, ha az egész aktivitás a védőkörön belül zajlott.
   */
  route: string;
  /** Üres a nyomvonal, mert a privát zóna lefedte — nem pedig azért, mert nincs. */
  routeHidden: boolean;
  /** A felhasználó által adott név. `null` → automatikus cím (napszak + forma). */
  title: string | null;
  photos: ActivityPhoto[];
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  activityCells: string[];
  /**
   * A nagy (compact) hurkok belseje, H3-compactolt indexekkel. A kliens
   * bontja ki res12-re — lasd expandActivityCells().
   */
  activityCellParents?: string[];
  author: ActivityAuthor;
  /** Hány mezővel nőtt a grund ebben a körben (szabad földről + elvéve). */
  cellsGained: number;
  /** Ebből mennyi jött MÁS JÁTÉKOSTÓL. */
  cellsStolen: number;
  /**
   * A kártya alján futó rivális-sáv adata — `null`, ha a kör nem vett el
   * senkitől területet.
   *
   * ⚠️ A SZÁMOK A TELJES, HALMOZOTT MÉRLEGET mutatják a szerző és a kör fő
   * károsultja között, NEM ennek az egy aktivitásnak az eredményét. Ez
   * szándékos (Geri, 2026-08-26): a sáv ugyanaz a rivális-kártya, ami a
   * profilon és a `/profil/rivalisok` fülön van, hogy egy pillantással
   * ugyanazt jelentse mindenhol.
   *
   * Az EGYETLEN aktivitáshoz kötött adat a `cellsThisActivity` — ez kerül a
   * sáv bal felső sarkába, a jobb felső szorzó párjaként.
   */
  rival: ActivityRival | null;
}

export interface ActivityRival extends ActivityAuthor {
  exchangedCells: number;
  gainedCells: number;
  lostCells: number;
  gainedEvents: number;
  lostEvents: number;
  exchangedM2: number;
  gainedM2: number;
  lostM2: number;
  /** Amit EBBEN a körben vett el tőle. */
  cellsThisActivity: number;
  /** A kör többi károsultja — jelvényként a fő kép sarkában. */
  others: ActivityAuthor[];
}

/** Egy feltöltött kép szerver által ellenőrzött Storage-útvonala. */
export interface ActivityPhoto {
  path: string;
  /** @deprecated Csak a már telepített, régi natív kliensek kompatibilitásához. */
  url?: string;
}

export interface ActivityComment {
  id: string;
  text: string;
  createdAt: number;
  /** A sajátom-e — ettől függ, törölhető-e. */
  mine: boolean;
  author: ActivityAuthor;
  /** Melyik kommentre válaszol — `null`, ha ez egy önálló hozzászólás. */
  replyToId: string | null;
  /** A megcélzott felhasználó neve, denormalizálva — lásd a szerver oldali megjegyzést. */
  replyToUsername: string | null;
}

/** Egy aktivitás teljes adatlapja — a részletek képernyőhöz. */
export interface ActivityDetail {
  id: string;
  /** A sajátom-e. Ettől függ, mit szabad mutatni és mit lehet szerkeszteni. */
  mine: boolean;
  type: 'run' | 'walk' | 'ride';
  layer: 'foot' | 'bike';
  title: string | null;
  startedAt: number;
  endedAt: number;
  distanceM: number;
  durationS: number;
  movingS: number;
  areaGainedM2: number;
  /** A GP teljes bontása: alap, igény, lopás, áttörés, sorozatszorzó. */
  gp: {
    base?: number;
    claim?: number;
    steal?: number;
    breakthrough?: number;
    streakMult?: number;
    softCapReduction?: number;
    total: number;
  };
  cellCount: number;
  loops: number;
  claimedCells: number;
  route: string;
  routeHidden: boolean;
  description: string | null;
  photos: ActivityPhoto[];
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  activityCells: string[];
  /**
   * A nagy (compact) hurkok belseje, H3-compactolt indexekkel. A kliens
   * bontja ki res12-re — lasd expandActivityCells().
   */
  activityCellParents?: string[];
  bounds: { north: number; south: number; east: number; west: number } | null;
  author: ActivityAuthor;
  /** Csak a saját aktivitásnál. Pontszám és diagnosztika soha nem jön le. */
  trustVerdict?: 'trusted' | 'pending_review' | 'rejected';
}

export interface FeedResult {
  activities: FeedActivity[];
  /** A helyi nézet a vizsgált halmaz végéig ért — lehet, hogy van még. */
  truncated?: boolean;
}

export interface FeedQuery {
  scope: FeedScope;
  limit?: number;
  /** Opcionális kezdő- és végidő (Unix ms), a felhasználó helyi naptárából. */
  dateFrom?: number;
  dateTo?: number;
  /** Csak a `local` nézethez. */
  lat?: number;
  lng?: number;
  radiusKm?: number;
  /** Csak a `user` nézethez: kinek az aktivitásait kérjük. */
  userId?: string;
}

export interface TerritoryResult {
  layer: 'foot' | 'bike';
  cells: { cell: string; defense: number }[];
  cellCount: number;
  areaM2: number;
  blockCount: number;
  truncated?: boolean;
}

export interface TileCell {
  cell: string;
  owner: string;
  defense: number;
}

/** Egy mező tulajdonosának nyilvános kártyája — a térképi koppintáshoz. */
export interface TileOwner {
  uid: string;
  username: string;
  photoURL: string | null;
  level: number;
  rankName: string;
  gpTotal: number;
  /** A megjelenített réteg szerinti terület és mezőszám. */
  areaM2: number;
  cellCount: number;
  layer: 'foot' | 'bike';
}

export interface TilesResult {
  layer: 'foot' | 'bike';
  cells: TileCell[];
  /** A nézetet lefedő res 9 blokkok — ezekből számoljuk a SZABAD cellákat. */
  blocks?: string[];
  owners: Record<string, string>;
  /**
   * uid → választott cellaszín KULCSA (nem hexkód), ha a játékos állított be
   * ilyet. A hiányzó bejegyzés nem hiba: az alapértelmezett színt jelenti.
   *
   * Régebbi backend-verzió egyáltalán nem küldi — ezért opcionális.
   */
  ownerColors?: Record<string, string>;
  /**
   * A háló csak a nézet KÖZEPÉT fedi le — a széleken nem tudjuk, mi van.
   * Ilyenkor a felület ne állítsa, hogy ott szabad a terület.
   */
  partial?: boolean;
}

/** Egy összefüggő területfolt — a térkép fő területrétegének egysége. */
export interface TerritoryBlob {
  id: string;
  owner: string;
  areaM2: number;
  cellCount: number;
  /** GeoJSON gyűrűk: [gyűrű][pont][lng, lat]. Az első a külső, a többi lyuk. */
  rings: [number, number][][];
}

export interface TerritoryBlobsResult {
  layer: 'foot' | 'bike';
  blobs: TerritoryBlob[];
  owners: Record<string, string>;
  ownerColors?: Record<string, string>;
  /** Ekkora terület alatt ezen a nagyításon nem rajzolunk — a felület jelezheti. */
  minAreaM2: number;
  truncated?: boolean;
}

export interface LeaderboardEntry {
  uid: string;
  username: string;
  photoURL: string | null;
  /** `alltime` nézetben a jelenlegi terület, egyébként az időszaki bruttó szerzés. */
  areaM2: number;
  cellCount: number;
}

/** `alltime` a jelenlegi állomány, a többi az adott időszak bruttó szerzése. */
export type LeaderboardWindow = 'day' | 'week' | 'month' | 'alltime';

/**
 * A küldetés négy karaktere — mindegyik MÁS motivációt szolgál ki, nem
 * ugyanannak a fokozatai. docs/02 → Küldetés-ajánló.
 */
export type MissionKind = 'conquest' | 'raid' | 'fortify' | 'explore';
export type MissionPriority = 'balanced' | MissionKind;

/**
 * Útvonal-karakter kapcsoló (döntés: 2026-08-29) — ugyanaz a GraphHopper-
 * tervező futtatja mindkettőt, csak a kanyarbüntetéssel vagy anélkül.
 * Séta mozgásformánál a felület nem kínálja fel.
 */
export type RouteCharacter = 'twisty' | 'straight';

export interface Mission {
  kind: MissionKind;
  distanceKm: number;
  /** Kódolt vonallánc — a Mapbox statikus térképképe közvetlenül érti. */
  polyline: string;
  /** A megszerezhető ÚJ terület (szabad + elvett). */
  areaM2: number;
  estimatedGp: number;
  cellCount: number;
  counts: { free: number; reclaimed: number; stolen: number; breakthrough: number } | null;
  newBlocks: number;
  /**
   * A célpont neve — CSAK publikus fióknál, és naponta legfeljebb egyszer
   * ugyanaz a személy. A szerver dönti el; `null` esetén a felület
   * „egy helyi játékostól" alakot ír.
   */
  victimName: string | null;
  victimAreaM2: number;
}

export interface MissionResult {
  /** A vállalt időre számolt célhossz — a felület ezt is kiírja. */
  targetKm: number;
  paceSecPerKm: number;
  quota?: { unlimited: true } | { unlimited: false; used: number; limit: number };
  missions: Mission[];
  /** `no_loops`, ha egyetlen jelölt sem zárt kört a környéken. */
  reason?: string;
}

/**
 * Egy jelölt útvonal a GYORS fázisból — terület és GP nélkül.
 *
 * Ennyi elég a kártya kirajzolásához: a vonalláncból megvan a térkép, a
 * hosszból a fejléc. A többi mező a `missionsEvaluate` válaszából érkezik.
 */
export interface PlannedRoute {
  polyline: string;
  distanceKm: number;
  /** Csak diagnosztikához és a kiértékelő kéréshez — a felület nem mutatja. */
  bearing: number;
}

/**
 * A `phase: 'plan'` válasza — a küldetés-ajánló gyors fele.
 *
 * ⚠️ NINCS BENNE TERÜLET, ÉS EZ SZÁNDÉKOS. A „NEM BECSLÉS" szabály szerint
 * nem adunk közelítő számot, amit később felülírnánk: a kártya addig töltő
 * jelzést mutat, amíg a valódi motor ki nem számolja az értéket.
 */
export interface MissionPlanResult {
  targetKm: number;
  paceSecPerKm: number;
  quota?: { unlimited: true } | { unlimited: false; used: number; limit: number };
  routes: PlannedRoute[];
  /** `no_routes` vagy `no_fit` — a `no_loops` csak a kiértékelésből derülhet ki. */
  reason?: string;
}

export interface OtpSendResult {
  sent?: boolean;
  alreadyVerified?: boolean;
  waitSeconds: number;
  /** Csak fejlesztői módban, ha nincs beállítva e-mail-szolgáltató. */
  devCode?: string;
}

export interface DevActivityListItem {
  id: string;
  userId: string;
  username: string;
  type: 'run' | 'walk' | 'ride';
  layer: 'foot' | 'bike';
  title: string | null;
  startedAt: number;
  distanceM: number;
  durationS: number;
  loops: number;
  claimedCells: number;
  areaGainedM2: number;
  gp: number;
  trustVerdict: 'trusted' | 'pending_review' | 'rejected';
  /**
   * A bizalmi pontszám (0–100), vagy `null`, ha nincs rekord.
   *
   * CSAK az admin útvonalon jön le, szerepkör-kapu mögül. A játékos felületére
   * továbbra sem kerülhet ki — ott a verdikt az egyetlen publikus információ.
   */
  trustScore: number | null;
  deleted: boolean;
  hasAudit: boolean;
}

/** A bizalmi pontszám részletei — admin-only. */
export interface DevActivityTrust {
  score: number;
  /** részjelenként 0–1 (1 = teljesen rendben) */
  signals: Record<string, number>;
  reasons: string[];
  /** amit a pontszám mondana */
  measuredVerdict: string;
  /** ténylegesen módosított-e birtokviszonyt */
  appliedGameplayDecision: string;
  observeOnly: boolean;
}

export interface DevClaimAudit {
  affectedCells: number;
  capturedFree: number;
  stolen: number;
  reinforced: number;
  weakened: number;
  unchangedAtMax: number;
  ownershipChanges: number;
  areaGainedM2: number;
  transitions: Array<{
    kind: 'captured_free' | 'reinforced' | 'stolen' | 'weakened' | 'unchanged_max';
    fromLevel: number;
    toLevel: number;
    count: number;
  }>;
  victims: Array<{
    userId: string;
    username: string;
    stolenCells: number;
    weakenedCells: number;
  }>;
}

export interface DevActivityAudit {
  version: 1;
  appliedToGameplay: boolean;
  claim: DevClaimAudit;
  loops: {
    successful: Array<{
      index: number;
      fromIndex: number;
      toIndex: number;
      wallCells: number;
      interiorCells: number;
      totalCells: number;
      areaM2: number;
      prunedCells: number;
      claim: DevClaimAudit;
    }>;
    rejected: Array<{
      reason: 'interior_too_small' | 'too_large';
      fromIndex: number;
      toIndex: number;
      wallCells: number;
      interiorCells: number;
      prunedCells: number;
      candidateCells?: number;
    }>;
    shortRevisits: number;
    prunedCells: number;
    orphanAbsorbedCells?: number;
  };
  gps: { sourcePoints: number; cellPath: number; droppedPoints: number; largeGaps: number };
}

export interface DevActivityDetail extends DevActivityListItem {
  endedAt: number;
  movingS: number;
}

/* ── Admin ──────────────────────────────────────────────────────────────── */

/** Egy eszközre tett push-kísérlet eredménye. A token maszkolva érkezik. */
export interface AdminPushAttempt {
  token: string;
  platform: string;
  ok: boolean;
  code: string | null;
  message: string | null;
}

export interface AdminPushTest {
  attempts: AdminPushAttempt[];
  sent: number;
  failed: number;
}

export interface AdminStatus {
  role: string | null;
  /**
   * Írhat-e a bejelentkezett admin. NEM védelem, csak a felület udvariassága:
   * a tiltást minden végpont maga is kikényszeríti.
   */
  canWrite: boolean;
  configVersion: number;
  tunableCount: number;
  lastRollover: {
    at: string | null;
    usersProcessed: number;
    holdGpAwarded: number;
    errors: number;
  } | null;
}

/** Egy nap a `metricsDaily` aggregátumból. */
export interface MetricsDailyPoint {
  day: number;
  dau: number;
  wau: number;
  mau: number;
  signups: number;
  activities: number;
  distanceKm: number;
  claimedCellsNet: number;
  activeStreaks: number;
  computedAt: string | null;
}

export interface AdminMetrics {
  /** A legutóbbi lezárt nap, vagy `null`, ha még egyszer sem futott az aggregálás. */
  latest: MetricsDailyPoint | null;
  /** Legfrissebb elöl. */
  series: MetricsDailyPoint[];
}

export interface TunableItem {
  path: string;
  kind: 'number' | 'integer' | 'boolean';
  min?: number;
  max?: number;
  group: string;
  label: string;
  help: string;
  unit?: string;
  /** A kódban rögzített alapérték. */
  defaultValue: number | boolean;
  /** A jelenleg érvényes érték (alapérték vagy felülírás). */
  value: number | boolean;
  overridden: boolean;
}

export interface GameplayState {
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  note: string | null;
  overrides: Record<string, number | boolean>;
  rejected: Array<{ path: string; value: unknown; reason: string }>;
  groups: Array<{ group: string; items: TunableItem[] }>;
}

export interface GameplayVersion {
  version: number;
  overrides: Record<string, number | boolean>;
  note: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type ModifierKindName = 'gp_multiplier' | 'claim_multiplier' | 'hold_multiplier';
export type ModifierScopeName = 'global' | 'area' | 'segment';
export type ModifierState = 'active' | 'scheduled' | 'expired' | 'cancelled';

/**
 * A nyilvános szabálymagyarázó egy sora.
 *
 * SZŰKEBB, mint az admin `TunableItem`: nincs benne `min`/`max` (ez nem
 * szerkesztő) és a Trust Score-csoport itt eleve nem is jelenik meg — a
 * szerver zárja ki, lásd `src/config/tunables.ts` → `playerVisible`.
 */
export interface PublicTunableItem {
  path: string;
  kind: 'number' | 'integer' | 'boolean';
  unit?: string;
  label: string;
  help: string;
  defaultValue: number | boolean;
  value: number | boolean;
  overridden: boolean;
}

export interface PublicActiveModifier {
  id: string;
  kind: ModifierKindName;
  scope: ModifierScopeName;
  value: number;
  reason: string;
  from: string;
  to: string;
}

export interface RulesState {
  version: number;
  groups: Array<{ group: string; items: PublicTunableItem[] }>;
  activeModifiers: PublicActiveModifier[];
}

export interface AdminModifier {
  id: string;
  kind: ModifierKindName;
  scope: ModifierScopeName;
  value: number;
  reason: string;
  source: 'manual' | 'auto';
  from: string | null;
  to: string | null;
  areaCellCount: number;
  area: { lat: number; lng: number; radiusKm: number } | null;
  segment: { inactiveDays?: number } | null;
  createdBy: string | null;
  cancelled: boolean;
  state: ModifierState;
}

export interface CreateModifierInput {
  kind: ModifierKindName;
  scope: ModifierScopeName;
  value: number;
  reason: string;
  /** ISO időpontok. */
  from: string;
  to: string;
  area?: { lat: number; lng: number; radiusKm: number };
  segment?: { inactiveDays: number };
}

/* ═══════════════════════════════════════════════════════════════════
   Nyilvános profil és közösségi gráf
   ═══════════════════════════════════════════════════════════════════ */

/**
 * A fejléc — EZ MINDIG MEGJÖN, privát fióknál és tiltásnál is.
 *
 * A `restricted: true` válaszban csak ennyi van; a felület ebből is fel tudja
 * építeni a fejlécet és a Követés kérése gombot.
 */
export interface PublicProfileHeader {
  uid: string;
  username: string;
  usernameLower: string;
  photoURL: string | null;
  /** A csatlakozás ideje (Unix ms), `null`, ha a régi profilon nincs dátum. */
  memberSince: number | null;
  pro: { active: boolean };
  account: 'public' | 'private';
  /** Privát fiókon és tiltásnál is látszik — a jelvény elismerés, nem tevékenységi adat. */
  badges: EarnedBadge[];
}

/** A teljes profil — csak akkor jön, ha `restricted: false`. */
export interface PublicProfile extends PublicProfileHeader {
  bio: string | null;
  city: string | null;
  countryCode: string | null;
  gpTotal: number;
  territoryM2: { foot: number; bike: number };
  cellCount: { foot: number; bike: number };
  zoneCount: { foot: number; bike: number };
  streak: { current: number; longest: number; weeks: number };
  counters: {
    activities: number;
    followers: number;
    following: number;
    distanceKm: { run: number; walk: number; ride: number };
  };
}

export interface Relationship {
  /** A saját profilom — ilyenkor nincs se követés, se tiltás. */
  self: boolean;
  /** Én követem őt. */
  following: boolean;
  /** Ő követ engem. */
  followedBy: boolean;
  /** Privát fióknál elküldött, még el nem bírált kérés. */
  requested: boolean;
  /** Én tiltottam le őt. (Aki engem tiltott le, annak a profilja 404.) */
  blocked: boolean;
}

export type PublicProfileResult =
  | { profile: PublicProfileHeader; relationship: Relationship; restricted: true }
  | { profile: PublicProfile; relationship: Relationship; restricted: false };

/** A bejelentés okai — a `docs/05` `reports.category` értékkészlete. */
export type ReportCategory =
  | 'gps_spoof'
  | 'vehicle'
  | 'wrong_type'
  | 'offensive'
  | 'privacy'
  | 'other';

export type FollowStatus = 'following' | 'requested' | 'none';

/** Egy sor a követő- vagy követett-listában. */
export interface Connection {
  uid: string;
  username: string;
  photoURL: string | null;
  /**
   * A választott cellaszín KULCSA, vagy `null`/hiányzó, ha nem állított
   * magának. A rivális-sáv ebből színezi a hozzá tartozó oldalt — lásd
   * `ActivityAuthor.cellColor`.
   */
  cellColor?: string | null;
}

/** Egy találat a Felfedezés fülön indított keresésben — a Connection bővítve a Követés gombhoz kellő állapottal. */
export interface DiscoverUser extends Connection {
  account: 'public' | 'private';
  /** `requested` sosem jön a szervertől — a kliens a Követés gomb kattintása után állítja be helyben. */
  followStatus: FollowStatus;
}

/**
 * Egy rivális — akitől területet vettél el, vagy aki tőled.
 *
 * A FŐ SZÁM az `exchangedCells`: hány mező cserélt gazdát köztetek, mindkét
 * irányban összesen. A `gainedCells`/`lostCells` a bontása — a felületen
 * zölddel és pirossal, kisebb betűvel a fő szám után.
 */
export interface Rival extends Connection {
  exchangedCells: number;
  gainedCells: number;
  lostCells: number;
  gainedEvents: number;
  lostEvents: number;
  exchangedM2: number;
  gainedM2: number;
  lostM2: number;
}

export interface RivalList {
  items: Rival[];
  hasMore: boolean;
  /** Hány rivális kerül kiemelten a profilra — a szerver mondja meg. */
  top: number;
}

export interface ConnectionList {
  items: Connection[];
  /** Igaz, ha a listánál többen vannak — a felület ezt kiírja. */
  hasMore: boolean;
}

/**
 * Banda — csoport, ahol a tagok területe és pontja összeadódik.
 *
 * Phase 1 (GRUNDO #29): nincs még hírfolyam, chat fal és beállítás-mező a
 * kliens oldalán sem — csak az, amit a mag-CRUD képernyők használnak.
 */
export type BandaVisibility = 'public' | 'private';
export type BandaRole = 'owner' | 'moderator' | 'member';

export interface BandaAreaTotals {
  foot: number;
  bike: number;
}

export interface BandaTotals {
  areaM2: BandaAreaTotals;
  areaDayM2: BandaAreaTotals;
  areaWeekM2: BandaAreaTotals;
  areaMonthM2: BandaAreaTotals;
  gpTotal: number;
  gpWeek: number;
  gpMonth: number;
}

export interface Banda {
  id: string;
  name: string;
  description: string | null;
  photoURL: string | null;
  city: string | null;
  visibility: BandaVisibility;
  ownerId: string;
  memberCount: number;
  totals: BandaTotals;
  createdAt: number | null;
}

export interface BandaWithRole extends Banda {
  role: BandaRole;
}

export interface BandaMember {
  uid: string;
  username: string;
  photoURL: string | null;
  role: BandaRole;
}

/**
 * Időjárás-állapotok — pontosan annyi, ahány ikonpárunk van.
 *
 * Mindegyikhez tartozik nappali ÉS éjszakai rajz, ezért minden új állapot két
 * ikont jelent. A szolgáltató ötvennél több kódját a szerver képezi le ezekre
 * (`server/src/routes/weather.ts`).
 */
export type WeatherCondition =
  | 'clear'
  | 'partly_cloudy'
  | 'cloudy'
  | 'rain'
  | 'snow'
  | 'storm'
  | 'fog';

export interface WeatherResult {
  tempC: number;
  condition: WeatherCondition;
  /** Éjszaka van-e a MÉRT helyen — nem a böngésző órája szerint. */
  night: boolean;
  description: string;
  /*
    A kibontott widget három további adata. Mindegyik lehet `null`: a
    hiányzó mérést NEM pótoljuk nullával, mert a „0% csapadék" azt jelenti,
    hogy biztosan nem esik — az pedig nem ugyanaz, mint hogy nem tudjuk.
  */
  /** Csapadék esélye a folyó órában, százalék. */
  precipitationChance: number | null;
  /** Relatív páratartalom, százalék. */
  humidity: number | null;
  /** Szélsebesség, km/h. */
  windKph: number | null;
}

export const api = {
  me: () => request<{ profile: Profile }>('/api/me'),

  /**
   * Az aktuális időjárás egy koordinátára.
   *
   * A hívás a saját backendünkön megy át, ott van gyorsítótárazva — a
   * szolgáltató kulcsa soha nem kerül kliensre.
   */
  weather: (lat: number, lon: number) =>
    request<WeatherResult>(`/api/weather?lat=${lat}&lon=${lon}`),

  /** Egy felhasználó nyilvános profilja, felhasználónév alapján. */
  publicProfile: (username: string) =>
    request<PublicProfileResult>(`/api/users/${encodeURIComponent(username)}`),

  /** Követés — privát fióknál kérés lesz belőle (`requested`). */
  follow: (username: string) =>
    request<{ status: FollowStatus }>(`/api/users/${encodeURIComponent(username)}/follow`, {
      method: 'POST',
    }),

  /** Követés vagy függő kérés visszavonása. */
  unfollow: (username: string) =>
    request<{ status: FollowStatus }>(`/api/users/${encodeURIComponent(username)}/follow`, {
      method: 'DELETE',
    }),

  /**
   * Kik követik, illetve kiket követ — a profil számlálói mögötti lista.
   *
   * A `kind` közvetlenül az útvonal vége, ezért zárt halmaz, nem sztring:
   * elgépelve néma 404 lenne belőle.
   */
  connections: (username: string, kind: 'followers' | 'following') =>
    request<ConnectionList>(`/api/users/${encodeURIComponent(username)}/${kind}`),

  /** Kiket tiltottam le — a Beállítások → Tiltott felhasználók listája. */
  blockedUsers: () => request<{ items: Connection[] }>('/api/users/me/blocked'),

  /**
   * A saját rivális-listám, a kicserélt mezők szerint rangsorolva.
   *
   * ⚠️ NINCS `username` PARAMÉTER, és nem is lesz: más rivális-listája nem
   * publikus — megmutatná, kitől szokott veszíteni.
   */
  rivals: () => request<RivalList>('/api/rivals'),

  /** Csak az azonosítók — ebből lesz a név melletti „RIVÁLIS" címke. */
  rivalIds: () => request<{ ids: string[] }>('/api/rivals/ids'),

  bandas: {
    /** Létrehozás — a válasz meghívókódot is ad, ha a banda privát. */
    create: (input: { name: string; description?: string; visibility: BandaVisibility; city?: string }) =>
      request<{ banda: Banda; inviteCode: string | null; role: BandaRole }>('/api/bandas', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    /** A saját bandáim, szerepkörrel. */
    mine: () => request<{ items: BandaWithRole[] }>('/api/bandas/mine'),

    /** Publikus bandák keresése, névprefix szerint. */
    search: (q: string) => request<{ items: Banda[] }>(`/api/bandas/search?q=${encodeURIComponent(q)}`),

    /** Publikus bandához azonnali csatlakozás. */
    join: (bandaId: string) =>
      request<{ role: BandaRole }>(`/api/bandas/${encodeURIComponent(bandaId)}/join`, { method: 'POST' }),

    /** Privát bandához meghívókóddal. */
    joinByCode: (code: string) =>
      request<{ role: BandaRole; bandaId: string; name: string }>('/api/bandas/join-by-code', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }),

    /** Egy banda részletei — a hívó szerepével és (tagoknál) a meghívókóddal. */
    detail: (bandaId: string) =>
      request<{ banda: Banda; role: BandaRole | null; isMember: boolean; inviteCode: string | null }>(
        `/api/bandas/${encodeURIComponent(bandaId)}`,
      ),

    /** A teljes tag-lista, szerepkörrel. */
    members: (bandaId: string) =>
      request<{ items: BandaMember[]; hasMore: boolean }>(`/api/bandas/${encodeURIComponent(bandaId)}/members`),
  },

  /** Felhasználónév-keresés (prefix-illeszkedés) — a fejléc Keresés gombja. */
  searchUsers: (q: string) =>
    request<{ items: Connection[] }>(`/api/users/search?q=${encodeURIComponent(q)}`),

  /**
   * Ugyanaz a végpont, mint `searchUsers`, de a Felfedezés fülön (docs/02 →
   * Közösség → Felfedezés) kell hozzá a fiók-láthatóság és a követési
   * állapot is, hogy a Követés gomb rögtön helyes felirattal induljon.
   */
  discoverSearch: (q: string) =>
    request<{ items: DiscoverUser[] }>(`/api/users/search?q=${encodeURIComponent(q)}`),

  /** Tiltás — a követés mindkét irányban megszűnik. */
  blockUser: (username: string) =>
    request<{ status: 'blocked' }>(`/api/users/${encodeURIComponent(username)}/block`, {
      method: 'POST',
    }),

  /** A tiltás feloldása. A követést NEM állítja vissza. */
  unblockUser: (username: string) =>
    request<{ status: 'none' }>(`/api/users/${encodeURIComponent(username)}/block`, {
      method: 'DELETE',
    }),

  /** Bejelentés — egy felhasználóról egyszerre egy nyitott bejelentés lehet. */
  reportUser: (username: string, category: ReportCategory, note: string) =>
    request<{ ok: true }>(`/api/users/${encodeURIComponent(username)}/report`, {
      method: 'POST',
      body: JSON.stringify({ category, note }),
    }),

  /**
   * Belépés felhasználónévvel. A szerver ellenőrzi a jelszót, és egy
   * custom tokent ad vissza, amivel a Firebase SDK bejelentkeztet.
   * E-mail-címmel belépéskor ez a kerülő nem kell — ott a kliens közvetlenül
   * a Firebase-t hívja, és a jelszó felénk el sem indul.
   */
  login: (username: string, password: string) =>
    request<{ customToken: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  /**
   * Google-fiókos ez az azonosító?
   *
   * CSAK SIKERTELEN BELÉPÉS UTÁN hívjuk. Egy Google-lel regisztrált fiókhoz
   * nem tartozik jelszó, tehát a felhasználó hiába próbálkozik újra — meg kell
   * mondani neki, hogy a Google-gombot keresse.
   *
   * Hibát SOSEM dob: ha a kérdés nem megválaszolható (hálózat, végpont), az
   * eredeti belépési hibaüzenet marad. Egy segítő üzenet hiánya nem indok
   * arra, hogy a valódi hibát elrejtsük.
   */
  signInMethod: (identifier: string) =>
    request<{ googleOnly: boolean }>('/api/auth/method', {
      method: 'POST',
      body: JSON.stringify({ identifier }),
    }).catch(() => ({ googleOnly: false })),

  register: (username: string) =>
    request<{ profile: Profile }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username }),
    }),

  /**
   * Egy befejezett aktivitás feltöltése.
   *
   * A szerver MINDENT újraszámol a nyers nyomvonalból — a kliens által
   * mutatott táv és terület csak előnézet. Eltérés esetén a szerveré az
   * igazság; a válaszban ez jön vissza.
   *
   * A törzs gzip-tömörítve megy — lásd `compressedJsonBody()` fejlécét.
   */
  uploadActivity: async (input: UploadActivityInput) => {
    const { body, headers } = await compressedJsonBody(input);
    return request<
      | { activityId: string; summary: ActivitySummary; duplicate?: boolean }
      | { activityId: string; processing: true }
    >(
      '/api/activities?async=1',
      { method: 'POST', body, headers },
    );
  },

  /** Hosszú mentés állapota megszakadt klienskapcsolat vagy újranyitás után. */
  activityUploadStatus: (id: string) =>
    request<ActivityUploadStatusResult>(
      `/api/activities/${encodeURIComponent(id)}/upload-status`,
    ),

  /** A feed — nézet szerint szűrve. */
  activities: (query: FeedQuery) => {
    const params = new URLSearchParams({
      scope: query.scope,
      limit: String(query.limit ?? 20),
    });
    if (query.dateFrom !== undefined) params.set('dateFrom', String(query.dateFrom));
    if (query.dateTo !== undefined) params.set('dateTo', String(query.dateTo));
    if (query.scope === 'local') {
      params.set('lat', String(query.lat ?? 0));
      params.set('lng', String(query.lng ?? 0));
      params.set('radiusKm', String(query.radiusKm ?? 10));
    }
    if (query.scope === 'user') params.set('userId', query.userId ?? '');
    return request<FeedResult>(`/api/activities?${params.toString()}`);
  },

  /** Egy aktivitás adatlapja. */
  activity: (id: string) => request<{ activity: ActivityDetail }>(`/api/activities/${id}`),

  /** Láthatóságvédett aktivitásfotó bináris tartalma. */
  activityPhoto: (id: string, path: string, signal?: AbortSignal) => {
    const fileName = path.split('/').at(-1) ?? '';
    return requestBlob(
      `/api/activities/${encodeURIComponent(id)}/photos/${encodeURIComponent(fileName)}`,
      signal,
    );
  },

  /**
   * A TELJES, levágatlan nyomvonal — csak a saját aktivitásodhoz.
   *
   * A részletek képernyőn ebből rajzoljuk a térképet és számoljuk a
   * részidőket. Másnál a levágott `route` az egyetlen elérhető változat.
   */
  activityTrack: (id: string) =>
    request<{ points: { lat: number; lng: number; t: number; elevation?: number }[] }>(
      `/api/activities/${id}/track`,
    ),

  /**
   * Az aktivitás leíró mezőinek szerkesztése.
   *
   * Csak cím, leírás és fotók. A metrikák, a nyomvonal és a pont
   * szerveroldali számítás eredménye, azokat a kliens nem írhatja felül.
   */
  updateActivity: (
    id: string,
    patch: { title?: string; description?: string; photos?: ActivityPhoto[] },
  ) => request<{ ok: true }>(`/api/activities/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }),

  /** Az aktivitás azonnal eltűnik, a szerver 30 napig visszaállíthatóan őrzi. */
  deleteActivity: (id: string) =>
    request<{ ok: true; purgeAt: number }>(`/api/activities/${id}`, { method: 'DELETE' }),

  updateActivityPrivacy: (privacy: {
    hideStart: boolean;
    startRadiusM: 50 | 100 | 200;
    hideEnd: boolean;
    endRadiusM: 50 | 100 | 200;
  }) => request<{ privacy: Profile['privacy']; rebuiltActivities: number }>('/api/auth/privacy', {
    method: 'PATCH',
    body: JSON.stringify(privacy),
  }),

  updateProfilePhoto: (photoURL: string | null) =>
    request<{ photoURL: string | null }>('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({ photoURL }),
    }),

  /** Kedvelés be- vagy kikapcsolása. A válasz a friss számláló. */
  setLike: (id: string, liked: boolean) =>
    request<{ likeCount: number; likedByMe: boolean }>(`/api/activities/${id}/like`, {
      method: liked ? 'POST' : 'DELETE',
    }),

  comments: (id: string) =>
    request<{ comments: ActivityComment[] }>(`/api/activities/${id}/comments`),

  addComment: (id: string, text: string, replyToId?: string) =>
    request<{ id: string; text: string; createdAt: number; replyToId: string | null; replyToUsername: string | null }>(
      `/api/activities/${id}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({ text, ...(replyToId ? { replyToId } : {}) }),
      },
    ),

  deleteComment: (id: string, commentId: string) =>
    request<{ ok: true }>(`/api/activities/${id}/comments/${commentId}`, { method: 'DELETE' }),

  /** A saját területem cellái, érvényes védelmi szinttel. */
  territory: (layer: 'foot' | 'bike' = 'foot') =>
    request<TerritoryResult>(`/api/tiles/mine?layer=${layer}`),

  /** A látott térképszakasz birtokviszonya — mindenkié. */
  tiles: (
    layer: 'foot' | 'bike',
    view: { south: number; west: number; north: number; east: number },
  ) =>
    request<TilesResult>(
      `/api/tiles?layer=${layer}&south=${view.south}&west=${view.west}` +
        `&north=${view.north}&east=${view.east}`,
    ),

  /**
   * Az ÖSSZEFÜGGŐ TERÜLETFOLTOK a látott szakaszon.
   *
   * A `tiles`-tól eltérően ez NÉZETTŐL FÜGGETLEN, előszámolt egységeket ad:
   * egy folt akkor is teljes, ha kilóg a képernyőről, és ugyanaz a folt
   * ugyanakkora marad, akárhonnan nézzük. A méretszűrés a szerveren megy
   * (lásd `territoryScale.ts`), ezért a válasz mérete nem nő a nagyítással.
   */
  territoryBlobs: (
    layer: 'foot' | 'bike',
    view: { south: number; west: number; north: number; east: number },
  ) =>
    request<TerritoryBlobsResult>(
      `/api/tiles/blobs?layer=${layer}&south=${view.south}&west=${view.west}` +
        `&north=${view.north}&east=${view.east}`,
    ),

  /** Egy mező tulajdonosának kártyája — koppintásra kérjük le, nem előre. */
  tileOwner: (uid: string, layer: 'foot' | 'bike' = 'foot') =>
    request<{ owner: TileOwner }>(`/api/tiles/owner/${encodeURIComponent(uid)}?layer=${layer}`),

  /**
   * A ranglista. `window` szerint négy nézet: `alltime` a jelenlegi
   * területet mutatja, `day`/`week`/`month` a bruttó szerzést az adott
   * időszakban (a `gpWeek`/`gpMonth` mintájára — nem a nettó változást).
   */
  leaderboard: (layer: 'foot' | 'bike' = 'foot', window: LeaderboardWindow = 'alltime') =>
    request<{ layer: string; window: LeaderboardWindow; entries: LeaderboardEntry[] }>(
      `/api/tiles/leaderboard?layer=${layer}&window=${window}`,
    ),

  /**
   * Küldetés-ajánló. Időből saját/felülírt tempóval számol célhosszt, vagy
   * közvetlen kilométert fogad.
   */
  generateMissions: (input: {
    lat: number;
    lng: number;
    minutes?: number;
    distanceKm?: number;
    paceSecPerKm?: number;
    priority?: MissionPriority;
    /** Hány ajánlatot kérünk (1-5). Felső korlát, nem garancia. */
    limit?: number;
    preferredBearing?: number;
    type: ActivityType;
    /** Séta mozgásformánál nincs értelme — a felület akkor nem küldi. */
    routeCharacter?: RouteCharacter;
  }) =>
    request<MissionResult>('/api/missions/generate', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /**
   * A küldetés-ajánló GYORS fele: útvonalak terület és GP nélkül.
   *
   * Mérve (2026-08-29): 0,5–2,2 s, míg a teljes lánc nagy bringakörnél
   * 12,7 s. A kártya ebből már kirajzolható, a többi mező a
   * `missionsEvaluate` válaszával töltődik ki.
   */
  missionsPlan: (input: {
    lat: number;
    lng: number;
    minutes?: number;
    distanceKm?: number;
    paceSecPerKm?: number;
    priority?: MissionPriority;
    limit?: number;
    preferredBearing?: number;
    type: ActivityType;
    routeCharacter?: RouteCharacter;
  }) =>
    request<MissionPlanResult>('/api/missions/generate', {
      method: 'POST',
      body: JSON.stringify({ ...input, phase: 'plan' }),
    }),

  /**
   * A LASSÚ fele: a megtervezett útvonalakra terület, mező, GP és karakter.
   *
   * Nem fogyaszt kvótát — azt a `missionsPlan` már elszámolta.
   */
  missionsEvaluate: (input: {
    type: ActivityType;
    priority?: MissionPriority;
    limit?: number;
    routes: { polyline: string; bearing: number }[];
  }) =>
    request<{ missions: Mission[]; reason?: string }>('/api/missions/evaluate', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  otpSend: () => request<OtpSendResult>('/api/auth/otp/send', { method: 'POST' }),

  otpVerify: (code: string) =>
    request<{ verified: true }>('/api/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  devActivities: (cursor?: string) =>
    request<{ activities: DevActivityListItem[]; nextCursor: string | null }>(
      `/api/dev/activities?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),

  devActivity: (id: string) =>
    request<{
      activity: DevActivityDetail;
      trust: DevActivityTrust | null;
      points: Array<{ lat: number; lng: number; t: number; accuracy?: number; elevation?: number }>;
      audit: DevActivityAudit | null;
    }>(`/api/dev/activities/${encodeURIComponent(id)}`),

  /**
   * Szabálymagyarázó — nyilvános, hitelesítés nélkül is hívható.
   * Ugyanabból a sémából jön, mint az admin szerkesztő, ezért egy átállított
   * szorzó után a szöveg sem hazudik.
   */
  rules: () => request<RulesState>('/api/rules'),

  // ── Admin ───────────────────────────────────────────────────────────────
  adminStatus: () => request<AdminStatus>('/api/admin/status'),

  adminMetrics: (days = 14) => request<AdminMetrics>(`/api/admin/metrics?days=${days}`),

  /**
   * Teszt-értesítés a saját eszközökre, eszközönkénti nyers FCM hibakóddal.
   * A push csendben hasal el; enélkül csak a Cloud Run naplójából derülne ki,
   * miért nem érkezik meg (lásd `server/src/routes/admin.ts` → `/push/test`).
   */
  adminTestPush: () => request<AdminPushTest>('/api/admin/push/test', { method: 'POST' }),

  adminGameplay: () => request<GameplayState>('/api/admin/gameplay'),

  /**
   * A TELJES felülírás-halmazt küldjük, nem különbséget.
   *
   * Amit kihagyunk, az visszaáll alapértékre — így a felület állapota és a
   * tárolt állapot nem tud szétcsúszni.
   */
  adminSaveGameplay: (overrides: Record<string, number | boolean>, note: string) =>
    request<GameplayState>('/api/admin/gameplay', {
      method: 'PUT',
      body: JSON.stringify({ overrides, note }),
    }),

  adminGameplayVersions: () =>
    request<{ versions: GameplayVersion[] }>('/api/admin/gameplay/versions'),

  adminRollbackGameplay: (version: number) =>
    request<GameplayState>('/api/admin/gameplay/rollback', {
      method: 'POST',
      body: JSON.stringify({ version }),
    }),

  adminModifiers: (includeExpired = false) =>
    request<{ modifiers: AdminModifier[] }>(
      `/api/admin/modifiers${includeExpired ? '?expired=1' : ''}`,
    ),

  adminCreateModifier: (input: CreateModifierInput) =>
    request<{ id: string }>('/api/admin/modifiers', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  adminUpdateModifier: (id: string, input: CreateModifierInput) =>
    request<{ ok: true }>(`/api/admin/modifiers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  adminCancelModifier: (id: string) =>
    request<{ ok: true }>(`/api/admin/modifiers/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    }),

  adminDeleteModifier: (id: string) =>
    request<{ ok: true }>(`/api/admin/modifiers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};
