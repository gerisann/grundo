import { auth } from './firebase';

/**
 * A GRUNDO backend kliense.
 *
 * MINDEN játékadat-írás ezen megy keresztül — a kliens Firestore-ba
 * közvetlenül csak a saját, engedélyezett mezőit írhatja (firestore.rules).
 */

export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

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
  privacy: {
    hideStart: boolean;
    startRadiusM: 50 | 100 | 200;
    hideEnd: boolean;
    endRadiusM: 50 | 100 | 200;
    routeRevision: number;
  };
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

export type FeedScope = 'mine' | 'world' | 'local' | 'following';

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
  author: { username: string; photoURL: string | null };
}

/** Egy feltöltött kép: a Storage-útvonal és a megjelenítéshez való cím. */
export interface ActivityPhoto {
  path: string;
  url: string;
}

export interface ActivityComment {
  id: string;
  text: string;
  createdAt: number;
  /** A sajátom-e — ettől függ, törölhető-e. */
  mine: boolean;
  author: { username: string; photoURL: string | null };
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
  bounds: { north: number; south: number; east: number; west: number } | null;
  author: { username: string; photoURL: string | null };
  /** Csak a saját aktivitásnál. Pontszám és diagnosztika soha nem jön le. */
  trustVerdict?: 'trusted' | 'pending_review' | 'rejected';
}

export interface FeedResult {
  activities: FeedActivity[];
  /** Ha 'following', a követés még nem elérhető — nincs követési gráf. */
  unavailable?: 'following';
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

export interface TilesResult {
  layer: 'foot' | 'bike';
  cells: TileCell[];
  /** A nézetet lefedő res 9 blokkok — ezekből számoljuk a SZABAD cellákat. */
  blocks?: string[];
  owners: Record<string, string>;
  /**
   * A háló csak a nézet KÖZEPÉT fedi le — a széleken nem tudjuk, mi van.
   * Ilyenkor a felület ne állítsa, hogy ott szabad a terület.
   */
  partial?: boolean;
}

export interface LeaderboardEntry {
  uid: string;
  username: string;
  photoURL: string | null;
  areaM2: number;
  cellCount: number;
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
  deleted: boolean;
  hasAudit: boolean;
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

export const api = {
  me: () => request<{ profile: Profile }>('/api/me'),

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
   */
  uploadActivity: (input: UploadActivityInput) =>
    request<{ activityId: string; summary: ActivitySummary; duplicate?: boolean }>(
      '/api/activities',
      { method: 'POST', body: JSON.stringify(input) },
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
    return request<FeedResult>(`/api/activities?${params.toString()}`);
  },

  /** Egy aktivitás adatlapja. */
  activity: (id: string) => request<{ activity: ActivityDetail }>(`/api/activities/${id}`),

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

  addComment: (id: string, text: string) =>
    request<{ id: string; text: string; createdAt: number }>(`/api/activities/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

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

  /** A legnagyobb területek. */
  leaderboard: (layer: 'foot' | 'bike' = 'foot') =>
    request<{ layer: string; entries: LeaderboardEntry[] }>(
      `/api/tiles/leaderboard?layer=${layer}`,
    ),

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
      points: Array<{ lat: number; lng: number; t: number; accuracy?: number; elevation?: number }>;
      audit: DevActivityAudit | null;
    }>(`/api/dev/activities/${encodeURIComponent(id)}`),
};
